/**
 * /shift start
 * /shift end
 * -----------------------------------------------------------------------
 * Members track their own shifts. Only one active shift per member is
 * allowed at a time.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { getMemberRank } = require('../../config');
const { shiftStartedEmbed, shiftEndedEmbed, errorEmbed } = require('../../utils/embeds');
const { upsertMember, getMember, getActiveShift, startShift, endShift, setDutyStatus } = require('../../database/db');
const { logShifts } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Start or end your LAFD shift.')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a shift.'))
    .addSubcommand((sub) => sub.setName('end').setDescription('End your active shift.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const rank = getMemberRank(member);

    upsertMember({ discordId: member.id, username: member.user.username, department: rank?.department, rankRoleId: rank?.roleId });

    if (sub === 'start') {
      const existing = getActiveShift(member.id);
      if (existing) {
        return interaction.reply({
          embeds: [errorEmbed('You are already on an active shift. Use `/shift end` before starting a new one.')],
          ephemeral: true,
        });
      }

      const shift = startShift(member.id);
      setDutyStatus(member.id, 'ON_DUTY');

      const record = getMember(member.id);
      const embed = shiftStartedEmbed({
        member,
        rankName: rank ? rank.name : 'Unranked',
        callsign: record?.callsign,
        startTime: new Date(shift.startTime),
      });

      await interaction.reply({ embeds: [embed] });
      await logShifts(interaction.guild, { action: 'Shift Started', member, staff: interaction.user, details: {} });
      return;
    }

    if (sub === 'end') {
      const active = getActiveShift(member.id);
      if (!active) {
        return interaction.reply({
          embeds: [errorEmbed('You do not have an active shift. Use `/shift start` first.')],
          ephemeral: true,
        });
      }

      const finished = endShift(member.id);
      setDutyStatus(member.id, 'OFF_DUTY');

      const embed = shiftEndedEmbed({
        member,
        startTime: new Date(finished.start_time),
        endTime: new Date(finished.end_time),
        durationSeconds: finished.duration_seconds,
      });

      await interaction.reply({ embeds: [embed] });
      await logShifts(interaction.guild, {
        action: 'Shift Ended',
        member,
        staff: interaction.user,
        details: { 'Duration (seconds)': finished.duration_seconds },
      });
    }
  },
};
