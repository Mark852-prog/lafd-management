/**
 * services/events.js
 * -----------------------------------------------------------------------
 * Department sessions and trainings share the same lifecycle:
 *   post announcement (+ role ping) -> members toggle attendance with a
 *   button -> host/staff ends or cancels -> summary + log.
 * Buttons are routed by customId ("session:join:4"), so they keep working
 * after a bot restart.
 * -----------------------------------------------------------------------
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, SESSION_TYPES, TRAINING_TYPES, DEPARTMENTS, getRoleId, getMemberRank } = require('../config');
const db = require('../database/db');
const { baseEmbed, addField, departmentColor } = require('../utils/embeds');
const { hasPermission } = require('../utils/permissions');
const { replyError, replyNoPermission } = require('../utils/replies');
const { postTo, fetchMessage } = require('../utils/channels');
const { logOperations } = require('../utils/logger');
const { ts, formatDuration, truncate } = require('../utils/format');

const KINDS = {
  SESSION: {
    prefix: 'session',
    label: 'Session',
    icon: ICONS.SESSION,
    channelKey: 'SESSIONS',
    pingRole: 'SESSION_PING',
    types: SESSION_TYPES,
    joinLabel: 'Join',
    endLabel: 'End Session',
    manageLevel: REQUIRED_LEVEL.SESSION_HOST,
    rankRequired: true,
  },
  TRAINING: {
    prefix: 'training',
    label: 'Training',
    icon: ICONS.TRAINING,
    channelKey: 'TRAINING',
    pingRole: 'TRAINING_PING',
    types: TRAINING_TYPES,
    joinLabel: 'Attend',
    endLabel: 'Conclude',
    manageLevel: REQUIRED_LEVEL.TRAINING_HOST,
    rankRequired: false,
  },
};

const typeOf = (event) => KINDS[event.kind].types.find((t) => t.key === event.subtype) || { name: event.subtype, department: 'BOTH' };

function eventEmbed(event) {
  const kind = KINDS[event.kind];
  const type = typeOf(event);
  const attendees = db.getAttendees(event.id);
  const statusLabel = { OPEN: new Date(event.starts_at) > new Date() ? '🗓️ Scheduled' : '🟢 In Progress', ENDED: '⚫ Concluded', CANCELLED: '🔴 Cancelled' }[event.status];

  const embed = baseEmbed({
    color: event.status === 'CANCELLED' ? COLORS.NEUTRAL : departmentColor(type.department === 'BOTH' ? null : type.department),
    title: `${kind.icon} ${type.name} • ${kind.label} #${event.id}`,
    description: event.notes ? truncate(event.notes, 1500) : null,
  });
  addField(embed, 'Host', `<@${event.host_id}>`, true);
  addField(embed, 'Starts', `${ts(event.starts_at, 'f')}\n${ts(event.starts_at, 'R')}`, true);
  addField(embed, 'Status', statusLabel, true);
  if (event.ended_at && event.status === 'ENDED') addField(embed, 'Duration', formatDuration((new Date(event.ended_at) - new Date(event.starts_at)) / 1000), true);

  const shown = attendees.slice(0, 40).map((a) => `<@${a.discord_id}>`).join(' ');
  addField(embed, `${event.status === 'OPEN' ? 'Attending' : 'Attended'} (${attendees.length})`, attendees.length ? `${shown}${attendees.length > 40 ? ` +${attendees.length - 40} more` : ''}` : '*Nobody yet*');
  return embed;
}

function eventButtons(event) {
  if (event.status !== 'OPEN') return [];
  const kind = KINDS[event.kind];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${kind.prefix}:join:${event.id}`).setLabel(kind.joinLabel).setEmoji('🙋').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${kind.prefix}:end:${event.id}`).setLabel(kind.endLabel).setEmoji('🏁').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${kind.prefix}:cancel:${event.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function pingRoleFor(kindKey, type) {
  const kind = KINDS[kindKey];
  const specific = getRoleId(kind.pingRole);
  if (specific) return specific;
  if (type.department !== 'BOTH') return getRoleId(DEPARTMENTS[type.department].divisionRole);
  return getRoleId('LAFD_MEMBER');
}

/** Creates the event and posts its announcement. Returns { event, message } (message null if the channel is missing). */
async function createAndPostEvent(guild, { kindKey, typeKey, host, startsAt, notes, ping }) {
  const kind = KINDS[kindKey];
  const type = kind.types.find((t) => t.key === typeKey);
  const event = db.createEvent({ kind: kindKey, subtype: typeKey, hostId: host.id, startsAt: startsAt.toISOString(), notes });
  const roleId = ping ? pingRoleFor(kindKey, type) : null;

  const message = await postTo(guild, kind.channelKey, {
    content: roleId ? `<@&${roleId}>` : null,
    embeds: [eventEmbed(event)],
    components: eventButtons(event),
    allowedMentions: { roles: roleId ? [roleId] : [] },
  });
  if (message) db.setEventMessage(event.id, message.channelId, message.id);

  await logOperations(guild, {
    title: `${kind.label} Scheduled • #${event.id}`,
    member: null,
    staff: host,
    color: COLORS.INFO,
    fields: { Type: type.name, Starts: ts(startsAt, 'f'), Notes: notes },
  });
  return { event: db.getEvent(event.id), message };
}

/** Ends or cancels an event, refreshes its announcement and logs it. */
async function closeEvent(guild, event, actor, status = 'ENDED') {
  const closed = db.closeEvent(event.id, status);
  const message = await fetchMessage(guild, closed.channel_id, closed.message_id);
  if (message) await message.edit({ content: message.content || null, embeds: [eventEmbed(closed)], components: [] }).catch(() => {});

  const kind = KINDS[closed.kind];
  const attendees = db.getAttendees(closed.id);
  await logOperations(guild, {
    title: `${kind.label} ${status === 'ENDED' ? 'Concluded' : 'Cancelled'} • #${closed.id}`,
    member: null,
    staff: actor,
    color: status === 'ENDED' ? COLORS.SUCCESS : COLORS.NEUTRAL,
    fields: {
      Type: typeOf(closed).name,
      Host: `<@${closed.host_id}>`,
      Duration: status === 'ENDED' ? formatDuration((new Date(closed.ended_at) - new Date(closed.starts_at)) / 1000) : null,
      Attendance: `${attendees.length} member(s)`,
      Attendees: attendees.length ? truncate(attendees.map((a) => `<@${a.discord_id}>`).join(' '), 1000) : null,
    },
  });
  return closed;
}

/** Shared button handler for session:* and training:* customIds. */
async function handleEventComponent(interaction, kindKey, [action, idRaw]) {
  const kind = KINDS[kindKey];
  const event = db.getEvent(Number(idRaw));
  if (!event || event.kind !== kindKey) return replyError(interaction, `This ${kind.label.toLowerCase()} no longer exists.`);
  if (event.status !== 'OPEN') return replyError(interaction, `This ${kind.label.toLowerCase()} has already ${event.status === 'ENDED' ? 'concluded' : 'been cancelled'}.`);

  if (action === 'join') {
    if (kind.rankRequired && !getMemberRank(interaction.member)) return replyError(interaction, `Only LAFD members with a rank can join ${kind.label.toLowerCase()}s.`);
    db.toggleAttendance(event.id, interaction.user.id);
    return interaction.update({ embeds: [eventEmbed(event)], components: eventButtons(event) });
  }

  if (action === 'end' || action === 'cancel') {
    const isHost = event.host_id === interaction.user.id;
    if (!isHost && !hasPermission(interaction.member, kind.manageLevel)) return replyNoPermission(interaction, kind.manageLevel);
    await interaction.deferUpdate();
    await closeEvent(interaction.guild, event, interaction.user, action === 'end' ? 'ENDED' : 'CANCELLED');
  }
}

module.exports = { KINDS, eventEmbed, eventButtons, createAndPostEvent, closeEvent, handleEventComponent, typeOf };
