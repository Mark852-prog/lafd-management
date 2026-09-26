/**
 * /demote <member> <new_rank> [reason]
 * -----------------------------------------------------------------------
 * Demotes a member to an existing (lower) rank role. Mirrors /promote's
 * logic - see that file for detailed comments. NEVER creates roles.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, ALL_RANKS, getMemberRank, getRankByRoleId } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { rankChangeEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { upsertMember, setMemberRank, addHistoryEntry } = require('../../database/db');
const { logManagement } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a member to a lower rank. (Authorized management only)')
    .addUserOption((opt) => opt.setName('member').setDescription('The member to demote').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('new_rank').setDescription('The new rank (start typing to search)').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason for the demotion').setRequired(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const targetUser = interaction.options.getUser('member');
    let candidateRanks = ALL_RANKS;

    if (targetUser) {
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (targetMember) {
        const currentRank = getMemberRank(targetMember);
        if (currentRank) candidateRanks = ALL_RANKS.filter((r) => r.department === currentRank.department);
      }
    }

    const choices = candidateRanks
      .filter((r) => r.roleId)
      .filter((r) => r.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((r) => ({ name: `${r.name} (${r.department})`, value: r.roleId }));

    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.PROMOTE_DEMOTE)) {
      return replyNoPermission(interaction);
    }

    const targetUser = interaction.options.getUser('member');
    const newRankRoleId = interaction.options.getString('new_rank');
    const reason = interaction.options.getString('reason');

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) return replyError(interaction, 'Could not find that member in this server.');

    const newRank = getRankByRoleId(newRankRoleId);
    if (!newRank) {
      return replyError(interaction, 'That rank is not recognized. Make sure the corresponding role ID is configured in .env.');
    }

    const oldRank = getMemberRank(targetMember);
    if (oldRank && oldRank.roleId === newRank.roleId) {
      return replyError(interaction, `${targetUser.username} already holds the rank of ${newRank.name}.`);
    }

    await interaction.deferReply({ ephemeral: true });

    const previewEmbed = rankChangeEmbed({
      type: 'DEMOTION',
      member: targetMember,
      department: newRank.department,
      oldRankName: oldRank ? oldRank.name : 'None',
      newRankName: newRank.name,
      assignment: 'N/A',
      reason,
      approvedBy: interaction.user,
    }).setDescription('**Please confirm this demotion before roles are changed.**');

    const { confirmed, timedOut } = await requestConfirmation(interaction, previewEmbed);
    if (timedOut) return interaction.editReply({ content: 'Confirmation timed out. No action was taken.', embeds: [], components: [] });
    if (!confirmed) return interaction.editReply({ content: 'Action cancelled.', embeds: [], components: [] });

    try {
      if (oldRank && oldRank.roleId) await targetMember.roles.remove(oldRank.roleId);
      await targetMember.roles.add(newRank.roleId);
    } catch (err) {
      console.error('Failed to update roles for demotion:', err);
      return interaction.editReply({
        content: 'Confirmed, but the bot could not update Discord roles. Check that its role is positioned above the rank roles.',
        embeds: [],
        components: [],
      });
    }

    setMemberRank(targetMember.id, newRank.department, newRank.roleId);
    upsertMember({ discordId: targetMember.id, username: targetMember.user.username, department: newRank.department, rankRoleId: newRank.roleId });
    addHistoryEntry({
      discordId: targetMember.id,
      actionType: 'DEMOTION',
      oldValue: oldRank ? oldRank.name : 'None',
      newValue: newRank.name,
      actorId: interaction.user.id,
      reason,
    });

    const finalEmbed = rankChangeEmbed({
      type: 'DEMOTION',
      member: targetMember,
      department: newRank.department,
      oldRankName: oldRank ? oldRank.name : 'None',
      newRankName: newRank.name,
      assignment: 'N/A',
      reason,
      approvedBy: interaction.user,
    });

    await interaction.editReply({ content: null, embeds: [finalEmbed], components: [] });

    await logManagement(interaction.guild, {
      action: 'Demotion',
      member: targetMember,
      staff: interaction.user,
      details: { 'Old Rank': oldRank ? oldRank.name : 'None', 'New Rank': newRank.name, Reason: reason },
    });

    targetUser.send({ embeds: [finalEmbed] }).catch(() => {});
  },
};
