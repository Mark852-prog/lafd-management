/**
 * utils/embeds.js
 * -----------------------------------------------------------------------
 * Shared embed builders so every command looks consistent. Command-
 * specific layouts are built in the commands themselves on top of
 * baseEmbed().
 * -----------------------------------------------------------------------
 */

const { EmbedBuilder } = require('discord.js');
const { COLORS, ICONS, FOOTER_TEXT, LOGO_URL, DEPARTMENT_NAME, DEPARTMENTS } = require('../config');
const { truncate } = require('./format');

function baseEmbed({ color = COLORS.BRAND, title, description } = {}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: DEPARTMENT_NAME, iconURL: LOGO_URL || undefined })
    .setFooter({ text: FOOTER_TEXT, iconURL: LOGO_URL || undefined })
    .setTimestamp();
  if (title) embed.setTitle(truncate(title, 256));
  if (description) embed.setDescription(truncate(description, 4096));
  return embed;
}

const departmentColor = (department) => (department === 'FIRE' ? COLORS.FIRE : department === 'EMS' ? COLORS.EMS : COLORS.NEUTRAL);
const departmentIcon = (department) => (department === 'FIRE' ? ICONS.FIRE : department === 'EMS' ? ICONS.EMS : ICONS.BADGE);
const departmentLabel = (department) => DEPARTMENTS[department]?.name || 'Unassigned';

const errorEmbed = (message, title = 'Unable to Complete') =>
  baseEmbed({ color: COLORS.DANGER, title: `${ICONS.DENY} ${title}`, description: message });

const successEmbed = (title, message) => baseEmbed({ color: COLORS.SUCCESS, title: `${ICONS.APPROVE} ${title}`, description: message });

const infoEmbed = (title, message) => baseEmbed({ color: COLORS.INFO, title, description: message });

const warningEmbed = (title, message) => baseEmbed({ color: COLORS.WARNING, title, description: message });

/** Adds a field only if it has a value; truncates to Discord's limit. */
function addField(embed, name, value, inline = false) {
  if (value === undefined || value === null || value === '') return embed;
  return embed.addFields({ name: truncate(name, 256), value: truncate(String(value), 1024), inline });
}

function rankChangeEmbed({ type, member, rank, oldRankName, reason, notes, actor }) {
  const meta = {
    PROMOTION: { title: 'Promotion', icon: ICONS.PROMOTION, color: COLORS.GOLD },
    DEMOTION: { title: 'Demotion', icon: ICONS.DEMOTION, color: COLORS.DANGER },
    HIRE: { title: 'Welcome to the Department', icon: ICONS.BADGE, color: departmentColor(rank.department) },
  }[type];

  const embed = baseEmbed({
    color: meta.color,
    title: `${meta.icon} ${departmentIcon(rank.department)} ${meta.title}`,
  }).setThumbnail(member.displayAvatarURL());

  addField(embed, 'Member', `<@${member.id}>`, true);
  addField(embed, 'Division', departmentLabel(rank.department), true);
  addField(embed, type === 'HIRE' ? 'Starting Rank' : 'Rank Change', type === 'HIRE' ? `**${rank.name}**` : `${oldRankName || 'None'} → **${rank.name}**`, true);
  addField(embed, 'Reason', reason);
  addField(embed, 'Notes', notes);
  addField(embed, type === 'DEMOTION' ? 'Issued By' : 'Approved By', `<@${actor.id}>`, true);
  return embed;
}

const SEVERITY_COLORS = { 1: COLORS.WARNING, 2: 0xe67e22, 3: COLORS.DANGER };

function infractionEmbed({ record, infractionType, member, rankName, issuer, extra }) {
  const embed = baseEmbed({
    color: SEVERITY_COLORS[infractionType?.severity] || COLORS.WARNING,
    title: `${ICONS.DISCIPLINE} Disciplinary Action${record ? ` • Case #${record.id}` : ''}`,
  });
  addField(embed, 'Member', `<@${member.id}>`, true);
  addField(embed, 'Rank', rankName || 'Unranked', true);
  addField(embed, 'Action', `**${infractionType.name}**`, true);
  addField(embed, 'Reason', record?.reason ?? extra?.reason);
  addField(embed, 'Notes', record?.notes ?? extra?.notes);
  addField(embed, 'Evidence', record?.evidence ?? extra?.evidence);
  if (extra?.effect) addField(embed, 'Effect', extra.effect);
  addField(embed, 'Issued By', `<@${issuer.id}>`, true);
  return embed;
}

/** Structured log embed for the logging channels. */
function logEmbed({ title, member, staff, fields = {}, color = COLORS.NEUTRAL, description }) {
  const embed = baseEmbed({ color, title: `📝 ${title}`, description });
  if (member) addField(embed, 'Member', `<@${member.id}>`, true);
  addField(embed, 'Staff', staff ? `<@${staff.id}>` : 'System', true);
  for (const [name, value] of Object.entries(fields)) addField(embed, name, value);
  return embed;
}

module.exports = {
  baseEmbed,
  departmentColor,
  departmentIcon,
  departmentLabel,
  errorEmbed,
  successEmbed,
  infoEmbed,
  warningEmbed,
  addField,
  rankChangeEmbed,
  infractionEmbed,
  logEmbed,
};
