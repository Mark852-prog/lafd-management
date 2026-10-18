/**
 * /profile [member]
 * -----------------------------------------------------------------------
 * A member's full LAFD service record: ranks, callsign, status, activity,
 * certifications, commendations and rank history. Disciplinary details
 * are only shown to staff with DISCIPLINE_VIEW.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, ICONS, POLICY, getMemberRanks, getCertification } = require('../../config');
const db = require('../../database/db');
const { hasPermission } = require('../../utils/permissions');
const { baseEmbed, addField, departmentColor, departmentLabel } = require('../../utils/embeds');
const { fetchMember, syncMemberRecord } = require('../../utils/members');
const { replyError } = require('../../utils/replies');
const { ts, formatDuration, toHours, periodStart, progressBar } = require('../../utils/format');
const { LEAVE_TYPES } = require('../../services/leave');

function statusLine(member, record) {
  if (record?.status === 'TERMINATED') return `${ICONS.ALERT} Terminated`;
  if (record?.status === 'RESIGNED') return `${ICONS.OFF} Resigned`;
  const suspension = db.getActiveSuspension(member.id);
  if (suspension) return `${ICONS.ALERT} Suspended${suspension.expires_at ? ` until ${ts(suspension.expires_at, 'D')}` : ''}`;
  const leave = db.getActiveLeave(member.id);
  if (leave) return `${ICONS.AWAY} ${LEAVE_TYPES[leave.type].name}${leave.ends_at ? ` until ${ts(leave.ends_at, 'D')}` : ''}`;
  return `${ICONS.ON} Active`;
}

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.PROFILE_VIEW,
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription("View an LAFD member's service record.")
    .addUserOption((o) => o.setName('member').setDescription('Member to look up (defaults to you)')),

  async execute(interaction) {
    const user = interaction.options.getUser('member') || interaction.user;
    const member = await fetchMember(interaction.guild, user.id);
    if (!member) return replyError(interaction, 'That user is not in this server.');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ranks = getMemberRanks(member);
    const primary = ranks[0];
    const record = syncMemberRecord(member);
    const shift = db.getActiveShift(member.id);
    const week = db.getShiftStats(member.id, periodStart('7d'));
    const allTime = db.getShiftStats(member.id, null);
    const certs = db.getCertifications(member.id);
    const commendations = db.getCommendations(member.id, 3);
    const rankHistory = db.getHistory(member.id, 5, ['HIRE', 'PROMOTION', 'DEMOTION', 'TERMINATION', 'RESIGNATION']);

    const embed = baseEmbed({
      color: departmentColor(primary?.department),
      title: `${ICONS.BADGE} Service Record • ${member.displayName}`,
    }).setThumbnail(member.displayAvatarURL());

    addField(embed, 'Member', `<@${member.id}>`, true);
    addField(embed, 'Rank', ranks.length ? ranks.map((r) => `**${r.name}**`).join('\n') : 'Unranked', true);
    addField(embed, 'Division', ranks.length ? [...new Set(ranks.map((r) => departmentLabel(r.department)))].join('\n') : 'N/A', true);
    addField(embed, 'Callsign', record?.callsign ? `\`${record.callsign}\`` : 'Not assigned', true);
    addField(embed, 'Status', statusLine(member, record), true);
    addField(embed, 'Duty', shift ? `${ICONS.ON} On duty since ${ts(shift.start_time, 'R')}` : `${ICONS.OFF} Off duty`, true);
    addField(
      embed,
      'Activity',
      [
        `This week: **${formatDuration(week.seconds)}** ${progressBar(toHours(week.seconds), POLICY.WEEKLY_QUOTA_HOURS)} ${toHours(week.seconds)}/${POLICY.WEEKLY_QUOTA_HOURS}h`,
        `All time: **${formatDuration(allTime.seconds)}** over ${allTime.count} shift(s)`,
        `Incidents filed: **${db.countIncidents(member.id)}** • Trainings attended: **${db.countAttendance(member.id, 'TRAINING')}** • Sessions: **${db.countAttendance(member.id, 'SESSION')}**`,
      ].join('\n')
    );
    addField(
      embed,
      `${ICONS.CERT} Certifications (${certs.length})`,
      certs.length ? certs.map((c) => `• ${getCertification(c.cert_key)?.name || c.cert_key}`).join('\n') : 'None on file'
    );
    if (commendations.length) {
      addField(
        embed,
        `${ICONS.STAR} Commendations (${db.countCommendations(member.id)})`,
        commendations.map((c) => `• **${c.title}** — ${ts(c.created_at, 'd')}`).join('\n')
      );
    }
    if (rankHistory.length) {
      const icon = { HIRE: ICONS.BADGE, PROMOTION: ICONS.PROMOTION, DEMOTION: ICONS.DEMOTION, TERMINATION: ICONS.DENY, RESIGNATION: '👋' };
      addField(
        embed,
        'Rank History',
        rankHistory.map((h) => `${icon[h.action_type]} ${h.old_value ? `${h.old_value} → ` : ''}${h.new_value || 'Removed'} • ${ts(h.created_at, 'd')}`).join('\n')
      );
    }
    addField(embed, 'Server Joined', member.joinedAt ? ts(member.joinedAt, 'D') : 'Unknown', true);
    addField(embed, 'First Seen by Bot', record ? ts(record.join_date, 'D') : 'Unknown', true);

    if (hasPermission(interaction.member, REQUIRED_LEVEL.DISCIPLINE_VIEW)) {
      const active = db.getInfractions(member.id, false);
      const blacklisted = db.getActiveBlacklist(member.id);
      addField(
        embed,
        `${ICONS.DISCIPLINE} Discipline (staff only)`,
        [
          active.length ? `**${active.length}** active record(s): ${active.slice(0, 5).map((r) => `#${r.id} ${r.type}`).join(', ')}` : 'No active records.',
          blacklisted ? `${ICONS.BLACKLIST} **Blacklisted** (#${blacklisted.id})` : null,
          'Use `/discipline history` for full details.',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
