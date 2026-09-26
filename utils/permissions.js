/**
 * utils/permissions.js
 * -----------------------------------------------------------------------
 * Centralized permission checking. Every command should call
 * getPermissionLevel(member) and/or hasPermission(member, requiredLevel)
 * instead of checking roles directly. This is the ONE place permission
 * logic lives, so it stays easy to change later.
 * -----------------------------------------------------------------------
 */

const { ALL_RANKS, PERMISSION_LEVELS } = require('../config');

/**
 * Returns the highest permission level a GuildMember holds, based on
 * whichever configured rank role(s) they currently have.
 */
function getPermissionLevel(member) {
  let highest = PERMISSION_LEVELS.MEMBER;
  for (const rank of ALL_RANKS) {
    if (rank.roleId && member.roles.cache.has(rank.roleId)) {
      if (rank.level > highest) highest = rank.level;
    }
  }
  return highest;
}

/** Returns true if the member's permission level meets or exceeds requiredLevel. */
function hasPermission(member, requiredLevel) {
  return getPermissionLevel(member) >= requiredLevel;
}

/** Returns true if the member holds the Department Head level (Fire Chief / Medical Director). */
function isDepartmentHead(member) {
  return getPermissionLevel(member) >= PERMISSION_LEVELS.DEPARTMENT_HEAD;
}

module.exports = { getPermissionLevel, hasPermission, isDepartmentHead };
