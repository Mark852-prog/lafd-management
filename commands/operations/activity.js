/**
 * /activity check | leaderboard | quota
 * -----------------------------------------------------------------------
 * Activity reporting built from shifts, incidents, trainings, sessions
 * and commendations. /activity quota lists every ranked member against
 * the weekly hour quota (QUOTA_WEEKLY_HOURS), excusing anyone on leave or
 * hired in the last 7 days.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, POLICY, DEPARTMENTS, getMemberRank, getMemberRankIn } = require('../../config');
const db = require('../../database/db');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission } = require('../../utils/replies');
const { baseEmbed, addField, departmentColor } = require('../../utils/embeds');
const { fetchRankedMembers } = require('../../utils/members');
const { sendPaginated } = require('../../utils/paginator');
const { formatDuration, toHours, progressBar, periodStart, periodLabel, PERIOD_CHOICES, chunkLines } = require('../../utils/format');

const DIVISION_CHOICES = [
  { name: 'Fire Division', value: 'FIRE' },
  { name: 'EMS Division', value: 'EMS' },
];

module.exports = {
  category: 'Operations',
  level: REQUIRED_LEVEL.ACTIVITY_SELF,
  levels: { check: REQUIRED_LEVEL.ACTIVITY_SELF, leaderboard: REQUIRED_LEVEL.ACTIVITY_SELF, quota: REQUIRED_LEVEL.QUOTA_CHECK },
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Activity reports, leaderboards and quota checks.')
    .addSubcommand((s) =>
      s
        .setName('check')
        .setDescription('Activity summary for you or another member.')
        .addUserOption((o) => o.setName('member').setDescription('Member (officers can check others)'))
        .addStringOption((o) => o.setName('period').setDescription('Time period (default: 7 days)').addChoices(...PERIOD_CHOICES))
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Top members by hours on duty.')
        .addStringOption((o) => o.setName('period').setDescription('Time period (default: 7 days)').addChoices(...PERIOD_CHOICES))
        .addStringOption((o) => o.setName('division').setDescription('Only one division').addChoices(...DIVISION_CHOICES))
    )
    .addSubcommand((s) =>
      s
        .setName('quota')
        .setDescription(`Who met the weekly ${POLICY.WEEKLY_QUOTA_HOURS}h quota (last 7 days).`)
        .addStringOption((o) => o.setName('division').setDescription('Only one division').addChoices(...DIVISION_CHOICES))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'check') return check(interaction);
    if (sub === 'leaderboard') return leaderboard(interaction);
    if (sub === 'quota') return quota(interaction);
  },
};

async function check(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  if (user.id !== interaction.user.id && !hasPermission(interaction.member, REQUIRED_LEVEL.ACTIVITY_OTHERS)) {
    return replyNoPermission(interaction, REQUIRED_LEVEL.ACTIVITY_OTHERS);
  }
  const period = interaction.options.getString('period') || '7d';
  const since = periodStart(period);
  const shifts = db.getShiftStats(user.id, since);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const rank = member ? getMemberRank(member) : null;

  const embed = baseEmbed({ color: departmentColor(rank?.department), title: `${ICONS.ACTIVITY} Activity • ${user.username}`, description: `**${periodLabel(period)}**` });
  if (member) embed.setThumbnail(member.displayAvatarURL());
  addField(embed, 'Time on Duty', `**${formatDuration(shifts.seconds)}**`, true);
  addField(embed, 'Shifts', String(shifts.count), true);
  addField(embed, 'Avg. Shift', shifts.count ? formatDuration(shifts.seconds / shifts.count) : '—', true);
  addField(embed, 'Incidents Filed', String(db.countIncidents(user.id, since)), true);
  addField(embed, 'Sessions', `${db.countAttendance(user.id, 'SESSION', since)} attended • ${db.countHosted(user.id, 'SESSION', since)} hosted`, true);
  addField(embed, 'Trainings', `${db.countAttendance(user.id, 'TRAINING', since)} attended • ${db.countHosted(user.id, 'TRAINING', since)} hosted`, true);
  addField(embed, 'Commendations', String(db.countCommendations(user.id, since)), true);

  const week = db.getShiftStats(user.id, periodStart('7d'));
  const hours = toHours(week.seconds);
  const leave = db.getActiveLeave(user.id);
  addField(
    embed,
    'Weekly Quota',
    `${progressBar(hours, POLICY.WEEKLY_QUOTA_HOURS)} ${hours}h / ${POLICY.WEEKLY_QUOTA_HOURS}h — ${hours >= POLICY.WEEKLY_QUOTA_HOURS ? '✅ Met' : leave ? '🌴 Excused (on leave)' : '❌ Not met yet'}`
  );
  return interaction.reply({ embeds: [embed] });
}

async function leaderboard(interaction) {
  const period = interaction.options.getString('period') || '7d';
  const division = interaction.options.getString('division');
  await interaction.deferReply();

  const totals = [...db.getShiftTotals(periodStart(period)).entries()]
    .map(([discordId, t]) => ({ discordId, ...t, department: db.getMember(discordId)?.department }))
    .filter((row) => !division || row.department === division)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 25);

  const medals = ['🥇', '🥈', '🥉'];
  const lines = totals.map((row, i) => `${medals[i] || `\`#${String(i + 1).padStart(2, ' ')}\``} <@${row.discordId}> — **${formatDuration(row.seconds)}** · ${row.count} shift(s)`);
  const title = `🏆 Duty Leaderboard • ${periodLabel(period)}${division ? ` • ${DEPARTMENTS[division].name}` : ''}`;
  const pages = (lines.length ? chunkLines(lines, 3500, 25) : [['No shifts recorded in this period.']]).map((chunk) =>
    baseEmbed({ color: COLORS.GOLD, title, description: chunk.join('\n') })
  );
  return sendPaginated(interaction, pages, { ephemeral: false });
}

async function quota(interaction) {
  if (!hasPermission(interaction.member, REQUIRED_LEVEL.QUOTA_CHECK)) return replyNoPermission(interaction, REQUIRED_LEVEL.QUOTA_CHECK);
  const division = interaction.options.getString('division');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const since = periodStart('7d');
  const totals = db.getShiftTotals(since);
  const onLeave = new Set(db.getLeavesByStatus(['ACTIVE']).map((l) => l.discord_id));
  const members = (await fetchRankedMembers(interaction.guild)).filter((m) => !division || getMemberRankIn(m, division));

  const below = [];
  const met = [];
  const excused = [];
  for (const m of members.values()) {
    const hours = toHours(totals.get(m.id)?.seconds || 0);
    const recentHire = db.getLastHistoryOf(m.id, ['HIRE']);
    const isNew = recentHire && recentHire.created_at >= since;
    const line = `<@${m.id}> — ${hours}h`;
    if (hours >= POLICY.WEEKLY_QUOTA_HOURS) met.push({ hours, line: `✅ ${line}` });
    else if (onLeave.has(m.id) || db.getActiveSuspension(m.id)) excused.push({ hours, line: `🌴 ${line} (on leave/suspended)` });
    else if (isNew) excused.push({ hours, line: `🆕 ${line} (hired this week)` });
    else below.push({ hours, line: `❌ ${line}` });
  }
  below.sort((a, b) => a.hours - b.hours);
  met.sort((a, b) => b.hours - a.hours);

  const summary = `Quota: **${POLICY.WEEKLY_QUOTA_HOURS}h** in the last 7 days${division ? ` • ${DEPARTMENTS[division].name}` : ''}\n❌ **${below.length}** below • ✅ **${met.length}** met • 🌴 **${excused.length}** excused`;
  const sections = [
    { title: '❌ Below Quota', rows: below, color: COLORS.DANGER },
    { title: '✅ Met Quota', rows: met, color: COLORS.SUCCESS },
    { title: '🌴 Excused', rows: excused, color: COLORS.INFO },
  ];
  const pages = [];
  for (const section of sections) {
    if (!section.rows.length) continue;
    for (const chunk of chunkLines(section.rows.map((r) => r.line), 3300, 30)) {
      pages.push(baseEmbed({ color: section.color, title: `${ICONS.ACTIVITY} Quota Check • ${section.title}`, description: `${summary}\n\n${chunk.join('\n')}` }));
    }
  }
  if (!pages.length) pages.push(baseEmbed({ color: COLORS.NEUTRAL, title: `${ICONS.ACTIVITY} Quota Check`, description: `${summary}\n\nNo ranked members found.` }));
  return sendPaginated(interaction, pages);
}
