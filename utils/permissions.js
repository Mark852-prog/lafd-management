/**
 * utils/permissions.js
 * -----------------------------------------------------------------------
 * Centralized permission and chain-of-command checks. Commands should use
 * these helpers instead of checking roles directly.
 * -----------------------------------------------------------------------
 */

const { PermissionFlagsBits } = require('discord.js');
const {
  ALL_RANKS,
  ROLE_SETTINGS,
  PERMISSION_LEVELS,
  BOT_OWNER_IDS,
  getRoleId,
  getMemberRank,
  getMemberRankIn,
} = require('../config');

/** Highest permission level the member holds (ranks + level-granting roles + owner override). */
function getPermissionLevel(member) {
  if (!member) return PERMISSION_LEVELS.MEMBER;
  if (member.guild?.ownerId === member.id || BOT_OWNER_IDS.includes(member.id)) return PERMISSION_LEVELS.BOT_OWNER;

  let highest = PERMISSION_LEVELS.MEMBER;
  for (const rank of ALL_RANKS) {
    if (rank.level > highest && rank.roleId && member.roles.cache.has(rank.roleId)) highest = rank.level;
  }
  for (const [key, def] of Object.entries(ROLE_SETTINGS)) {
    if (!def.level || def.level <= highest) continue;
    const roleId = getRoleId(key);
    if (roleId && member.roles.cache.has(roleId)) highest = def.level;
  }
  return highest;
}

function hasPermission(member, requiredLevel) {
  return getPermissionLevel(member) >= requiredLevel;
}

function isServerAdmin(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

/**
 * Chain-of-command check: can `actor` take a staff action on `target`?
 * Returns null when allowed, otherwise a human-readable reason.
 */
function checkAuthorityOver(actor, target) {
  if (actor.id === target.id) return 'You cannot take this action on yourself.';
  if (target.user?.bot) return 'That is a bot account.';

  const actorLevel = getPermissionLevel(actor);
  const targetLevel = getPermissionLevel(target);
  if (actorLevel >= PERMISSION_LEVELS.BOT_OWNER) return null;
  if (targetLevel >= PERMISSION_LEVELS.BOT_OWNER) return 'You cannot take this action on the server owner.';
  if (actorLevel > targetLevel) return null;

  if (actorLevel === targetLevel) {
    const actorRank = getMemberRank(actor);
    const targetRank = getMemberRank(target);
    if (actorRank && targetRank && actorRank.department === targetRank.department && actorRank.order > targetRank.order) {
      return null;
    }
  }
  return 'You can only take this action on members ranked below you in the chain of command.';
}

/**
 * Can `actor` place someone into `rank`? Staff can only assign ranks below
 * their own authority. Returns null when allowed, otherwise a reason.
 */
function checkCanAssignRank(actor, rank) {
  const actorLevel = getPermissionLevel(actor);
  if (actorLevel >= PERMISSION_LEVELS.BOT_OWNER) return null;
  if (rank.level < actorLevel) return null;

  const ownRank = getMemberRankIn(actor, rank.department);
  if (ownRank && rank.order < ownRank.order && rank.level <= actorLevel) return null;
  return `You cannot assign **${rank.name}** - it is at or above your own authority.`;
}

module.exports = { getPermissionLevel, hasPermission, isServerAdmin, checkAuthorityOver, checkCanAssignRank };
