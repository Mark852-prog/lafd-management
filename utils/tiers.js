/**
 * utils/tiers.js
 * -----------------------------------------------------------------------
 * Permission tier role logic (see config/tiers.config.js). Used by
 * /setup-permissions and by events/guildMemberUpdate.js so a member's
 * tier roles always follow their rank roles.
 * -----------------------------------------------------------------------
 */

const { PermissionsBitField, PermissionFlagsBits, ChannelType } = require('discord.js');
const { ALL_RANKS, RANK_TIERS, STANDALONE_TIERS, CHANNEL_PERMISSIONS } = require('../config');

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

/**
 * Finds the channels a CHANNEL_PERMISSIONS entry applies to: the configured
 * channel/category, else a category whose name contains `match` (plus its
 * children), else every channel whose name contains `match`.
 */
function resolveConfiguredChannels(guild, entry) {
  const withChildren = (ch) =>
    ch.type === ChannelType.GuildCategory ? [ch, ...guild.channels.cache.filter((c) => c.parentId === ch.id).values()] : [ch];

  if (entry.channelId) {
    const ch = guild.channels.cache.get(entry.channelId);
    return ch ? withChildren(ch) : [];
  }
  const named = guild.channels.cache.filter((c) => !c.isThread() && c.name.toLowerCase().includes(entry.match));
  const category = named.find((c) => c.type === ChannelType.GuildCategory);
  return category ? withChildren(category) : [...named.values()];
}

// Every channel-level permission any tier uses. Channel overwrites deny whatever isn't allowed.
// (Manage Nicknames is server-only and can't be set per channel.)
const CHANNEL_PERMISSION_UNIVERSE = new PermissionsBitField([
  ...ALL_TIERS.flatMap((t) => t.permissions),
  ...CHANNEL_PERMISSIONS.flatMap((c) => Object.values(c.tiers).flat()),
]).remove(PermissionFlagsBits.ManageNicknames);

/**
 * Applies config/channel-permissions.config.js. Returns one result per
 * entry: { label, channels: [names], failures: [messages] }.
 */
async function applyChannelPermissions(guild, reason) {
  const results = [];
  for (const entry of CHANNEL_PERMISSIONS) {
    const channels = resolveConfiguredChannels(guild, entry);
    const failures = [];
    if (channels.length === 0) {
      failures.push(`no channel found (set ${entry.envKey} in .env, or name a channel/category "${entry.match}")`);
    }

    for (const channel of channels) {
      try {
        // Keep the bot able to see the channel before hiding it from @everyone.
        await channel.permissionOverwrites.edit(guild.members.me, { ViewChannel: true }, { reason });
        for (const [tierName, allowed] of Object.entries(entry.tiers)) {
          const role = findTierRole(guild, { name: tierName });
          if (!role) {
            failures.push(`${channel.name}: tier role "${tierName}" not found`);
            continue;
          }
          const allow = new PermissionsBitField(allowed);
          const options = {};
          for (const name of CHANNEL_PERMISSION_UNIVERSE.toArray()) options[name] = allow.has(PermissionFlagsBits[name]);
          await channel.permissionOverwrites.create(role, options, { reason });
        }
        if (entry.everyone === 'hidden') {
          await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, { reason });
        }
      } catch (err) {
        failures.push(`${channel.name}: ${err.message}`);
      }
    }
    results.push({ label: entry.label, channels: channels.map((c) => c.name), failures });
  }
  return results;
}

module.exports = {
  ALL_TIERS,
  findTierRole,
  getTierForRank,
  getMissingBotPermissions,
  ensureTierRoles,
  syncMemberTiers,
  applyChannelPermissions,
};
