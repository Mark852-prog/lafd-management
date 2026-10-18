/**
 * /resign submit | withdraw | status
 * -----------------------------------------------------------------------
 * A member hands in their resignation. It is posted to the resignations
 * channel (falls back to the leave request channel) with Accept / Decline
 * buttons for Senior Staff. Accepting removes every department role, ends
 * any shift/leave, releases the callsign and marks the member RESIGNED -
 * they can be re-hired later with /rank hire.
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
const { REQUIRED_LEVEL, COLORS, getMemberRank, getChannelId } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver, getPermissionLevel } = require('../../utils/permissions');
const { replyNoPermission, replyError, replySuccess, deferEphemeral } = require('../../utils/replies');
const { baseEmbed, addField } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { fetchMember, stripDepartmentRoles, syncMemberRecord } = require('../../utils/members');
const { postTo, safeDM, fetchMessage } = require('../../utils/channels');
const { logPersonnel } = require('../../utils/logger');
const { ts, addDays, truncate } = require('../../utils/format');
const { endMemberShift } = require('../../services/shifts');

const STATUS = {
  PENDING: { label: '🟡 Pending Review', color: COLORS.WARNING },
  ACCEPTED: { label: '✅ Accepted', color: COLORS.NEUTRAL },
  DECLINED: { label: '❌ Declined', color: COLORS.DANGER },
  WITHDRAWN: { label: '↩️ Withdrawn', color: COLORS.NEUTRAL },
};

function resignationEmbed(r, title) {
  const embed = baseEmbed({ color: STATUS[r.status].color, title: title || `👋 Resignation Notice • #${r.id}` });
  addField(embed, 'Member', `<@${r.discord_id}>`, true);
  addField(embed, 'Rank', r.rank_name || 'Unranked', true);
  addField(embed, 'Status', STATUS[r.status].label, true);
  addField(embed, 'Submitted', ts(r.created_at, 'f'), true);
  addField(embed, 'Last Day', r.last_day ? ts(r.last_day, 'D') : 'Effective immediately', true);
  addField(embed, 'Reason', truncate(r.reason, 1024));
  if (r.decided_by) addField(embed, r.status === 'DECLINED' ? 'Declined By' : 'Processed By', `<@${r.decided_by}>`, true);
  addField(embed, 'Note', r.decision_note);
  return embed;
}

function reviewButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`resign:accept:${id}`).setLabel('Accept & Process').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`resign:decline:${id}`).setLabel('Decline').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
}

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.RESIGN,
  levels: { submit: REQUIRED_LEVEL.RESIGN, withdraw: REQUIRED_LEVEL.RESIGN, status: REQUIRED_LEVEL.RESIGN },
  componentPrefix: 'resign',
  data: new SlashCommandBuilder()
    .setName('resign')
    .setDescription('Hand in or manage your resignation from the department.')
    .addSubcommand((s) =>
      s
        .setName('submit')
        .setDescription('Submit your resignation (reviewed by Senior Staff).')
        .addStringOption((o) => o.setName('reason').setDescription('Why are you leaving?').setRequired(true).setMaxLength(1000))
        .addIntegerOption((o) => o.setName('notice_days').setDescription('Days until your last day (default: effective immediately)').setMinValue(0).setMaxValue(30))
    )
    .addSubcommand((s) => s.setName('withdraw').setDescription('Withdraw a resignation that has not been processed yet.'))
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Check a resignation status.')
        .addUserOption((o) => o.setName('member').setDescription('Member (Senior Staff only; defaults to you)'))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'submit') return submit(interaction);
    if (sub === 'withdraw') return withdraw(interaction);
    if (sub === 'status') return status(interaction);
  },

  async handleComponent(interaction, [action, idRaw]) {
    const resignation = db.getResignation(Number(idRaw));
    if (!resignation) return replyError(interaction, 'This resignation no longer exists.');
    if (resignation.status !== 'PENDING') return replyError(interaction, `This resignation was already ${resignation.status.toLowerCase()}.`);
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.RESIGNATION_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.RESIGNATION_MANAGE);
    if (resignation.discord_id === interaction.user.id && getPermissionLevel(interaction.member) < 5) {
      return replyError(interaction, 'You cannot process your own resignation.');
    }

    if (action === 'accept') return accept(interaction, resignation);

    if (action === 'decline') {
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`resign:declined:${resignation.id}`)
          .setTitle(`Decline Resignation #${resignation.id}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('reason').setLabel('Reason (sent to the member)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
            )
          )
      );
    }

    if (action === 'declined' && interaction.isModalSubmit()) {
      const note = interaction.fields.getTextInputValue('reason');
      const updated = db.updateResignation(resignation.id, { status: 'DECLINED', decided_by: interaction.user.id, decided_at: new Date().toISOString(), decision_note: note });
      const embed = resignationEmbed(updated);
      await interaction.update({ embeds: [embed], components: [] });
      const member = await fetchMember(interaction.guild, resignation.discord_id);
      if (member) await safeDM(member.user, { embeds: [resignationEmbed(updated, '👋 Your resignation was declined')] });
      await logPersonnel(interaction.guild, { title: 'Resignation Declined', member: { id: resignation.discord_id }, staff: interaction.user, color: COLORS.DANGER, fields: { ID: `#${resignation.id}`, Reason: note } });
    }
  },
};

async function submit(interaction) {
  const member = interaction.member;
  const rank = getMemberRank(member);
  if (!rank) return replyError(interaction, 'Only LAFD members with a rank can resign.');
  if (!getChannelId('RESIGNATIONS')) return replyError(interaction, 'No resignations channel is configured. Ask a Department Head to run `/config channel`.');
  const pending = db.getPendingResignation(member.id);
  if (pending) return replyError(interaction, `You already have a pending resignation (#${pending.id}). Use \`/resign withdraw\` to cancel it.`);

  const reason = interaction.options.getString('reason');
  const noticeDays = interaction.options.getInteger('notice_days') ?? 0;
  const lastDay = noticeDays > 0 ? addDays(new Date(), noticeDays).toISOString() : null;

  await deferEphemeral(interaction);
  const preview = baseEmbed({
    color: COLORS.WARNING,
    title: '👋 Submit your resignation?',
    description: [
      `**Rank:** ${rank.name}`,
      `**Last day:** ${lastDay ? ts(lastDay, 'D') : 'Effective immediately'}`,
      `**Reason:** ${reason}`,
      '',
      'Once Senior Staff accept it, all department roles are removed and your callsign is released. You can withdraw it until then.',
    ].join('\n'),
  });
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Submit Resignation', danger: true });
  if (!confirmed) return;

  syncMemberRecord(member);
  const resignation = db.createResignation({ discordId: member.id, reason, rankName: rank.name, lastDay });
  const message = await postTo(interaction.guild, 'RESIGNATIONS', { embeds: [resignationEmbed(resignation)], components: [reviewButtons(resignation.id)] });
  if (!message) {
    db.updateResignation(resignation.id, { status: 'WITHDRAWN', decision_note: 'Could not post notice' });
    return replyError(interaction, 'Could not post your resignation - the bot cannot access the resignations channel. Contact a Department Head.');
  }
  db.updateResignation(resignation.id, { channel_id: message.channelId, message_id: message.id });
  await logPersonnel(interaction.guild, { title: 'Resignation Submitted', member, staff: interaction.user, color: COLORS.WARNING, fields: { ID: `#${resignation.id}`, Reason: reason } });
  return replySuccess(interaction, 'Resignation Submitted', `Your resignation (#${resignation.id}) was sent to Senior Staff. You'll get a DM once it's processed. Thank you for your service.`);
}

async function withdraw(interaction) {
  const pending = db.getPendingResignation(interaction.user.id);
  if (!pending) return replyError(interaction, 'You have no pending resignation.');
  const updated = db.updateResignation(pending.id, { status: 'WITHDRAWN', decided_at: new Date().toISOString(), decision_note: 'Withdrawn by member' });
  const message = await fetchMessage(interaction.guild, pending.channel_id, pending.message_id);
  if (message) await message.edit({ embeds: [resignationEmbed(updated)], components: [] }).catch(() => {});
  await logPersonnel(interaction.guild, { title: 'Resignation Withdrawn', member: interaction.user, staff: interaction.user, color: COLORS.NEUTRAL, fields: { ID: `#${pending.id}` } });
  return replySuccess(interaction, 'Resignation Withdrawn', `Resignation #${pending.id} was withdrawn. Glad you're staying!`);
}

async function status(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  if (user.id !== interaction.user.id && !hasPermission(interaction.member, REQUIRED_LEVEL.RESIGNATION_MANAGE)) {
    return replyNoPermission(interaction, REQUIRED_LEVEL.RESIGNATION_MANAGE);
  }
  const history = db.getResignationHistory(user.id, 5);
  if (!history.length) return replySuccess(interaction, 'No Resignations', `${user.id === interaction.user.id ? 'You have' : `${user} has`} no resignations on file.`);
  return interaction.reply({ embeds: history.slice(0, 3).map((r) => resignationEmbed(r)), flags: MessageFlags.Ephemeral });
}

async function accept(interaction, resignation) {
  const member = await fetchMember(interaction.guild, resignation.discord_id);
  if (member) {
    const authorityError = checkAuthorityOver(interaction.member, member);
    if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');
  }

  await interaction.deferUpdate();
  const warnings = [];
  await endMemberShift(interaction.guild, resignation.discord_id, { endedBy: interaction.user, reason: 'Resigned' });
  const openLeave = db.getOpenLeave(resignation.discord_id);
  if (openLeave) {
    db.updateLeave(openLeave.id, { status: 'CANCELLED', ended_by: interaction.user.id, ended_at: new Date().toISOString(), decision_note: 'Member resigned' });
  }
  if (member) {
    const { failed } = await stripDepartmentRoles(member, `Resignation #${resignation.id} accepted`);
    warnings.push(...failed);
    syncMemberRecord(member);
  }
  db.setMemberCallsign(resignation.discord_id, null);
  db.setMemberStatus(resignation.discord_id, 'RESIGNED');
  db.addHistoryEntry({ discordId: resignation.discord_id, actionType: 'RESIGNATION', oldValue: resignation.rank_name, actorId: interaction.user.id, reason: resignation.reason });

  const updated = db.updateResignation(resignation.id, {
    status: 'ACCEPTED',
    decided_by: interaction.user.id,
    decided_at: new Date().toISOString(),
    decision_note: [member ? 'Department roles removed.' : 'Member had already left the server.', warnings.length ? `⚠️ Could not remove: ${warnings.join(', ')}` : null]
      .filter(Boolean)
      .join(' '),
  });
  await interaction.editReply({ embeds: [resignationEmbed(updated)], components: [] });

  if (member) {
    await safeDM(member.user, {
      embeds: [resignationEmbed(updated, '👋 Your resignation has been accepted').setDescription('Thank you for your service to the department. You are welcome back any time.')],
    });
  }
  await logPersonnel(interaction.guild, {
    title: 'Resignation Accepted',
    member: { id: resignation.discord_id },
    staff: interaction.user,
    color: COLORS.NEUTRAL,
    fields: { ID: `#${resignation.id}`, Rank: resignation.rank_name, Reason: resignation.reason },
  });
}
