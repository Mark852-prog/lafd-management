/**
 * /training host | log | history | upcoming
 * -----------------------------------------------------------------------
 * Schedule trainings with RSVP buttons, then record each trainee's
 * result. A PASS with a certification selected awards that certification
 * (and its role) automatically.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, TRAINING_TYPES, CERTIFICATIONS, getTrainingType, getCertification } = require('../../config');
const db = require('../../database/db');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError, deferEphemeral } = require('../../utils/replies');
const { baseEmbed, addField } = require('../../utils/embeds');
const { fetchMember, syncMemberRecord } = require('../../utils/members');
const { logOperations } = require('../../utils/logger');
const { safeDM } = require('../../utils/channels');
const { sendPaginated } = require('../../utils/paginator');
const { ts, chunkLines } = require('../../utils/format');
const { KINDS, createAndPostEvent, handleEventComponent, typeOf } = require('../../services/events');
const { grantCert } = require('../personnel/cert');

const TYPE_CHOICES = TRAINING_TYPES.map((t) => ({ name: t.name, value: t.key }));

module.exports = {
  category: 'Operations',
  level: REQUIRED_LEVEL.TRAINING_HOST,
  levels: {
    host: REQUIRED_LEVEL.TRAINING_HOST,
    log: REQUIRED_LEVEL.TRAINING_LOG,
    history: REQUIRED_LEVEL.PROFILE_VIEW,
    upcoming: REQUIRED_LEVEL.PROFILE_VIEW,
  },
  componentPrefix: KINDS.TRAINING.prefix,
  data: new SlashCommandBuilder()
    .setName('training')
    .setDescription('Schedule trainings and record results.')
    .addSubcommand((s) =>
      s
        .setName('host')
        .setDescription('Schedule a training with RSVP buttons.')
        .addStringOption((o) => o.setName('type').setDescription('Training type').setRequired(true).addChoices(...TYPE_CHOICES))
        .addIntegerOption((o) => o.setName('starts_in').setDescription('Minutes from now (default: now)').setMinValue(0).setMaxValue(10080))
        .addStringOption((o) => o.setName('notes').setDescription('Location, requirements, what to bring').setMaxLength(1500))
        .addBooleanOption((o) => o.setName('ping').setDescription('Ping the training role (default: yes)'))
    )
    .addSubcommand((s) =>
      s
        .setName('log')
        .setDescription("Record a trainee's result.")
        .addUserOption((o) => o.setName('member').setDescription('Trainee').setRequired(true))
        .addStringOption((o) => o.setName('type').setDescription('Training type').setRequired(true).addChoices(...TYPE_CHOICES))
        .addStringOption((o) =>
          o.setName('result').setDescription('Result').setRequired(true).addChoices({ name: '✅ Pass', value: 'PASS' }, { name: '❌ Fail', value: 'FAIL' })
        )
        .addStringOption((o) =>
          o
            .setName('certification')
            .setDescription('Certification awarded on a pass (optional)')
            .addChoices(...CERTIFICATIONS.map((c) => ({ name: c.name, value: c.key })))
        )
        .addStringOption((o) => o.setName('score').setDescription('Score, e.g. 18/20 (optional)').setMaxLength(20))
        .addStringOption((o) => o.setName('notes').setDescription('Feedback for the trainee').setMaxLength(1000))
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("View a member's training record.")
        .addUserOption((o) => o.setName('member').setDescription('Member (defaults to you)'))
    )
    .addSubcommand((s) => s.setName('upcoming').setDescription('List scheduled and in-progress trainings.')),

  handleComponent: (interaction, args) => handleEventComponent(interaction, 'TRAINING', args),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'history') return history(interaction);
    if (sub === 'upcoming') return upcoming(interaction);

    const required = module.exports.levels[sub];
    if (!hasPermission(interaction.member, required)) return replyNoPermission(interaction, required);
    if (sub === 'host') return host(interaction);
    if (sub === 'log') return log(interaction);
  },
};

async function host(interaction) {
  await deferEphemeral(interaction);
  const startsAt = new Date(Date.now() + (interaction.options.getInteger('starts_in') ?? 0) * 60000);
  const { event, message } = await createAndPostEvent(interaction.guild, {
    kindKey: 'TRAINING',
    typeKey: interaction.options.getString('type'),
    host: interaction.user,
    startsAt,
    notes: interaction.options.getString('notes'),
    ping: interaction.options.getBoolean('ping') ?? true,
  });
  if (!message) {
    db.closeEvent(event.id, 'CANCELLED');
    return replyError(interaction, 'The training channel is not configured or the bot cannot post there. Run `/config channel`.');
  }
  return interaction.editReply({ content: `${ICONS.APPROVE} Training #${event.id} posted: ${message.url}\nUse \`/training log\` to record each trainee's result afterwards.` });
}

async function log(interaction) {
  const target = await fetchMember(interaction.guild, interaction.options.getUser('member').id);
  if (!target || target.user.bot) return replyError(interaction, 'That user is not a member of this server.');
  if (target.id === interaction.user.id) return replyError(interaction, 'You cannot log your own training result.');

  const type = getTrainingType(interaction.options.getString('type'));
  const result = interaction.options.getString('result');
  const cert = getCertification(interaction.options.getString('certification'));
  const score = interaction.options.getString('score');
  const notes = interaction.options.getString('notes');
  const passed = result === 'PASS';

  await deferEphemeral(interaction);
  syncMemberRecord(target);
  const record = db.addTrainingResult({
    discordId: target.id,
    type: type.key,
    result,
    score,
    certKey: passed && cert ? cert.key : null,
    notes,
    instructorId: interaction.user.id,
  });

  let certLine = null;
  if (passed && cert) {
    const { added, failed } = await grantCert(interaction.guild, target, cert, interaction.user, `Passed ${type.name} (result #${record.id})`);
    certLine = added ? `${ICONS.CERT} **${cert.name}** awarded${failed.length ? ` (⚠️ role not added: ${failed.join(', ')})` : ''}` : `Already held **${cert.name}**`;
  }

  const embed = baseEmbed({
    color: passed ? COLORS.SUCCESS : COLORS.DANGER,
    title: `${ICONS.TRAINING} Training Result • ${passed ? 'PASSED' : 'NOT PASSED'}`,
  });
  addField(embed, 'Trainee', `<@${target.id}>`, true);
  addField(embed, 'Training', type.name, true);
  addField(embed, 'Score', score, true);
  addField(embed, 'Instructor', `<@${interaction.user.id}>`, true);
  addField(embed, 'Certification', certLine, true);
  addField(embed, 'Feedback', notes);

  await interaction.editReply({ embeds: [embed] });
  await safeDM(target.user, { embeds: [embed] });
  await logOperations(interaction.guild, {
    title: `Training Result • ${passed ? 'Pass' : 'Fail'}`,
    member: target,
    staff: interaction.user,
    color: passed ? COLORS.SUCCESS : COLORS.DANGER,
    fields: { Training: type.name, Score: score, Certification: certLine, Notes: notes },
  });
}

async function history(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  if (user.id !== interaction.user.id && !hasPermission(interaction.member, REQUIRED_LEVEL.ACTIVITY_OTHERS)) {
    return replyNoPermission(interaction, REQUIRED_LEVEL.ACTIVITY_OTHERS);
  }
  const results = db.getTrainingResults(user.id, 100);
  const lines = results.map(
    (r) =>
      `${r.result === 'PASS' ? ICONS.APPROVE : ICONS.DENY} **${getTrainingType(r.type)?.name || r.type}**${r.score ? ` (${r.score})` : ''} — ${ts(r.created_at, 'd')} by <@${r.instructor_id}>` +
      `${r.cert_key ? `\n> ${ICONS.CERT} ${getCertification(r.cert_key)?.name}` : ''}${r.notes ? `\n> ${r.notes.slice(0, 150)}` : ''}`
  );
  const header = `Attended **${db.countAttendance(user.id, 'TRAINING')}** training(s) • Hosted **${db.countHosted(user.id, 'TRAINING')}**`;
  const pages = (lines.length ? chunkLines(lines, 3300, 10) : [['No training results on file.']]).map((chunk) =>
    baseEmbed({ color: COLORS.INFO, title: `${ICONS.TRAINING} Training Record • ${user.username}`, description: `${header}\n\n${chunk.join('\n')}` })
  );
  return sendPaginated(interaction, pages);
}

async function upcoming(interaction) {
  const open = db.getOpenEvents('TRAINING');
  const embed = baseEmbed({
    color: COLORS.INFO,
    title: `${ICONS.TRAINING} Upcoming Trainings (${open.length})`,
    description: open.length
      ? open.map((e) => `**#${e.id}** ${typeOf(e).name} — ${ts(e.starts_at, 'f')} (${ts(e.starts_at, 'R')}) — host <@${e.host_id}> — ${db.getAttendees(e.id).length} attending`).join('\n')
      : 'No trainings are scheduled right now.',
  });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
