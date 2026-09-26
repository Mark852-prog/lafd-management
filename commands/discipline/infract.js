/**
 * /infract <member> <type> <reason> [notes] [evidence]
 * -----------------------------------------------------------------------
 * Issues any of the seven LAFD infraction types. Suspension, Demotion,
 * and Termination require a Confirm/Cancel button before being finalized.
 *
 * NOTE: The "Demotion" infraction type here only creates a disciplinary
 * record. If the member's rank role should actually change, also run
 * /demote - the two are intentionally separate so a demotion can be
 * documented even when policy requires a delay before the role changes.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, getMemberRank, COLORS } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { infractionEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { upsertMember, addInfraction } = require('../../database/db');
const { logDiscipline } = require('../../utils/logger');

const INFRACTION_TYPES = ['Notice', 'Verbal Warning', 'Warning', 'Strike', 'Suspension', 'Demotion', 'Termination'];
const SERIOUS_TYPES = new Set(['Suspension', 'Demotion', 'Termination']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infract')
    .setDescription('Issue a disciplinary infraction to a member.')
    .addUserOption((opt) => opt.setName('member').setDescription('The member to discipline').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Infraction type')
        .setRequired(true)
        .addChoices(...INFRACTION_TYPES.map((t) => ({ name: t, value: t })))
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the infraction').setRequired(true))
    .addStringOption((opt) => opt.setName('notes').setDescription('Additional notes (optional)').setRequired(false))
    .addStringOption((opt) => opt.setName('evidence').setDescription('Evidence link/description (optional)').setRequired(false)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.INFRACTION_ISSUE)) {
      return replyNoPermission(interaction);
    }

    const targetUser = interaction.options.getUser('member');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason');
    const notes = interaction.options.getString('notes');
    const evidence = interaction.options.getString('evidence');

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return replyError(interaction, 'Could not find that member in this server.');
    }

    const rank = getMemberRank(targetMember);
    const rankName = rank ? rank.name : 'Unranked';
    const department = rank ? rank.department : 'N/A';

    const previewEmbed = infractionEmbed({
      member: targetMember,
      rankName,
      department,
      type,
      reason,
      notes,
      evidence,
      issuer: interaction.user,
    }).setDescription(SERIOUS_TYPES.has(type) ? '**Please confirm this action before it is finalized.**' : null);

    await interaction.deferReply({ ephemeral: true });

    if (SERIOUS_TYPES.has(type)) {
      const { confirmed, timedOut } = await requestConfirmation(interaction, previewEmbed);
      if (timedOut) {
        return interaction.editReply({ content: 'Confirmation timed out. No action was taken.', embeds: [], components: [] });
      }
      if (!confirmed) {
        return interaction.editReply({ content: 'Action cancelled.', embeds: [], components: [] });
      }
    }

    upsertMember({ discordId: targetMember.id, username: targetMember.user.username, department: rank?.department, rankRoleId: rank?.roleId });
    const record = addInfraction({ discordId: targetMember.id, issuerId: interaction.user.id, type, reason, notes, evidence });

    const finalEmbed = infractionEmbed({ member: targetMember, rankName, department, type, reason, notes, evidence, issuer: interaction.user });

    await interaction.editReply({ content: null, embeds: [finalEmbed], components: [] });

    await logDiscipline(interaction.guild, {
      action: `${type} Issued`,
      member: targetMember,
      staff: interaction.user,
      details: { 'Infraction ID': record.id, Reason: reason, Notes: notes, Evidence: evidence },
      color: SERIOUS_TYPES.has(type) ? COLORS.DANGER : COLORS.WARNING,
    });

    targetUser.send({ embeds: [finalEmbed] }).catch(() => {});
  },
};
