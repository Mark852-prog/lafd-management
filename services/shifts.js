/**
 * services/shifts.js
 * -----------------------------------------------------------------------
 * Ending a shift is shared by /shift end, /shift force-end, leave,
 * suspension, termination, members leaving the server, and the
 * auto-end scheduler - so it lives here.
 * -----------------------------------------------------------------------
 */

const { COLORS, getRoleId } = require('../config');
const db = require('../database/db');
const { fetchMember, removeRoles, addRoles } = require('../utils/members');
const { logShifts } = require('../utils/logger');
const { formatDuration, ts } = require('../utils/format');

async function startMemberShift(member) {
  const shift = db.startShift(member.id);
  await addRoles(member, [getRoleId('ON_DUTY')], 'Shift started');
  await logShifts(member.guild, {
    title: 'Shift Started',
    member,
    staff: member.user,
    color: COLORS.SUCCESS,
    fields: { Started: ts(shift.start_time, 'F') },
  });
  return shift;
}

/**
 * Ends `discordId`'s active shift (if any), removes the On Duty role and
 * logs it. `endedBy` is a User (or null for the system).
 */
async function endMemberShift(guild, discordId, { endedBy = null, reason = null, endTime = new Date() } = {}) {
  const finished = db.endShift(discordId, { endedBy: endedBy?.id ?? null, reason, endTime });
  if (!finished) return null;

  const member = await fetchMember(guild, discordId);
  if (member) await removeRoles(member, [getRoleId('ON_DUTY')], reason || 'Shift ended');

  await logShifts(guild, {
    title: endedBy && endedBy.id === discordId ? 'Shift Ended' : 'Shift Ended (by staff/system)',
    member: { id: discordId },
    staff: endedBy,
    color: COLORS.NEUTRAL,
    fields: {
      Duration: formatDuration(finished.duration_seconds),
      Started: ts(finished.start_time, 'f'),
      Ended: ts(finished.end_time, 'f'),
      Reason: reason,
    },
  });
  return finished;
}

module.exports = { startMemberShift, endMemberShift };
