/**
 * /setup-permissions
 * -----------------------------------------------------------------------
 * One-shot setup of the Discord permission tier roles defined in
 * config/tiers.config.js:
 *   1. Creates any missing tier role (FIRE — COMMAND STAFF, EMS — LOW RANK,
 *      VERIFIED, etc.) and sets every tier role's permissions to EXACTLY
 *      the configured list.
 *   2. Applies per-channel tier access (config/channel-permissions.config.js),
 *      e.g. the Training channel/category.
 *   3. Gives every member the tier role matching their rank and removes
 *      tier roles they shouldn't have.
 *
 * Safe to re-run any time (e.g. after editing tiers.config.js). After the
 * first run, events/guildMemberUpdate.js keeps tiers in sync automatically.
 * Never touches rank roles or server-wide @everyone permissions, and only
 * changes overwrites on the channels listed in channel-permissions.config.js.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, ALL_RANKS, RANK_TIERS, STANDALONE_TIERS, CHANNEL_PERMISSIONS, COLORS } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyError } = require('../../utils/replies');
const { successEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { getMissingBotPermissions, ensureTierRoles, syncMemberTiers, applyChannelPermissions } = require('../../utils/tiers');
const { logManagement } = require('../../utils/logger');

const AUDIT_REASON = 'LAFD Management /setup-permissions';

function rankNames(tier) {
  return tier.ranks.map((key) => ALL_RANKS.find((r) => r.department === tier.department && r.key === key)?.name || key).join(', ');
}

function tierList(department) {
  return RANK_TIERS.filter((t) => t.department === department)
    .map((t) => `**${t.name}** — ${rankNames(t)}`)
    .join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-permissions')
    .setDescription('Create/update permission tier roles and sync them to every member. (Department Head only)'),

  async execute(interaction) {
    // Acknowledge right away so Discord never shows "The application did not respond".
    await interaction.deferReply({ ephemeral: true });

    if (!hasPermission(interaction.member, REQUIRED_LEVEL.SETUP_PERMISSIONS)) {
      return replyError(interaction, 'You do not have the required LAFD rank/permissions to use this command. (Fire Chief or Medical Director only.)');
    }

    const missing = getMissingBotPermissions(interaction.guild);
    if (missing.length > 0) {
      return replyError(
        interaction,
        'The bot is missing permissions it needs to grant to the tier roles (Discord only lets a bot give out permissions it has):\n' +
          missing.map((p) => `• ${p}`).join('\n') +
          '\n\nEasiest fix: Server Settings → Roles → the bot\'s role → turn on **Administrator**.'
      );
    }

    const preview = successEmbed(
      'LAFD | Setup Permission Tiers',
      '**Please confirm.** This will create any missing tier roles, set their permissions to exactly the department policy, ' +
        'and give every member the tier role matching their rank (removing tier roles that don\'t match).'
    )
      .setColor(COLORS.WARNING)
      .addFields(
        { name: '🔥 Fire Tiers', value: tierList('FIRE') },
        { name: '🚑 EMS Tiers', value: tierList('EMS') },
        { name: 'Other', value: STANDALONE_TIERS.map((t) => `**${t.name}** — permissions only, not auto-assigned`).join('\n') },
        { name: 'Channel Access', value: CHANNEL_PERMISSIONS.map((c) => `**${c.label}** — per-tier overrides; hidden from everyone else`).join('\n') }
      );

    const { confirmed, timedOut } = await requestConfirmation(interaction, preview, 60000);
    if (timedOut) return interaction.editReply({ content: 'Confirmation timed out. No action was taken.', embeds: [], components: [] });
    if (!confirmed) return interaction.editReply({ content: 'Action cancelled.', embeds: [], components: [] });

    await interaction.editReply({ content: 'Setting up tier roles and syncing members... this can take a minute.', embeds: [], components: [] });

    // Step 1: roles
    const roleResults = await ensureTierRoles(interaction.guild, AUDIT_REASON);
    const count = (status) => roleResults.filter((r) => r.status === status).length;
    const roleFailures = roleResults.filter((r) => r.status === 'failed');

    // Step 2: channel overrides
    const channelResults = await applyChannelPermissions(interaction.guild, AUDIT_REASON);
    const channelFailures = channelResults.flatMap((c) => c.failures.map((f) => `${c.label}: ${f}`));

    // Step 3: members
    let membersChanged = 0;
    const memberFailures = [];
    try {
      const members = await interaction.guild.members.fetch();
      for (const member of members.values()) {
        if (member.user.bot) continue;
        try {
          const { added, removed } = await syncMemberTiers(member, AUDIT_REASON);
          if (added.length || removed.length) membersChanged++;
        } catch (err) {
          memberFailures.push(`${member.user.username}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('Failed to fetch members for tier sync:', err);
      memberFailures.push(`Could not fetch members (${err.message}). Is the Server Members Intent enabled in the Developer Portal?`);
    }

    const lines = [
      `**Roles:** ${count('created')} created, ${count('updated')} updated, ${count('unchanged')} already correct, ${roleFailures.length} failed.`,
      ...channelResults.map((c) => `**${c.label} access:** ${c.channels.length ? c.channels.map((n) => `#${n}`).join(', ') : 'no channel found'}`),
      `**Members:** ${membersChanged} member(s) had tier roles updated.`,
    ];
    if (roleFailures.length) {
      lines.push('', '**Role failures:**', ...roleFailures.map((r) => `• ${r.tier.name}: ${r.error}`));
    }
    if (channelFailures.length) {
      lines.push('', '**Channel failures:**', ...channelFailures.slice(0, 10).map((f) => `• ${f}`));
    }
    if (memberFailures.length) {
      lines.push('', `**Member failures (${memberFailures.length}):**`, ...memberFailures.slice(0, 10).map((m) => `• ${m}`));
      if (memberFailures.length > 10) lines.push(`• …and ${memberFailures.length - 10} more (see console).`);
      console.warn('[setup-permissions] Member sync failures:', memberFailures);
    }

    const ok = roleFailures.length === 0 && channelFailures.length === 0 && memberFailures.length === 0;
    const summary = successEmbed(ok ? 'LAFD | Permission Tiers Ready' : 'LAFD | Permission Tiers Set Up With Errors', lines.join('\n'));
    if (!ok) summary.setColor(COLORS.WARNING);
    await interaction.editReply({ content: null, embeds: [summary], components: [] });

    await logManagement(interaction.guild, {
      action: 'Permission Tiers Set Up',
      member: null,
      staff: interaction.user,
      details: {
        Roles: `${count('created')} created, ${count('updated')} updated, ${roleFailures.length} failed`,
        Channels: `${channelResults.reduce((n, c) => n + c.channels.length, 0)} updated, ${channelFailures.length} failed`,
        Members: `${membersChanged} updated, ${memberFailures.length} failed`,
      },
    });
  },
};
