/**
 * events/guildMemberUpdate.js
 * -----------------------------------------------------------------------
 * Keeps permission tier roles in sync with rank roles. Fires on /promote,
 * /demote, and manual role edits. syncMemberTiers is a no-op when nothing
 * needs to change, so the update caused by the sync itself doesn't loop.
 * Does nothing until /setup-permissions has created the tier roles.
 * -----------------------------------------------------------------------
 */

const { Events } = require('discord.js');
const { ALL_RANKS } = require('../config');
const { syncMemberTiers } = require('../utils/tiers');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (newMember.user.bot) return;

    // Skip unrelated updates (nicknames, etc.) when we can tell nothing rank-related changed.
    if (!oldMember.partial) {
      const rankChanged = ALL_RANKS.some((r) => r.roleId && oldMember.roles.cache.has(r.roleId) !== newMember.roles.cache.has(r.roleId));
      if (!rankChanged) return;
    }

    try {
      await syncMemberTiers(newMember);
    } catch (err) {
      console.warn(`[Tiers] Failed to sync tier roles for ${newMember.user.username}:`, err.message);
    }
  },
};
