/**
 * /warn <member> <reason>
 * -----------------------------------------------------------------------
 * Shortcut for issuing a formal "Warning" infraction (distinct from
 * "Verbal Warning", which must be issued via /infract type:Verbal Warning).
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, getMemberRank } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission } = require('../../utils/replies');
const { infractionEmbed } = require('../../utils/embeds');
const { upsertMember, addInfraction } = require('../../database/db');
const { logDiscipline } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a formal Warning to a member. (Shortcut for /infract type:Warning)')
    .addUserOption((opt) => opt.setName('member').setDescription('The member to warn').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the warning').setRequired(true)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.INFRACTION_ISSUE)) {
      return replyNoPermission(interaction);
    }

    const targetUser = interaction.options.getUser('member');
    const reason = interaction.options.getString('reason');

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
    }

    const rank = getMemberRank(targetMember);
    upsertMember({ discordId: targetMember.id, username: targetMember.user.username, department: rank?.department, rankRoleId: rank?.roleId });

    const record = addInfraction({ discordId: targetMember.id, issuerId: interaction.user.id, type: 'Warning', reason });

    const embed = infractionEmbed({
      member: targetMember,
      rankName: rank ? rank.name : 'Unranked',
      department: rank ? rank.department : 'N/A',
      type: 'Warning',
      reason,
      issuer: interaction.user,
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });

    await logDiscipline(interaction.guild, {
      action: 'Warning Issued',
      member: targetMember,
      staff: interaction.user,
      details: { 'Infraction ID': record.id, Reason: reason },
    });

    targetUser.send({ embeds: [embed] }).catch(() => {
      /* DMs may be closed - fail silently */
    });
  },
};
