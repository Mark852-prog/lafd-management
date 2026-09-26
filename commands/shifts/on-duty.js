/**
 * /on-duty
 * -----------------------------------------------------------------------
 * Shows every member currently on an active shift.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { getRankByRoleId, ICONS } = require('../../config');
const { baseEmbed } = require('../../utils/embeds');
const { getAllActiveShifts, getMember } = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder().setName('on-duty').setDescription('View members currently on duty.'),

  async execute(interaction) {
    const activeShifts = getAllActiveShifts();

    const embed = baseEmbed().setColor(0x2c3440).setTitle(`${ICONS.SHIFT} LAFD | Currently On Duty`);

    if (activeShifts.length === 0) {
      embed.setDescription('No members are currently on duty.');
    } else {
      const lines = activeShifts.map((shift) => {
        const record = getMember(shift.discord_id);
        const rank = record?.rank_role_id ? getRankByRoleId(record.rank_role_id) : null;
        const dept = record?.department ? (record.department === 'FIRE' ? `${ICONS.FIRE} Fire` : `${ICONS.EMS} EMS`) : 'N/A';
        const startedTs = Math.floor(new Date(shift.start_time).getTime() / 1000);
        return `**<@${shift.discord_id}>** - ${rank ? rank.name : 'Unranked'} | ${dept} | Callsign: ${
          record?.callsign || 'N/A'
        } | Since <t:${startedTs}:R>`;
      });
      embed.setDescription(lines.join('\n'));
    }

    return interaction.reply({ embeds: [embed] });
  },
};
