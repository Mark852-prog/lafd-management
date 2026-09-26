/**
 * utils/embeds.js
 * -----------------------------------------------------------------------
 * All embed construction lives here so every command produces consistent,
 * professional-looking output. Department-specific styling (Fire vs EMS)
 * is applied automatically based on the `department` passed in.
 * -----------------------------------------------------------------------
 */

const { EmbedBuilder } = require('discord.js');
const { COLORS, ICONS, FOOTER_TEXT, LOGO_URL } = require('../config');

function baseEmbed() {
  const embed = new EmbedBuilder().setFooter({ text: FOOTER_TEXT, iconURL: LOGO_URL || undefined }).setTimestamp();
  if (LOGO_URL) embed.setThumbnail(LOGO_URL);
  return embed;
}

function departmentColor(department) {
  if (department === 'FIRE') return COLORS.FIRE;
  if (department === 'EMS') return COLORS.EMS;
  return COLORS.NEUTRAL;
}

function departmentIcon(department) {
  if (department === 'FIRE') return ICONS.FIRE;
  if (department === 'EMS') return ICONS.EMS;
  return ICONS.BADGE;
}

/** Simple, professional error embed for ephemeral permission/validation failures. */
function errorEmbed(message) {
  return baseEmbed()
    .setColor(COLORS.DANGER)
    .setTitle('LAFD | Action Not Permitted')
    .setDescription(message);
}

/** Generic success embed for confirmations that aren't a specific action type below. */
function successEmbed(title, message) {
  return baseEmbed().setColor(COLORS.SUCCESS).setTitle(title).setDescription(message);
}

/** Promotion / demotion embed. */
function rankChangeEmbed({ type, member, department, oldRankName, newRankName, assignment, reason, approvedBy }) {
  const isPromotion = type === 'PROMOTION';
  const icon = isPromotion ? ICONS.PROMOTION : ICONS.DEMOTION;
  const deptLabel = department === 'FIRE' ? 'Fire' : 'EMS';

  return baseEmbed()
    .setColor(departmentColor(department))
    .setTitle(`${departmentIcon(department)} LAFD | ${deptLabel} ${isPromotion ? 'Promotion' : 'Demotion'} ${icon}`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Department', value: deptLabel, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Previous Rank', value: oldRankName || 'N/A', inline: true },
      { name: 'New Rank', value: newRankName || 'N/A', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Assignment', value: assignment || 'N/A', inline: true },
      { name: isPromotion ? 'Approved By' : 'Issued By', value: `<@${approvedBy.id}>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Reason', value: reason || 'No reason provided' }
    );
}

/** Disciplinary action embed. Color/severity scales with infraction type. */
function infractionEmbed({ member, rankName, department, type, reason, notes, evidence, issuer }) {
  const severityColor = {
    Notice: COLORS.WARNING,
    'Verbal Warning': COLORS.WARNING,
    Warning: COLORS.WARNING,
    Strike: COLORS.DANGER,
    Suspension: COLORS.DANGER,
    Demotion: COLORS.DANGER,
    Termination: COLORS.DANGER,
  }[type] || COLORS.WARNING;

  const embed = baseEmbed()
    .setColor(severityColor)
    .setTitle(`${ICONS.DISCIPLINE} LAFD | Disciplinary Action`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Rank', value: rankName || 'Unranked', inline: true },
      { name: 'Department', value: department || 'N/A', inline: true },
      { name: 'Action', value: type, inline: true },
      { name: 'Issued By', value: `<@${issuer.id}>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Reason', value: reason || 'No reason provided' }
    );

  if (notes) embed.addFields({ name: 'Notes', value: notes });
  if (evidence) embed.addFields({ name: 'Evidence', value: evidence });

  return embed;
}

/** Callsign request embed, posted to the management channel with approve/deny buttons. */
function callsignRequestEmbed({ member, rankName, department, requestedCallsign, requestedAt }) {
  return baseEmbed()
    .setColor(departmentColor(department))
    .setTitle(`${ICONS.CALLSIGN} LAFD | Callsign Request`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Rank', value: rankName || 'Unranked', inline: true },
      { name: 'Department', value: department || 'N/A', inline: true },
      { name: 'Requested Callsign', value: `\`${requestedCallsign}\``, inline: true },
      { name: 'Request Time', value: `<t:${Math.floor(requestedAt.getTime() / 1000)}:F>`, inline: true }
    );
}

/** Callsign approval confirmation embed (sent in-channel and/or DM'd). */
function callsignApprovedEmbed({ member, callsign, approvedBy }) {
  return baseEmbed()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${ICONS.APPROVE} LAFD | Callsign Approved`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Callsign', value: `\`${callsign}\``, inline: true },
      { name: 'Approved By', value: `<@${approvedBy.id}>`, inline: true }
    );
}

function callsignDeniedEmbed({ member, callsign, deniedBy, reason }) {
  return baseEmbed()
    .setColor(COLORS.DANGER)
    .setTitle(`${ICONS.DENY} LAFD | Callsign Denied`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Requested Callsign', value: `\`${callsign}\``, inline: true },
      { name: 'Denied By', value: `<@${deniedBy.id}>`, inline: true },
      { name: 'Reason', value: reason || 'No reason provided' }
    );
}

/** Shift started embed. */
function shiftStartedEmbed({ member, rankName, callsign, startTime }) {
  return baseEmbed()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${ICONS.SHIFT} LAFD | Shift Started`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Rank', value: rankName || 'Unranked', inline: true },
      { name: 'Callsign', value: callsign || 'Not Assigned', inline: true },
      { name: 'Start Time', value: `<t:${Math.floor(startTime.getTime() / 1000)}:F>` }
    );
}

/** Shift ended embed with duration. */
function shiftEndedEmbed({ member, startTime, endTime, durationSeconds }) {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = durationSeconds % 60;
  const durationString = `${hours}h ${minutes}m ${seconds}s`;

  return baseEmbed()
    .setColor(COLORS.NEUTRAL)
    .setTitle(`${ICONS.SHIFT} LAFD | Shift Ended`)
    .addFields(
      { name: 'Member', value: `<@${member.id}>`, inline: true },
      { name: 'Start Time', value: `<t:${Math.floor(startTime.getTime() / 1000)}:t>`, inline: true },
      { name: 'End Time', value: `<t:${Math.floor(endTime.getTime() / 1000)}:t>`, inline: true },
      { name: 'Total Duration', value: durationString }
    );
}

/** Announcement embed. */
function announcementEmbed({ title, message, imageUrl, author }) {
  const embed = baseEmbed()
    .setColor(COLORS.ANNOUNCEMENT)
    .setTitle(`${ICONS.ANNOUNCEMENT} ${title}`)
    .setDescription(message)
    .addFields({ name: 'Issued By', value: `<@${author.id}>` });
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

/** Structured log embed for the logging channels. */
function logEmbed({ action, member, staff, details = {}, color = COLORS.NEUTRAL }) {
  const embed = baseEmbed()
    .setColor(color)
    .setTitle(`LAFD Log | ${action}`)
    .addFields(
      { name: 'Member', value: member ? `<@${member.id}>` : 'N/A', inline: true },
      { name: 'Staff', value: staff ? `<@${staff.id}>` : 'System', inline: true }
    );

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === '') continue;
    embed.addFields({ name: key, value: String(value) });
  }

  return embed;
}

module.exports = {
  baseEmbed,
  departmentColor,
  departmentIcon,
  errorEmbed,
  successEmbed,
  rankChangeEmbed,
  infractionEmbed,
  callsignRequestEmbed,
  callsignApprovedEmbed,
  callsignDeniedEmbed,
  shiftStartedEmbed,
  shiftEndedEmbed,
  announcementEmbed,
  logEmbed,
};
