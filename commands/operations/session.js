/**
 * /session start | end | active
 * -----------------------------------------------------------------------
 * Department-wide or division sessions (mass shifts). Posts an
 * announcement with Join / End / Cancel buttons and tracks attendance,
 * which counts toward each member's activity record.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, SESSION_TYPES } = require('../../config');
const db = require('../../database/db');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError, deferEphemeral } = require('../../utils/replies');
const { baseEmbed } = require('../../utils/embeds');
const { ts } = require('../../utils/format');
const { KINDS, createAndPostEvent, closeEvent, handleEventComponent, typeOf } = require('../../services/events');

module.exports = {
  category: 'Operations',
  level: REQUIRED_LEVEL.SESSION_HOST,
  levels: { start: REQUIRED_LEVEL.SESSION_HOST, end: REQUIRED_LEVEL.SESSION_HOST, active: REQUIRED_LEVEL.ON_DUTY_VIEW },
  componentPrefix: KINDS.SESSION.prefix,
  data: new SlashCommandBuilder()
    .setName('session')
    .setDescription('Host department sessions (mass shifts).')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Announce a session and open attendance.')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Session type')
            .setRequired(true)
            .addChoices(...SESSION_TYPES.map((t) => ({ name: t.name, value: t.key })))
        )
        .addIntegerOption((o) => o.setName('starts_in').setDescription('Minutes from now (default: now)').setMinValue(0).setMaxValue(1440))
        .addStringOption((o) => o.setName('notes').setDescription('Briefing / server code / details').setMaxLength(1500))
        .addBooleanOption((o) => o.setName('ping').setDescription('Ping the session role (default: yes)'))
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('End an open session.')
        .addIntegerOption((o) => o.setName('session').setDescription('Session (defaults to your most recent)').setAutocomplete(true))
    )
    .addSubcommand((s) => s.setName('active').setDescription('List open sessions.')),

  async autocomplete(interaction) {
    const choices = db
      .getOpenEvents('SESSION')
      .slice(0, 25)
      .map((e) => ({ name: `#${e.id} ${typeOf(e).name}`.slice(0, 100), value: e.id }));
    return interaction.respond(choices);
  },

  handleComponent: (interaction, args) => handleEventComponent(interaction, 'SESSION', args),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'active') {
      const open = db.getOpenEvents('SESSION');
      const embed = baseEmbed({
        color: COLORS.INFO,
        title: `${ICONS.SESSION} Open Sessions (${open.length})`,
        description: open.length
          ? open.map((e) => `**#${e.id}** ${typeOf(e).name} — hosted by <@${e.host_id}> — ${ts(e.starts_at, 'R')} — ${db.getAttendees(e.id).length} attending`).join('\n')
          : 'No sessions are open right now.',
      });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (!hasPermission(interaction.member, REQUIRED_LEVEL.SESSION_HOST)) return replyNoPermission(interaction, REQUIRED_LEVEL.SESSION_HOST);

    if (sub === 'start') {
      await deferEphemeral(interaction);
      const startsAt = new Date(Date.now() + (interaction.options.getInteger('starts_in') ?? 0) * 60000);
      const { event, message } = await createAndPostEvent(interaction.guild, {
        kindKey: 'SESSION',
        typeKey: interaction.options.getString('type'),
        host: interaction.user,
        startsAt,
        notes: interaction.options.getString('notes'),
        ping: interaction.options.getBoolean('ping') ?? true,
      });
      if (!message) {
        db.closeEvent(event.id, 'CANCELLED');
        return replyError(interaction, 'The sessions channel is not configured or the bot cannot post there. Run `/config channel`.');
      }
      return interaction.editReply({ content: `${ICONS.APPROVE} Session #${event.id} posted: ${message.url}` });
    }

    if (sub === 'end') {
      const id = interaction.options.getInteger('session');
      const open = db.getOpenEvents('SESSION');
      const event = id ? open.find((e) => e.id === id) : open.filter((e) => e.host_id === interaction.user.id).pop();
      if (!event) return replyError(interaction, id ? `Session #${id} is not open.` : 'You have no open sessions. Pick one with the `session` option.');
      await deferEphemeral(interaction);
      const closed = await closeEvent(interaction.guild, event, interaction.user, 'ENDED');
      return interaction.editReply({ content: `${ICONS.APPROVE} Session #${closed.id} concluded with ${db.getAttendees(closed.id).length} attendee(s).` });
    }
  },
};
