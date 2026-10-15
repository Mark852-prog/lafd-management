/**
 * services/discipline.js
 * -----------------------------------------------------------------------
 * Infraction expiry and suspension handling, shared by /discipline and
 * the scheduler.
 * -----------------------------------------------------------------------
 */

const { COLORS, getRoleId } = require('../config');
const db = require('../database/db');
const { fetchMember, removeRoles } = require('../utils/members');
const { logDiscipline } = require('../utils/logger');
const { safeDM } = require('../utils/channels');
const { successEmbed } = require('../utils/embeds');

/** Ends a suspension early or on schedule. The record itself stays on file. */
async function liftSuspension(guild, record, { actor = null, reason = null } = {}) {
  db.markInfractionExpired(record.id, { deactivate: false });
  const member = await fetchMember(guild, record.discord_id);
  if (member) {
    await removeRoles(member, [getRoleId('SUSPENDED')], 'Suspension served');
    await safeDM(member.user, {
      embeds: [successEmbed('Suspension Lifted', `Your suspension (case #${record.id}) has ended. You may resume duties.`)],
    });
  }
  await logDiscipline(guild, {
    title: 'Suspension Lifted',
    member: { id: record.discord_id },
    staff: actor,
    color: COLORS.SUCCESS,
    fields: { Case: `#${record.id}`, Note: reason || 'Suspension period completed' },
  });
}

/** Called by the scheduler for every infraction whose expiry has passed. */
async function processExpiredInfraction(guild, record) {
  if (record.type === 'Suspension') return liftSuspension(guild, record);

  db.markInfractionExpired(record.id, { deactivate: true });
  await logDiscipline(guild, {
    title: `${record.type} Expired`,
    member: { id: record.discord_id },
    staff: null,
    color: COLORS.NEUTRAL,
    fields: { Case: `#${record.id}`, 'Original Reason': record.reason },
  });
}

module.exports = { liftSuspension, processExpiredInfraction };
