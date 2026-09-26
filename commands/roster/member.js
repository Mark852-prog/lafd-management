/**
 * /member <user>
 * -----------------------------------------------------------------------
 * Shows a member's profile: rank, callsign, join date, duty status,
 * current shift, and promotion/demotion history. Disciplinary history is
 * ONLY included if the requester has DISCIPLINE_VIEW permission.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, getMemberRank, ICONS } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { baseEmbed } = require('../../utils/embeds');
const { upsertMember, getMember, getActiveShift, getHistory, getInfractions } = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription("View a member's LAFD profile.")
    .addUserOption((opt) => opt.setName('user').setDescription('The member to look up').setRequired(true)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
    }

    const rank = getMemberRank(targetMember);
    upsertMember({
      discordId: targetMember.id,
      username: targetMember.user.username,
      department: rank ? rank.department : null,
      rankRoleId: rank ? rank.roleId : null,
    });
    const record = getMember(targetMember.id);
    const activeShift = getActiveShift(targetMember.id);
    const history = getHistory(targetMember.id, 5).filter((h) => h.action_type === 'PROMOTION' || h.action_type === 'DEMOTION');

    const embed = baseEmbed()
      .setColor(rank?.department === 'FIRE' ? 0xc0392b : rank?.department === 'EMS' ? 0x1f6fb2 : 0x2c3440)
      .setTitle(`${ICONS.BADGE} LAFD | Member Profile`)
      .addFields(
        { name: 'Username', value: `<@${targetMember.id}>`, inline: true },
        { name: 'Rank', value: rank ? rank.name : 'Unranked', inline: true },
        { name: 'Department', value: rank ? rank.department : 'N/A', inline: true },
        { name: 'Callsign', value: record?.callsign || 'Not Assigned', inline: true },
        { name: 'Duty Status', value: activeShift ? '🟢 On Duty' : '⚪ Off Duty', inline: true },
        { name: 'Joined', value: record ? `<t:${Math.floor(new Date(record.join_date).getTime() / 1000)}:D>` : 'Unknown', inline: true }
      );

    if (activeShift) {
      embed.addFields({
        name: 'Current Shift',
        value: `Started <t:${Math.floor(new Date(activeShift.start_time).getTime() / 1000)}:R>`,
      });
    }

    if (history.length > 0) {
      embed.addFields({
        name: 'Recent Promotions / Demotions',
        value: history
          .map((h) => `${h.action_type === 'PROMOTION' ? '⬆️' : '⬇️'} ${h.old_value || 'N/A'} → ${h.new_value} (<t:${Math.floor(new Date(h.created_at).getTime() / 1000)}:d>)`)
          .join('\n'),
      });
    }

    // Disciplinary history is private - only shown to authorized management.
    if (hasPermission(interaction.member, REQUIRED_LEVEL.DISCIPLINE_VIEW)) {
      const infractions = getInfractions(targetMember.id, false);
      embed.addFields({
        name: `Disciplinary Record (${infractions.length} active)`,
        value: infractions.length > 0 ? 'Use /infractions for full details.' : 'No active disciplinary records.',
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
