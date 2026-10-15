/**
 * /leave request | place | end | status | list
 * -----------------------------------------------------------------------
 * Two kinds of leave:
 *   Leave of Absence (LOA)   - requested by the member, approved by an
 *                              officer via buttons in the leave channel
 *   Administrative Leave     - placed directly by Senior Staff
 * Leave starts and ends automatically (scheduler), applies the matching
 * role, ends any running shift, and excuses the member from quota.
 * -----------------------------------------------------------------------
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, POLICY, getMemberRank, getChannelId } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver, getPermissionLevel } = require('../../utils/permissions');
const { replyNoPermission, replyError, replySuccess, deferEphemeral } = require('../../utils/replies');
const { baseEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { fetchMember, syncMemberRecord } = require('../../utils/members');
const { postTo, safeDM, fetchMessage } = require('../../utils/channels');
const { logPersonnel } = require('../../utils/logger');
const { sendPaginated } = require('../../utils/paginator');
const { ts, addDays, chunkLines, truncate } = require('../../utils/format');
const { LEAVE_TYPES, STATUS_LABELS, leaveEmbed, activateLeave, endLeave } = require('../../services/leave');

function reviewButtons(leaveId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`leave:approve:${leaveId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`leave:deny:${leaveId}`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
}

/** Keeps the original request message in the leave channel up to date. */
async function refreshRequestMessage(guild, leave) {
  const message = await fetchMessage(guild, leave.channel_id, leave.message_id);
  if (message) await message.edit({ embeds: [leaveEmbed(leave)], components: [] }).catch(() => {});
}

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.LEAVE_REQUEST,
  levels: {
    request: REQUIRED_LEVEL.LEAVE_REQUEST,
    end: REQUIRED_LEVEL.LEAVE_REQUEST,
    status: REQUIRED_LEVEL.LEAVE_REQUEST,
    list: REQUIRED_LEVEL.LEAVE_MANAGE,
    place: REQUIRED_LEVEL.ADMIN_LEAVE,
  },
  componentPrefix: 'leave',
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave of absence and administrative leave.')
    .addSubcommand((s) =>
      s
        .setName('request')
        .setDescription('Request a leave of absence.')
        .addIntegerOption((o) => o.setName('days').setDescription('How many days').setRequired(true).setMinValue(1).setMaxValue(POLICY.MAX_LEAVE_DAYS))
        .addStringOption((o) => o.setName('reason').setDescription('Reason (only staff can see this)').setRequired(true).setMaxLength(500))
        .addIntegerOption((o) => o.setName('starts_in_days').setDescription('Start later instead of today (0-30 days from now)').setMinValue(0).setMaxValue(30))
    )
    .addSubcommand((s) =>
      s
        .setName('place')
        .setDescription('Place a member on administrative leave.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
        .addIntegerOption((o) => o.setName('days').setDescription('Length in days (leave empty for until further notice)').setMinValue(1).setMaxValue(365))
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('End or cancel a leave early (yours, or a member you supervise).')
        .addUserOption((o) => o.setName('member').setDescription('Member (defaults to you)'))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('View current and past leave.')
        .addUserOption((o) => o.setName('member').setDescription('Member (defaults to you)'))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List everyone on, or waiting for, leave.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'request') return request(interaction);
    if (sub === 'place') return place(interaction);
    if (sub === 'end') return end(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'list') return list(interaction);
  },

  async handleComponent(interaction, [action, idRaw]) {
    const leave = db.getLeave(Number(idRaw));
    if (!leave) return replyError(interaction, 'This leave request no longer exists.');
    if (leave.status !== 'PENDING') return replyError(interaction, `This request is already ${STATUS_LABELS[leave.status] || leave.status}.`);
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.LEAVE_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.LEAVE_MANAGE);
    if (leave.discord_id === interaction.user.id && getPermissionLevel(interaction.member) < 5) return replyError(interaction, 'You cannot review your own leave request.');

    if (action === 'approve') {
      const startsNow = new Date(leave.starts_at) <= new Date();
      let updated = db.updateLeave(leave.id, {
        status: startsNow ? 'ACTIVE' : 'SCHEDULED',
        decided_by: interaction.user.id,
        decided_at: new Date().toISOString(),
      });
      await interaction.update({ embeds: [leaveEmbed(updated)], components: [] });
      if (startsNow) {
        updated = (await activateLeave(interaction.guild, updated, interaction.user)).leave;
        await interaction.message.edit({ embeds: [leaveEmbed(updated)] }).catch(() => {});
      } else {
        const member = await fetchMember(interaction.guild, leave.discord_id);
        if (member) await safeDM(member.user, { embeds: [leaveEmbed(updated, { title: `${ICONS.LEAVE} Your leave was approved` })] });
        await logPersonnel(interaction.guild, { title: 'Leave Approved (Scheduled)', member: { id: leave.discord_id }, staff: interaction.user, color: COLORS.INFO, fields: { 'Leave ID': `#${leave.id}`, Starts: ts(leave.starts_at, 'D') } });
      }
      return;
    }

    if (action === 'deny') {
      const modalId = `modal:leave-deny:${leave.id}:${interaction.id}`;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(`Deny Leave Request #${leave.id}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('reason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
            )
          )
      );
      const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 300000 }).catch(() => null);
      if (!submit) return;
      if (db.getLeave(leave.id).status !== 'PENDING') return replyError(submit, 'This request was already reviewed.');

      const note = submit.fields.getTextInputValue('reason');
      const updated = db.updateLeave(leave.id, { status: 'DENIED', decided_by: interaction.user.id, decided_at: new Date().toISOString(), decision_note: note });
      await submit.update({ embeds: [leaveEmbed(updated)], components: [] });
      const member = await fetchMember(interaction.guild, leave.discord_id);
      if (member) await safeDM(member.user, { embeds: [leaveEmbed(updated, { title: `${ICONS.LEAVE} Your leave request was denied` })] });
      await logPersonnel(interaction.guild, { title: 'Leave Denied', member: { id: leave.discord_id }, staff: interaction.user, color: COLORS.DANGER, fields: { 'Leave ID': `#${leave.id}`, Reason: note } });
    }
  },
};

async function request(interaction) {
  const member = interaction.member;
  if (!getMemberRank(member)) return replyError(interaction, 'Only LAFD members with a rank can request leave.');
  if (!getChannelId('LEAVE_REQUESTS')) return replyError(interaction, 'The leave request channel is not configured. Ask a Department Head to run `/config channel`.');
  if (db.getActiveSuspension(member.id)) return replyError(interaction, 'You cannot request leave while suspended.');

  const open = db.getOpenLeave(member.id);
  if (open) return replyError(interaction, `You already have a leave that is ${STATUS_LABELS[open.status]} (#${open.id}). Use \`/leave end\` to cancel it first.`);

  const days = interaction.options.getInteger('days');
  const reason = interaction.options.getString('reason');
  const startsIn = interaction.options.getInteger('starts_in_days') ?? 0;
  const startsAt = addDays(new Date(), startsIn);
  const endsAt = addDays(startsAt, days);

  await deferEphemeral(interaction);
  syncMemberRecord(member);
  const leave = db.createLeave({
    discordId: member.id,
    type: 'LOA',
    reason,
    status: 'PENDING',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    requestedBy: member.id,
  });

  const message = await postTo(interaction.guild, 'LEAVE_REQUESTS', { embeds: [leaveEmbed(leave)], components: [reviewButtons(leave.id)] });
  if (!message) {
    db.updateLeave(leave.id, { status: 'CANCELLED', decision_note: 'Could not post request' });
    return replyError(interaction, 'Could not post your request - the bot cannot access the leave request channel. Contact a Department Head.');
  }
  db.updateLeave(leave.id, { channel_id: message.channelId, message_id: message.id });
  return replySuccess(
    interaction,
    'Leave Request Submitted',
    `Your ${days}-day leave (${ts(startsAt, 'D')} → ${ts(endsAt, 'D')}) was sent for review as #${leave.id}. You'll get a DM with the decision.`
  );
}

async function place(interaction) {
  if (!hasPermission(interaction.member, REQUIRED_LEVEL.ADMIN_LEAVE)) return replyNoPermission(interaction, REQUIRED_LEVEL.ADMIN_LEAVE);
  const target = await fetchMember(interaction.guild, interaction.options.getUser('member').id);
  if (!target) return replyError(interaction, 'That user is not in this server.');
  const authorityError = checkAuthorityOver(interaction.member, target);
  if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');

  const reason = interaction.options.getString('reason');
  const days = interaction.options.getInteger('days');
  const open = db.getOpenLeave(target.id);
  if (open?.type === 'ADMIN') return replyError(interaction, `${target} is already on administrative leave (#${open.id}).`);

  await deferEphemeral(interaction);
  const preview = baseEmbed({
    color: COLORS.WARNING,
    title: `${ICONS.LEAVE} Place on Administrative Leave?`,
    description: [
      `**Member:** ${target}`,
      `**Length:** ${days ? `${days} day(s), until ${ts(addDays(new Date(), days), 'D')}` : 'Until further notice'}`,
      `**Reason:** ${reason}`,
      open ? `\nTheir current ${LEAVE_TYPES[open.type].name} (#${open.id}) will be closed.` : '',
      '\nTheir active shift (if any) will be ended.',
    ].join('\n'),
  });
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Place on Leave', danger: true });
  if (!confirmed) return;

  if (open) {
    if (open.status === 'ACTIVE') await endLeave(interaction.guild, open, { actor: interaction.user, reason: 'Superseded by administrative leave' });
    else db.updateLeave(open.id, { status: 'CANCELLED', ended_by: interaction.user.id, ended_at: new Date().toISOString(), decision_note: 'Superseded by administrative leave' });
  }

  syncMemberRecord(target);
  const leave = db.createLeave({
    discordId: target.id,
    type: 'ADMIN',
    reason,
    status: 'ACTIVE',
    startsAt: new Date().toISOString(),
    endsAt: days ? addDays(new Date(), days).toISOString() : null,
    requestedBy: interaction.user.id,
  });
  const { leave: active, roleFailed } = await activateLeave(interaction.guild, leave, interaction.user);
  return interaction.editReply({
    content: roleFailed.length ? `⚠️ Could not add role: ${roleFailed.join(', ')}` : null,
    embeds: [leaveEmbed(active)],
    components: [],
  });
}

async function end(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  const reason = interaction.options.getString('reason');
  const isSelf = user.id === interaction.user.id;
  const leave = db.getOpenLeave(user.id);
  if (!leave) return replyError(interaction, `${isSelf ? 'You have' : `${user} has`} no pending, scheduled or active leave.`);

  if (isSelf) {
    if (leave.type === 'ADMIN') return replyError(interaction, 'Administrative leave can only be ended by staff.');
  } else {
    const required = leave.type === 'ADMIN' ? REQUIRED_LEVEL.ADMIN_LEAVE : REQUIRED_LEVEL.LEAVE_MANAGE;
    if (!hasPermission(interaction.member, required)) return replyNoPermission(interaction, required);
    const target = await fetchMember(interaction.guild, user.id);
    if (target) {
      const authorityError = checkAuthorityOver(interaction.member, target);
      if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');
    }
  }

  await deferEphemeral(interaction);
  let updated;
  if (leave.status === 'ACTIVE') {
    updated = await endLeave(interaction.guild, leave, { actor: interaction.user, reason: reason || (isSelf ? 'Returned early' : null) });
  } else {
    updated = db.updateLeave(leave.id, { status: 'CANCELLED', ended_by: interaction.user.id, ended_at: new Date().toISOString(), decision_note: reason || 'Cancelled' });
    await refreshRequestMessage(interaction.guild, updated);
    await logPersonnel(interaction.guild, { title: 'Leave Cancelled', member: { id: user.id }, staff: interaction.user, color: COLORS.NEUTRAL, fields: { 'Leave ID': `#${leave.id}`, Reason: reason } });
  }
  return interaction.editReply({ embeds: [leaveEmbed(updated)] });
}

async function status(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  if (user.id !== interaction.user.id && !hasPermission(interaction.member, REQUIRED_LEVEL.LEAVE_MANAGE)) {
    return replyNoPermission(interaction, REQUIRED_LEVEL.LEAVE_MANAGE);
  }
  const open = db.getOpenLeave(user.id);
  const past = db.getLeaveHistory(user.id, 6).filter((l) => l.id !== open?.id);
  const embeds = [open ? leaveEmbed(open) : baseEmbed({ color: COLORS.NEUTRAL, title: `${ICONS.LEAVE} Leave Status • ${user.username}`, description: 'No current leave.' })];
  if (past.length) {
    embeds.push(
      baseEmbed({
        color: COLORS.NEUTRAL,
        title: 'Previous Leave',
        description: past
          .map((l) => `#${l.id} • ${LEAVE_TYPES[l.type].name} • ${STATUS_LABELS[l.status]} • ${ts(l.starts_at, 'd')}${l.ends_at ? ` → ${ts(l.ends_at, 'd')}` : ''}`)
          .join('\n'),
      })
    );
  }
  return interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

async function list(interaction) {
  if (!hasPermission(interaction.member, REQUIRED_LEVEL.LEAVE_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.LEAVE_MANAGE);
  const rows = db.getLeavesByStatus(['ACTIVE', 'SCHEDULED', 'PENDING']);
  const lines = rows.map(
    (l) =>
      `${STATUS_LABELS[l.status]} • **#${l.id}** <@${l.discord_id}> — ${LEAVE_TYPES[l.type].name}\n> ${ts(l.starts_at, 'd')} → ${l.ends_at ? ts(l.ends_at, 'd') : 'TBD'} • ${truncate(l.reason, 100)}`
  );
  const pages = (lines.length ? chunkLines(lines, 3500, 10) : [['Nobody is on or waiting for leave.']]).map((chunk) =>
    baseEmbed({ color: COLORS.INFO, title: `${ICONS.LEAVE} Department Leave (${rows.length})`, description: chunk.join('\n\n') })
  );
  return sendPaginated(interaction, pages);
}
