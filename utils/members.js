/**
 * utils/members.js
 * -----------------------------------------------------------------------
 * Member lookups and safe role changes. Role changes never throw: they
 * report which roles could not be changed (usually because the bot's role
 * sits below them in Server Settings -> Roles).
 * -----------------------------------------------------------------------
 */

const { ALL_RANKS, DEPARTMENTS, CERTIFICATIONS, ROLE_SETTINGS, getRoleId, getMemberRank } = require('../config');
const { upsertMember } = require('../database/db');

async function fetchMember(guild, userId) {
  if (!userId) return null;
  return guild.members.fetch(userId).catch(() => null);
}

/** Keeps the database member row in sync with the member's live roles. */
function syncMemberRecord(member) {
  const rank = getMemberRank(member);
  return upsertMember({
    discordId: member.id,
    username: member.user.username,
    department: rank?.department ?? null,
    rankRoleId: rank?.roleId ?? null,
  });
}

function roleLabel(guild, roleId) {
  return guild.roles.cache.get(roleId)?.name || roleId;
}

async function changeRoles(member, roleIds, mode, reason) {
  const result = { changed: [], failed: [] };
  const unique = [...new Set(roleIds.filter(Boolean))];
  for (const roleId of unique) {
    const has = member.roles.cache.has(roleId);
    if ((mode === 'add' && has) || (mode === 'remove' && !has)) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role || !role.editable) {
      result.failed.push(role ? role.name : `Unknown role ${roleId}`);
      continue;
    }
    try {
      if (mode === 'add') await member.roles.add(roleId, reason);
      else await member.roles.remove(roleId, reason);
      result.changed.push(role.name);
    } catch (err) {
      console.warn(`[Roles] Failed to ${mode} ${role.name} for ${member.user.tag}: ${err.message}`);
      result.failed.push(role.name);
    }
  }
  return result;
}

const addRoles = (member, roleIds, reason) => changeRoles(member, roleIds, 'add', reason);
const removeRoles = (member, roleIds, reason) => changeRoles(member, roleIds, 'remove', reason);

/**
 * Moves a member to `rank`: removes every other rank role in the same
 * department, then adds the new rank plus the division and LAFD member
 * roles. Ranks in the OTHER department are left alone (dual-qualified
 * members keep both).
 */
async function applyRank(member, rank, reason) {
  // Add the new rank first so a failure never leaves the member with no rank at all.
  const rankAdd = await addRoles(member, [rank.roleId], reason);
  if (!member.roles.cache.has(rank.roleId)) return { failed: rankAdd.failed, rankApplied: false };

  const sameDeptRoleIds = DEPARTMENTS[rank.department].ranks.map((r) => r.roleId).filter((id) => id && id !== rank.roleId);
  const removed = await removeRoles(member, sameDeptRoleIds, reason);
  const extras = await addRoles(member, [getRoleId(DEPARTMENTS[rank.department].divisionRole), getRoleId('LAFD_MEMBER')], reason);
  return { failed: [...removed.failed, ...extras.failed], rankApplied: true };
}

/** Removes every department-issued role (ranks, divisions, certifications, duty/leave status). */
async function stripDepartmentRoles(member, reason) {
  const statusKeys = ['LAFD_MEMBER', 'FIRE_DIVISION', 'EMS_DIVISION', 'ON_DUTY', 'LEAVE_OF_ABSENCE', 'ADMIN_LEAVE', 'SUPERVISORY_TEAM'];
  const roleIds = [
    ...ALL_RANKS.map((r) => r.roleId),
    ...CERTIFICATIONS.map((c) => c.roleId),
    ...statusKeys.filter((k) => ROLE_SETTINGS[k]).map((k) => getRoleId(k)),
  ];
  return removeRoles(member, roleIds, reason);
}

/** Every guild member holding at least one configured rank role. Requires the Server Members intent. */
async function fetchRankedMembers(guild) {
  const rankRoleIds = ALL_RANKS.map((r) => r.roleId).filter(Boolean);
  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    console.warn(`[Members] Full member fetch failed (is the Server Members intent enabled?): ${err.message}`);
    members = guild.members.cache;
  }
  return members.filter((m) => !m.user.bot && rankRoleIds.some((id) => m.roles.cache.has(id)));
}

module.exports = { fetchMember, syncMemberRecord, roleLabel, addRoles, removeRoles, applyRank, stripDepartmentRoles, fetchRankedMembers };
