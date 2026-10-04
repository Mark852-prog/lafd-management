/**
 * utils/tiers.js
 * -----------------------------------------------------------------------
 * Permission tier role logic (see config/tiers.config.js). Used by
 * /setup-permissions and by events/guildMemberUpdate.js so a member's
 * tier roles always follow their rank roles.
 * -----------------------------------------------------------------------
 */

const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { ALL_RANKS, RANK_TIERS, STANDALONE_TIERS } = require('../config');

const ALL_TIERS = [...RANK_TIERS, ...STANDALONE_TIERS];

/** Finds the existing Discord role for a tier by name (case-insensitive). */
function findTierRole(guild, tier) {
  const target = tier.name.toLowerCase();
  return guild.roles.cache.find((r) => r.name.toLowerCase() === target) || null;
}

/** Returns the tier a rank belongs to, or null. */
function getTierForRank(rank) {
  return RANK_TIERS.find((t) => t.department === rank.department && t.ranks.includes(rank.key)) || null;
}

/**
 * Permissions the bot itself is missing. Discord only lets a bot grant
 * permissions it holds, so every permission used by any tier is required.
 */
function getMissingBotPermissions(guild) {
  const needed = new PermissionsBitField([PermissionFlagsBits.ManageRoles, ...ALL_TIERS.flatMap((t) => t.permissions)]);
  return guild.members.me.permissions.missing(needed);
}

/**
 * Creates any missing tier roles and sets every tier role's permissions to
 * exactly what's configured. Returns a per-tier result list.
 */
async function ensureTierRoles(guild, reason) {
  const results = [];
  for (const tier of ALL_TIERS) {
    const permissions = new PermissionsBitField(tier.permissions);
    const existing = findTierRole(guild, tier);
    try {
      if (!existing) {
        await guild.roles.create({ name: tier.name, permissions, mentionable: false, hoist: false, reason });
        results.push({ tier, status: 'created' });
      } else if (!existing.editable) {
        results.push({ tier, status: 'failed', error: 'role is above the bot\'s highest role' });
      } else if (existing.permissions.bitfield !== permissions.bitfield) {
        await existing.setPermissions(permissions, reason);
        results.push({ tier, status: 'updated' });
      } else {
        results.push({ tier, status: 'unchanged' });
      }
    } catch (err) {
      results.push({ tier, status: 'failed', error: err.message });
    }
  }
  return results;
}

/**
 * Gives a member the tier role(s) matching the rank roles they hold and
 * removes any other rank-based tier roles. Standalone tiers (VERIFIED) are
 * never touched. Safe to call repeatedly - makes no API calls if nothing
 * needs to change. Returns { added, removed } as arrays of role names.
 */
async function syncMemberTiers(member, reason = 'LAFD tier sync') {
  const guild = member.guild;
  const desiredIds = new Set();
  for (const rank of ALL_RANKS) {
    if (!rank.roleId || !member.roles.cache.has(rank.roleId)) continue;
    const tier = getTierForRank(rank);
    const role = tier && findTierRole(guild, tier);
    if (role) desiredIds.add(role.id);
  }

  const toAdd = [];
  const toRemove = [];
  for (const tier of RANK_TIERS) {
    const role = findTierRole(guild, tier);
    if (!role || !role.editable) continue;
    const has = member.roles.cache.has(role.id);
    if (desiredIds.has(role.id) && !has) toAdd.push(role);
    if (!desiredIds.has(role.id) && has) toRemove.push(role);
  }

  if (toAdd.length || toRemove.length) {
    // One PATCH with the final role list, so add/remove can't race each other.
    const removeIds = new Set(toRemove.map((r) => r.id));
    const finalIds = [...member.roles.cache.keys()].filter((id) => id !== guild.id && !removeIds.has(id));
    await member.roles.set([...finalIds, ...toAdd.map((r) => r.id)], reason);
  }
  return { added: toAdd.map((r) => r.name), removed: toRemove.map((r) => r.name) };
}

module.exports = { ALL_TIERS, findTierRole, getTierForRank, getMissingBotPermissions, ensureTierRoles, syncMemberTiers };
