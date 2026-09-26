/**
 * /roster
 * -----------------------------------------------------------------------
 * Displays all known members (anyone the bot has seen via a command or
 * role sync) with rank, callsign, department, and duty status. Paginated
 * with buttons instead of one giant embed.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getRankByRoleId, ICONS } = require('../../config');
const { baseEmbed } = require('../../utils/embeds');
const { getAllMembers } = require('../../database/db');

const PAGE_SIZE = 10;

function buildRosterEmbed(members, page, totalPages) {
  const embed = baseEmbed().setColor(0x2c3440).setTitle(`${ICONS.ROSTER} LAFD | Department Roster`);

  const pageMembers = members.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  if (pageMembers.length === 0) {
    embed.setDescription('No members on file yet.');
  } else {
    const lines = pageMembers.map((m) => {
      const rank = m.rank_role_id ? getRankByRoleId(m.rank_role_id) : null;
      const rankName = rank ? rank.name : 'Unranked';
      const dept = m.department ? (m.department === 'FIRE' ? `${ICONS.FIRE} Fire` : `${ICONS.EMS} EMS`) : 'N/A';
      const duty = m.duty_status === 'ON_DUTY' ? '🟢 On Duty' : '⚪ Off Duty';
      return `**<@${m.discord_id}>** - ${rankName} | ${dept} | Callsign: ${m.callsign || 'N/A'} | ${duty}`;
    });
    embed.setDescription(lines.join('\n'));
  }

  embed.setFooter({ text: `Page ${page + 1} of ${totalPages} | Los Angeles Fire Department | LAFD Management` });
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder().setName('roster').setDescription('View the LAFD department roster.'),

  async execute(interaction) {
    const members = getAllMembers();
    const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
    let page = 0;

    const buildRow = (currentPage) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roster_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('roster_next')
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      );

    const message = await interaction.reply({
      embeds: [buildRosterEmbed(members, page, totalPages)],
      components: totalPages > 1 ? [buildRow(page)] : [],
      fetchReply: true,
    });

    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 120000,
    });

    collector.on('collect', async (i) => {
      if (i.customId === 'roster_prev') page = Math.max(0, page - 1);
      if (i.customId === 'roster_next') page = Math.min(totalPages - 1, page + 1);
      await i.update({ embeds: [buildRosterEmbed(members, page, totalPages)], components: [buildRow(page)] });
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
