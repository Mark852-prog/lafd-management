/**
 * /incident report | view | recent | void | stats
 * -----------------------------------------------------------------------
 * Incident reporting for every call type (fires, medicals, DOAs, MCIs...).
 * /incident report opens a form, then files a numbered report
 * (INC-00042) to the incident channel. Reports count toward activity.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, INCIDENT_TYPES, getIncidentType, getMemberRank } = require('../../config');
const db = require('../../database/db');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed, addField, departmentColor } = require('../../utils/embeds');
const { syncMemberRecord } = require('../../utils/members');
const { postTo, fetchMessage } = require('../../utils/channels');
const { logOperations } = require('../../utils/logger');
const { sendPaginated } = require('../../utils/paginator');
const { ts, pad, truncate, chunkLines, PERIOD_CHOICES, periodStart, periodLabel } = require('../../utils/format');

const TYPE_CHOICES = INCIDENT_TYPES.map((t) => ({ name: `${t.emoji} ${t.name}`, value: t.key }));
const incidentNumber = (id) => `INC-${pad(id, 5)}`;

function parseIncidentNumber(raw) {
  const match = /(\d+)\s*$/.exec(String(raw || ''));
  return match ? Number(match[1]) : null;
}

function incidentEmbed(incident) {
  const type = getIncidentType(incident.type) || { name: incident.type, emoji: ICONS.INCIDENT, department: 'BOTH' };
  const embed = baseEmbed({
    color: incident.voided ? COLORS.NEUTRAL : departmentColor(type.department === 'BOTH' ? null : type.department),
    title: `${type.emoji} ${incidentNumber(incident.id)} • ${type.name}${incident.voided ? ' [VOID]' : ''}`,
  });
  addField(embed, 'Location', incident.location, true);
  addField(embed, 'Units', incident.units || 'Not listed', true);
  addField(embed, 'Patients', String(incident.patients ?? 0), true);
  addField(embed, 'Narrative', incident.narrative);
  addField(embed, 'Outcome / Disposition', incident.outcome);
  addField(embed, 'Reported By', `<@${incident.reporter_id}>`, true);
  addField(embed, 'Filed', ts(incident.created_at, 'f'), true);
  if (incident.voided) addField(embed, 'Voided', `By <@${incident.voided_by}> — ${incident.void_reason}`);
  return embed;
}

module.exports = {
  category: 'Operations',
  level: REQUIRED_LEVEL.INCIDENT_REPORT,
  levels: {
    report: REQUIRED_LEVEL.INCIDENT_REPORT,
    view: REQUIRED_LEVEL.INCIDENT_REPORT,
    recent: REQUIRED_LEVEL.INCIDENT_REPORT,
    stats: REQUIRED_LEVEL.INCIDENT_REPORT,
    void: REQUIRED_LEVEL.INCIDENT_MANAGE,
  },
  data: new SlashCommandBuilder()
    .setName('incident')
    .setDescription('File and review incident reports.')
    .addSubcommand((s) =>
      s
        .setName('report')
        .setDescription('File an incident report (opens a form).')
        .addStringOption((o) => o.setName('type').setDescription('Incident type').setRequired(true).addChoices(...TYPE_CHOICES))
    )
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('View an incident report.')
        .addStringOption((o) => o.setName('number').setDescription('e.g. INC-00042 or 42').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('recent')
        .setDescription('Browse recent incident reports.')
        .addUserOption((o) => o.setName('member').setDescription('Only reports filed by this member'))
        .addStringOption((o) => o.setName('type').setDescription('Only this incident type').addChoices(...TYPE_CHOICES))
    )
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Incident breakdown by type.')
        .addStringOption((o) => o.setName('period').setDescription('Time period (default: 30 days)').addChoices(...PERIOD_CHOICES))
    )
    .addSubcommand((s) =>
      s
        .setName('void')
        .setDescription('Void an incorrect or duplicate report.')
        .addStringOption((o) => o.setName('number').setDescription('e.g. INC-00042 or 42').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(300))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'report') return report(interaction);
    if (sub === 'view') return view(interaction);
    if (sub === 'recent') return recent(interaction);
    if (sub === 'stats') return stats(interaction);
    if (sub === 'void') return voidReport(interaction);
  },
};

async function report(interaction) {
  if (!getMemberRank(interaction.member)) return replyError(interaction, 'Only LAFD members with a rank can file incident reports.');
  const type = getIncidentType(interaction.options.getString('type'));
  const modalId = `modal:incident:${interaction.id}`;
  const input = (id, label, style, { required = true, max = 1000, placeholder } = {}) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setMaxLength(max)
        .setPlaceholder(placeholder || '')
    );

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(`${type.name} Report`.slice(0, 45))
      .addComponents(
        input('location', 'Location', TextInputStyle.Short, { max: 150, placeholder: 'e.g. 1200 Main St / Postal 304' }),
        input('units', 'Units on scene', TextInputStyle.Short, { required: false, max: 200, placeholder: 'e.g. E12, T7, M3, BC1' }),
        input('patients', 'Number of patients', TextInputStyle.Short, { required: false, max: 3, placeholder: '0' }),
        input('narrative', 'Narrative - what happened & actions taken', TextInputStyle.Paragraph, { max: 1500 }),
        input('outcome', 'Outcome / disposition', TextInputStyle.Paragraph, { required: false, max: 500, placeholder: 'e.g. Fire knocked down, 1 transported to Pillbox' })
      )
  );

  const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 900000 }).catch(() => null);
  if (!submit) return;

  const patientsRaw = submit.fields.getTextInputValue('patients').trim();
  const patients = patientsRaw ? Number.parseInt(patientsRaw, 10) : 0;
  if (!Number.isInteger(patients) || patients < 0 || patients > 999) {
    return submit.reply({ embeds: [baseEmbed({ color: COLORS.DANGER, title: 'Invalid patient count', description: 'Patients must be a whole number (0-999). Please file the report again.' })], flags: MessageFlags.Ephemeral });
  }

  await submit.deferReply({ flags: MessageFlags.Ephemeral });
  syncMemberRecord(interaction.member);
  const incident = db.createIncident({
    type: type.key,
    location: submit.fields.getTextInputValue('location').trim(),
    units: submit.fields.getTextInputValue('units').trim() || null,
    patients,
    narrative: submit.fields.getTextInputValue('narrative').trim(),
    outcome: submit.fields.getTextInputValue('outcome').trim() || null,
    reporterId: interaction.user.id,
  });
  const embed = incidentEmbed(incident);
  const message = await postTo(interaction.guild, 'INCIDENT_REPORTS', { embeds: [embed], allowedMentions: { parse: [] } });
  if (message) db.setIncidentMessage(incident.id, message.channelId, message.id);

  await logOperations(interaction.guild, {
    title: `Incident Filed • ${incidentNumber(incident.id)}`,
    member: interaction.user,
    staff: interaction.user,
    color: COLORS.INFO,
    fields: { Type: type.name, Location: incident.location },
  });

  return submit.editReply({
    content: message ? `${ICONS.APPROVE} Filed as **${incidentNumber(incident.id)}**: ${message.url}` : `${ICONS.APPROVE} Filed as **${incidentNumber(incident.id)}** (the incident channel isn't configured, so it was only saved).`,
    embeds: [embed],
  });
}

async function view(interaction) {
  const incident = db.getIncident(parseIncidentNumber(interaction.options.getString('number')));
  if (!incident) return replyError(interaction, 'No incident report with that number exists.');
  return interaction.reply({ embeds: [incidentEmbed(incident)], flags: MessageFlags.Ephemeral });
}

async function recent(interaction) {
  const reporter = interaction.options.getUser('member');
  const typeKey = interaction.options.getString('type');
  const rows = db.getRecentIncidents({ reporterId: reporter?.id ?? null, type: typeKey, limit: 100 });
  const lines = rows.map((i) => {
    const type = getIncidentType(i.type);
    return `${type?.emoji || ICONS.INCIDENT} **${incidentNumber(i.id)}** ${type?.name || i.type} — ${truncate(i.location, 60)}\n> ${ts(i.created_at, 'R')} by <@${i.reporter_id}>${i.patients ? ` • ${i.patients} patient(s)` : ''}`;
  });
  const title = `${ICONS.INCIDENT} Recent Incidents${reporter ? ` • ${reporter.username}` : ''}`;
  const pages = (lines.length ? chunkLines(lines, 3500, 10) : [['No incident reports found.']]).map((chunk) =>
    baseEmbed({ color: COLORS.BRAND, title, description: chunk.join('\n') })
  );
  return sendPaginated(interaction, pages);
}

async function stats(interaction) {
  const period = interaction.options.getString('period') || '30d';
  const counts = db.getIncidentTypeCounts(periodStart(period));
  const total = counts.reduce((n, c) => n + c.n, 0);
  const max = Math.max(1, ...counts.map((c) => c.n));
  const embed = baseEmbed({
    color: COLORS.BRAND,
    title: `${ICONS.ACTIVITY} Incident Breakdown • ${periodLabel(period)}`,
    description: counts.length
      ? counts
          .map((c) => {
            const type = getIncidentType(c.type);
            const bar = '█'.repeat(Math.max(1, Math.round((c.n / max) * 12)));
            return `${type?.emoji || '•'} **${type?.name || c.type}**\n\`${bar}\` ${c.n}`;
          })
          .join('\n')
      : 'No incidents in this period.',
  });
  addField(embed, 'Total Reports', String(total), true);
  return interaction.reply({ embeds: [embed] });
}

async function voidReport(interaction) {
  if (!hasPermission(interaction.member, REQUIRED_LEVEL.INCIDENT_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.INCIDENT_MANAGE);
  const incident = db.getIncident(parseIncidentNumber(interaction.options.getString('number')));
  if (!incident) return replyError(interaction, 'No incident report with that number exists.');
  if (incident.voided) return replyError(interaction, `${incidentNumber(incident.id)} is already void.`);

  const reason = interaction.options.getString('reason');
  const voided = db.voidIncident(incident.id, interaction.user.id, reason);
  const message = await fetchMessage(interaction.guild, voided.channel_id, voided.message_id);
  if (message) await message.edit({ embeds: [incidentEmbed(voided)] }).catch(() => {});

  await logOperations(interaction.guild, {
    title: `Incident Voided • ${incidentNumber(incident.id)}`,
    member: { id: incident.reporter_id },
    staff: interaction.user,
    color: COLORS.NEUTRAL,
    fields: { Reason: reason },
  });
  return interaction.reply({ embeds: [incidentEmbed(voided)], flags: MessageFlags.Ephemeral });
}
