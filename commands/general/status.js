/**
 * /status
 * -----------------------------------------------------------------------
 * Bot health + a quick department snapshot.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { COLORS, CHANNEL_SETTINGS, ROLE_SETTINGS, ALL_RANKS, getChannelId, getRoleId } = require('../../config');
const { getAllActiveShifts, getLeavesByStatus, getDatabaseStats } = require('../../database/db');
const { baseEmbed, addField } = require('../../utils/embeds');
const { formatDuration } = require('../../utils/format');
const { version } = require('../../package.json');

module.exports = {
  category: 'General',
  data: new SlashCommandBuilder().setName('status').setDescription('Check the bot is online and see a department snapshot.'),

  async execute(interaction) {
    const started = Date.now();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roundTrip = Date.now() - started;

    const stats = getDatabaseStats();
    const channelsSet = Object.keys(CHANNEL_SETTINGS).filter((k) => getChannelId(k)).length;
    const rolesSet = Object.keys(ROLE_SETTINGS).filter((k) => getRoleId(k)).length;
    const ranksSet = ALL_RANKS.filter((r) => r.roleId).length;

    const embed = baseEmbed({ color: COLORS.SUCCESS, title: '🟢 LAFD Management is Online' });
    addField(embed, 'Gateway Ping', `${Math.max(0, Math.round(interaction.client.ws.ping))}ms`, true);
    addField(embed, 'Response Time', `${roundTrip}ms`, true);
    addField(embed, 'Uptime', formatDuration(process.uptime()), true);
    addField(embed, 'On Duty Now', String(getAllActiveShifts().length), true);
    addField(embed, 'On Leave', String(getLeavesByStatus(['ACTIVE']).length), true);
    addField(embed, 'Active Infractions', String(stats.infractions), true);
    addField(embed, 'Records', `${stats.members} members • ${stats.shifts} shifts • ${stats.incidents} incidents • ${stats.events} events`);
    addField(
      embed,
      'Configuration',
      `Ranks ${ranksSet}/${ALL_RANKS.length} • Roles ${rolesSet}/${Object.keys(ROLE_SETTINGS).length} • Channels ${channelsSet}/${Object.keys(CHANNEL_SETTINGS).length}\nRun \`/config check\` for details.`
    );
    embed.setFooter({ text: `LAFD Management v${version} • discord.js ${require('discord.js').version}` });

    return interaction.editReply({ embeds: [embed] });
  },
};
