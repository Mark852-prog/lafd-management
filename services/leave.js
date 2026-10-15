/**
 * services/leave.js
 * -----------------------------------------------------------------------
 * Leave lifecycle shared by /leave, the approval buttons, and the
 * scheduler: PENDING -> SCHEDULED -> ACTIVE -> ENDED (or DENIED/CANCELLED).
 * -----------------------------------------------------------------------
 */

const { COLORS, ICONS, getRoleId } = require('../config');
const db = require('../database/db');
const { baseEmbed, addField } = require('../utils/embeds');
const { fetchMember, addRoles, removeRoles } = require('../utils/members');
const { logPersonnel } = require('../utils/logger');
const { safeDM } = require('../utils/channels');
const { ts, truncate } = require('../utils/format');
const { endMemberShift } = require('./shifts');

const LEAVE_TYPES = {
  LOA: { key: 'LOA', name: 'Leave of Absence', roleKey: 'LEAVE_OF_ABSENCE' },
  ADMIN: { key: 'ADMIN', name: 'Administrative Leave', roleKey: 'ADMIN_LEAVE' },
};

const STATUS_LABELS = {
  PENDING: '🟡 Pending Review',
  SCHEDULED: '🗓️ Approved - Scheduled',
  ACTIVE: '🟢 Active',
  ENDED: '⚫ Ended',
  DENIED: '🔴 Denied',
  CANCELLED: '⚪ Cancelled',
};

function leaveEmbed(leave, { title } = {}) {
  const type = LEAVE_TYPES[leave.type];
  const color = { PENDING: COLORS.WARNING, SCHEDULED: COLORS.INFO, ACTIVE: COLORS.SUCCESS, DENIED: COLORS.DANGER }[leave.status] || COLORS.NEUTRAL;
  const embed = baseEmbed({ color, title: title || `${ICONS.LEAVE} ${type.name} • #${leave.id}` });
  addField(embed, 'Member', `<@${leave.discord_id}>`, true);
  addField(embed, 'Status', STATUS_LABELS[leave.status] || leave.status, true);
  addField(embed, 'Type', type.name, true);
  addField(embed, 'Starts', ts(leave.starts_at, 'D'), true);
  addField(embed, 'Ends', leave.ends_at ? `${ts(leave.ends_at, 'D')} (${ts(leave.ends_at, 'R')})` : 'Until further notice', true);
  addField(embed, leave.type === 'ADMIN' ? 'Placed By' : 'Requested By', `<@${leave.requested_by}>`, true);
  addField(embed, 'Reason', truncate(leave.reason, 1024));
  if (leave.decided_by) addField(embed, leave.status === 'DENIED' ? 'Denied By' : 'Reviewed By', `<@${leave.decided_by}>`, true);
  addField(embed, 'Reviewer Note', leave.decision_note);
  if (leave.ended_by || leave.ended_at) addField(embed, 'Ended', `${ts(leave.ended_at, 'f')}${leave.ended_by ? ` by <@${leave.ended_by}>` : ' (expired)'}`);
  return embed;
}

/** Puts a leave into effect now: role, status, ends any running shift. */
async function activateLeave(guild, leave, actor = null) {
  const updated = db.updateLeave(leave.id, { status: 'ACTIVE' });
  const type = LEAVE_TYPES[leave.type];
  const member = await fetchMember(guild, leave.discord_id);
  let roleFailed = [];
  if (member) {
    roleFailed = (await addRoles(member, [getRoleId(type.roleKey)], type.name)).failed;
    await endMemberShift(guild, member.id, { endedBy: actor, reason: `Placed on ${type.name}` });
    await safeDM(member.user, { embeds: [leaveEmbed(updated, { title: `${ICONS.LEAVE} Your ${type.name} is now active` })] });
  }
  await logPersonnel(guild, {
    title: `${type.name} Started`,
    member: { id: leave.discord_id },
    staff: actor,
    color: COLORS.INFO,
    fields: { 'Leave ID': `#${leave.id}`, Ends: leave.ends_at ? ts(leave.ends_at, 'D') : 'Indefinite', Reason: leave.reason },
  });
  return { leave: updated, roleFailed };
}

/** Ends an active (or scheduled) leave and removes the leave role. */
async function endLeave(guild, leave, { actor = null, reason = null } = {}) {
  const updated = db.updateLeave(leave.id, {
    status: 'ENDED',
    ended_by: actor?.id ?? null,
    ended_at: new Date().toISOString(),
    decision_note: reason ?? leave.decision_note,
  });
  const type = LEAVE_TYPES[leave.type];
  const member = await fetchMember(guild, leave.discord_id);
  if (member) {
    await removeRoles(member, [getRoleId(type.roleKey)], `${type.name} ended`);
    await safeDM(member.user, {
      embeds: [leaveEmbed(updated, { title: `${ICONS.LEAVE} Your ${type.name} has ended - welcome back!` })],
    });
  }
  await logPersonnel(guild, {
    title: `${type.name} Ended`,
    member: { id: leave.discord_id },
    staff: actor,
    color: COLORS.NEUTRAL,
    fields: { 'Leave ID': `#${leave.id}`, Note: reason || (actor ? null : 'Reached end date') },
  });
  return updated;
}

module.exports = { LEAVE_TYPES, STATUS_LABELS, leaveEmbed, activateLeave, endLeave };
