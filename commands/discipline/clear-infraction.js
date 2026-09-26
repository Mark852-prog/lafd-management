/**
 * /clear-infraction <infraction_id> <reason>
 * -----------------------------------------------------------------------
 * Marks an infraction as removed (soft delete - the record is kept for
 * audit purposes but flagged inactive). Requires confirmation.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, COLORS } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { getInfractionById, removeInfraction } = require('../../database/db');
const { logDiscipline } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear-infraction')
    .setDescription('Remove a disciplinary record. (Authorized management only)')
    .addIntegerOption((opt) => opt.setName('infraction_id').setDescription('The infraction ID (see /infractions)').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for removing this record').setRequired(true)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.INFRACTION_REMOVE)) {
      return replyNoPermission(interaction);
    }

    const infractionId = interaction.options.getInteger('infraction_id');
    const reason = interaction.options.getString('reason');

    const record = getInfractionById(infractionId);
    if (!record) {
      return replyError(interaction, `No infraction found with ID #${infractionId}.`);
    }
    if (!record.active) {
      return replyError(interaction, `Infraction #${infractionId} has already been removed.`);
    }

    await interaction.deferReply({ ephemeral: true });

    const previewEmbed = baseEmbed()
      .setColor(COLORS.WARNING)
      .setTitle('LAFD | Confirm Infraction Removal')
      .setDescription('**Please confirm this action before it is finalized.**')
      .addFields(
        { name: 'Infraction ID', value: `#${record.id}`, inline: true },
        { name: 'Member', value: `<@${record.discord_id}>`, inline: true },
        { name: 'Type', value: record.type, inline: true },
        { name: 'Original Reason', value: record.reason },
        { name: 'Removal Reason', value: reason }
      );

    const { confirmed, timedOut } = await requestConfirmation(interaction, previewEmbed);
    if (timedOut) {
      return interaction.editReply({ content: 'Confirmation timed out. No action was taken.', embeds: [], components: [] });
    }
    if (!confirmed) {
      return interaction.editReply({ content: 'Action cancelled.', embeds: [], components: [] });
    }

    removeInfraction(infractionId, interaction.user.id, reason);

    const resultEmbed = baseEmbed()
      .setColor(COLORS.SUCCESS)
      .setTitle('LAFD | Infraction Removed')
      .addFields(
        { name: 'Infraction ID', value: `#${record.id}`, inline: true },
        { name: 'Member', value: `<@${record.discord_id}>`, inline: true },
        { name: 'Removed By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Reason', value: reason }
      );

    await interaction.editReply({ content: null, embeds: [resultEmbed], components: [] });

    await logDiscipline(interaction.guild, {
      action: 'Infraction Removed',
      member: { id: record.discord_id },
      staff: interaction.user,
      details: { 'Infraction ID': record.id, 'Original Type': record.type, 'Removal Reason': reason },
    });
  },
};
