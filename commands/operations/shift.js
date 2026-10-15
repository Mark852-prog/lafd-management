/**
 * /shift start | end | status | active | force-end
 * -----------------------------------------------------------------------
 * Duty tracking. Starting a shift gives the On Duty role (if configured);
 * ending removes it. Shifts that run past SHIFT_MAX_HOURS are closed
 * automatically. Members on leave, suspended or terminated can't clock in.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, POLICY, DEPARTMENTS, getMemberRank } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed, addField, departmentColor } = require('../../utils/embeds');
const { fetchMember, syncMemberRecord } = require('../../utils/members');
const { ts, formatDuration, toHours, progressBar, periodStart } = require('../../utils/format');
const { startMemberShift, endMemberShift } = require('../../services/shifts');
const { LEAVE_TYPES } = require('../../services/leave');

function weekLine(discordId) {
  const week = db.getShiftStats(discordId, periodStart('7d'));
  const hours = toHours(week.seconds);
  const met = hours >= POLICY.WEEKLY_QUOTA_HOURS;
  return `${progressBar(hours, POLICY.WEEKLY_QUOTA_HOURS)} **${hours}h / ${POLICY.WEEKLY_QUOTA_HOURS}h** this week ${met ? '✅' : ''}`;
}

module.exports = {
  category: 'Operations',
  level: REQUIRED_LEVEL.SHIFT_SELF,
  levels: {
    start: REQUIRED_LEVEL.SHIFT_SELF,
    end: REQUIRED_LEVEL.SHIFT_SELF,
    status: REQUIRED_LEVEL.SHIFT_SELF,
    active: REQUIRED_LEVEL.ON_DUTY_VIEW,
    'force-end': REQUIRED_LEVEL.SHIFT_MANAGE,
  },
  data: new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Clock in and out of duty.')
    .addSubcommand((s) => s.setName('start').setDescription('Go on duty.'))
    .addSubcommand((s) => s.setName('end').setDescription('Go off duty.'))
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Your current shift and weekly hours (or another member’s).')
        .addUserOption((o) => o.setName('member').setDescription('Member (officers only)'))
    )
    .addSubcommand((s) => s.setName('active').setDescription('See who is on duty right now.'))
    .addSubcommand((s) =>
      s
        .setName('force-end')
        .setDescription("End another member's shift.")
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(300))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') return start(interaction);
    if (sub === 'end') return end(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'active') return active(interaction);
    if (sub === 'force-end') return forceEnd(interaction);
  },
};

async function start(interaction) {
  const member = interaction.member;
  const rank = getMemberRank(member);
  if (!rank) return replyError(interaction, 'Only LAFD members with a rank can go on duty.');

  const record = syncMemberRecord(member);
  if (record.status === 'TERMINATED') return replyError(interaction, 'Your department record is marked as terminated. Contact command staff.');
  const suspension = db.getActiveSuspension(member.id);
  if (suspension) return replyError(interaction, `You are suspended${suspension.expires_at ? ` until ${ts(suspension.expires_at, 'f')}` : ''} and cannot go on duty.`);
  const leave = db.getActiveLeave(member.id);
  if (leave) {
    return replyError(
      interaction,
      leave.type === 'ADMIN'
        ? 'You are on administrative leave and cannot go on duty.'
        : `You are on a leave of absence. End it with \`/leave end\` before going on duty.`
    );
  }
  const existing = db.getActiveShift(member.id);
  if (existing) return replyError(interaction, `You have been on duty since ${ts(existing.start_time, 'R')}. Use \`/shift end\` first.`);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const shift = await startMemberShift(member);

  const embed = baseEmbed({ color: COLORS.SUCCESS, title: `${ICONS.ON} On Duty` });
  addField(embed, 'Member', `<@${member.id}>`, true);
  addField(embed, 'Rank', rank.name, true);
  addField(embed, 'Callsign', record.callsign ? `\`${record.callsign}\`` : 'Not assigned', true);
  addField(embed, 'Started', ts(shift.start_time, 't'), true);
  addField(embed, 'Auto-ends After', `${POLICY.MAX_SHIFT_HOURS}h`, true);
  addField(embed, 'Weekly Quota', weekLine(member.id));
  return interaction.editReply({ embeds: [embed] });
}

async function end(interaction) {
  if (!db.getActiveShift(interaction.user.id)) return replyError(interaction, 'You are not on duty. Use `/shift start` first.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const finished = await endMemberShift(interaction.guild, interaction.user.id, { endedBy: interaction.user });

  const embed = baseEmbed({ color: COLORS.NEUTRAL, title: `${ICONS.OFF} Off Duty` });
  addField(embed, 'Shift Length', `**${formatDuration(finished.duration_seconds)}**`, true);
  addField(embed, 'Started', ts(finished.start_time, 't'), true);
  addField(embed, 'Ended', ts(finished.end_time, 't'), true);
  addField(embed, 'Weekly Quota', weekLine(interaction.user.id));
  return interaction.editReply({ embeds: [embed] });
}

async function status(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  if (user.id !== interaction.user.id && !hasPermission(interaction.member, REQUIRED_LEVEL.ACTIVITY_OTHERS)) {
    return replyNoPermission(interaction, REQUIRED_LEVEL.ACTIVITY_OTHERS);
  }
  const shift = db.getActiveShift(user.id);
  const recent = db.getShiftHistory(user.id, 5);
  const leave = db.getActiveLeave(user.id);

  const embed = baseEmbed({ color: shift ? COLORS.SUCCESS : COLORS.NEUTRAL, title: `${ICONS.SHIFT} Shift Status • ${user.username}` });
  addField(
    embed,
    'Current',
    shift
      ? `${ICONS.ON} On duty for **${formatDuration((Date.now() - new Date(shift.start_time)) / 1000)}** (since ${ts(shift.start_time, 't')})`
      : leave
        ? `${ICONS.AWAY} ${LEAVE_TYPES[leave.type].name}`
        : `${ICONS.OFF} Off duty`
  );
  addField(embed, 'Weekly Quota', weekLine(user.id));
  addField(
    embed,
    'Recent Shifts',
    recent.length
      ? recent.map((s) => `• ${ts(s.start_time, 'd')} ${ts(s.start_time, 't')} — **${formatDuration(s.duration_seconds)}**${s.end_reason ? ` _(${s.end_reason})_` : ''}`).join('\n')
      : 'None yet'
  );
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function active(interaction) {
  const shifts = db.getAllActiveShifts();
  const embed = baseEmbed({ color: COLORS.BRAND, title: `${ICONS.SHIFT} On Duty Now • ${shifts.length} member(s)` });

  if (!shifts.length) {
    embed.setDescription('Nobody is on duty right now.');
    return interaction.reply({ embeds: [embed] });
  }

  const groups = { FIRE: [], EMS: [], OTHER: [] };
  for (const shift of shifts) {
    const record = db.getMember(shift.discord_id);
    const line = `${ICONS.ON} <@${shift.discord_id}>${record?.callsign ? ` · \`${record.callsign}\`` : ''} · ${formatDuration((Date.now() - new Date(shift.start_time)) / 1000)}`;
    (groups[record?.department] || groups.OTHER).push(line);
  }
  for (const [key, lines] of Object.entries(groups)) {
    if (!lines.length) continue;
    const label = DEPARTMENTS[key] ? `${key === 'FIRE' ? ICONS.FIRE : ICONS.EMS} ${DEPARTMENTS[key].name}` : 'Other';
    addField(embed, `${label} (${lines.length})`, lines.join('\n').slice(0, 1024));
  }
  if (groups.FIRE.length && !groups.EMS.length) embed.setColor(departmentColor('FIRE'));
  if (groups.EMS.length && !groups.FIRE.length) embed.setColor(departmentColor('EMS'));
  return interaction.reply({ embeds: [embed] });
}

async function forceEnd(interaction) {
  if (!hasPermission(interaction.member, REQUIRED_LEVEL.SHIFT_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.SHIFT_MANAGE);
  const user = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason');
  const target = await fetchMember(interaction.guild, user.id);
  if (target) {
    const authorityError = checkAuthorityOver(interaction.member, target);
    if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');
  }
  if (!db.getActiveShift(user.id)) return replyError(interaction, `${user} is not on duty.`);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const finished = await endMemberShift(interaction.guild, user.id, { endedBy: interaction.user, reason: `Force-ended: ${reason}` });
  return interaction.editReply({
    embeds: [baseEmbed({ color: COLORS.WARNING, title: `${ICONS.OFF} Shift Force-Ended`, description: `Ended ${user}'s shift after **${formatDuration(finished.duration_seconds)}**.\n**Reason:** ${reason}` })],
  });
}
