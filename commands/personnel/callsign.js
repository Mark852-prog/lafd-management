/**
 * /callsign request | assign | revoke | lookup | list
 * -----------------------------------------------------------------------
 * Callsigns are unique: a callsign can only be held by one member, and a
 * member can only have one pending request. Requests are posted to the
 * callsign request channel with Approve / Deny buttons (deny asks for a
 * reason). Buttons keep working after a bot restart.
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
const { replyNoPermission, replyError, replySuccess } = require('../../utils/replies');
const { baseEmbed, addField, departmentColor } = require('../../utils/embeds');
const { fetchMember, syncMemberRecord } = require('../../utils/members');
const { logCallsigns } = require('../../utils/logger');
const { postTo, safeDM } = require('../../utils/channels');
const { sendPaginated } = require('../../utils/paginator');
const { ts, chunkLines } = require('../../utils/format');

function normalizeCallsign(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '-');
}

function validateCallsign(callsign, forUserId) {
  if (!POLICY.CALLSIGN_PATTERN.test(callsign)) return 'Callsigns must be 2-12 characters: letters, numbers and dashes (e.g. `E-12`, `M7`, `BC1`).';
  const holder = db.getMemberByCallsign(callsign);
  if (holder && holder.discord_id !== forUserId) return `\`${callsign}\` is already assigned to <@${holder.discord_id}>.`;
  return null;
}

function requestEmbed(request, { rankName, department, status, decidedBy, note } = {}) {
  const color = status === 'APPROVED' ? COLORS.SUCCESS : status === 'DENIED' ? COLORS.DANGER : departmentColor(department);
  const label = { APPROVED: `${ICONS.APPROVE} Approved`, DENIED: `${ICONS.DENY} Denied` }[status] || '🟡 Pending Review';
  const embed = baseEmbed({ color, title: `${ICONS.CALLSIGN} Callsign Request • #${request.id}` });
  addField(embed, 'Member', `<@${request.discord_id}>`, true);
  addField(embed, 'Rank', rankName || 'Unranked', true);
  addField(embed, 'Requested', `\`${request.requested_callsign}\``, true);
  addField(embed, 'Current Callsign', db.getMember(request.discord_id)?.callsign || 'None', true);
  addField(embed, 'Submitted', ts(request.requested_at, 'R'), true);
  addField(embed, 'Status', label, true);
  addField(embed, 'Reason', request.reason);
  if (decidedBy) addField(embed, status === 'DENIED' ? 'Denied By' : 'Approved By', `<@${decidedBy}>`, true);
  addField(embed, 'Note', note);
  return embed;
}

function requestButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`callsign:approve:${requestId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`callsign:deny:${requestId}`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
}

function assignCallsign(guild, member, callsign, actor, reason) {
  const previous = db.getMember(member.id)?.callsign || null;
  db.setMemberCallsign(member.id, callsign);
  db.addHistoryEntry({ discordId: member.id, actionType: 'CALLSIGN', oldValue: previous, newValue: callsign, actorId: actor.id, reason });
  return previous;
}

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.CALLSIGN_REQUEST,
  levels: {
    request: REQUIRED_LEVEL.CALLSIGN_REQUEST,
    lookup: REQUIRED_LEVEL.ROSTER_VIEW,
    list: REQUIRED_LEVEL.ROSTER_VIEW,
    assign: REQUIRED_LEVEL.CALLSIGN_MANAGE,
    revoke: REQUIRED_LEVEL.CALLSIGN_MANAGE,
  },
  componentPrefix: 'callsign',
  data: new SlashCommandBuilder()
    .setName('callsign')
    .setDescription('Request, assign and look up unit callsigns.')
    .addSubcommand((s) =>
      s
        .setName('request')
        .setDescription('Request a new callsign (reviewed by officers).')
        .addStringOption((o) => o.setName('callsign').setDescription('e.g. E-12, M7, BC1').setRequired(true).setMaxLength(12))
        .addStringOption((o) => o.setName('reason').setDescription('Why this callsign? (optional)').setMaxLength(300))
    )
    .addSubcommand((s) =>
      s
        .setName('assign')
        .setDescription('Directly assign a callsign to a member.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('callsign').setDescription('Callsign to assign').setRequired(true).setMaxLength(12))
    )
    .addSubcommand((s) =>
      s
        .setName('revoke')
        .setDescription("Remove a member's callsign.")
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((s) =>
      s
        .setName('lookup')
        .setDescription('Find out who holds a callsign.')
        .addStringOption((o) => o.setName('callsign').setDescription('Callsign').setRequired(true).setMaxLength(12))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List every assigned callsign.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'request') return request(interaction);
    if (sub === 'lookup') return lookup(interaction);
    if (sub === 'list') return list(interaction);

    if (!hasPermission(interaction.member, REQUIRED_LEVEL.CALLSIGN_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.CALLSIGN_MANAGE);
    const target = await fetchMember(interaction.guild, interaction.options.getUser('member').id);
    if (!target) return replyError(interaction, 'That user is not in this server.');
    if (target.id !== interaction.user.id) {
      const authorityError = checkAuthorityOver(interaction.member, target);
      if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');
    }
    syncMemberRecord(target);

    if (sub === 'assign') {
      const callsign = normalizeCallsign(interaction.options.getString('callsign'));
      const error = validateCallsign(callsign, target.id);
      if (error) return replyError(interaction, error);
      const previous = assignCallsign(interaction.guild, target, callsign, interaction.user, 'Assigned directly');
      await replySuccess(interaction, 'Callsign Assigned', `${target} is now \`${callsign}\`${previous ? ` (was \`${previous}\`)` : ''}.`);
      await safeDM(target.user, { embeds: [baseEmbed({ color: COLORS.SUCCESS, title: `${ICONS.CALLSIGN} Callsign Assigned`, description: `Your callsign is now \`${callsign}\`.` })] });
      return logCallsigns(interaction.guild, { title: 'Callsign Assigned', member: target, staff: interaction.user, color: COLORS.SUCCESS, fields: { Callsign: callsign, Previous: previous } });
    }

    if (sub === 'revoke') {
      const reason = interaction.options.getString('reason');
      const current = db.getMember(target.id)?.callsign;
      if (!current) return replyError(interaction, `${target} has no callsign assigned.`);
      db.setMemberCallsign(target.id, null);
      db.addHistoryEntry({ discordId: target.id, actionType: 'CALLSIGN', oldValue: current, newValue: null, actorId: interaction.user.id, reason });
      await replySuccess(interaction, 'Callsign Revoked', `Removed \`${current}\` from ${target}.`);
      return logCallsigns(interaction.guild, { title: 'Callsign Revoked', member: target, staff: interaction.user, color: COLORS.DANGER, fields: { Callsign: current, Reason: reason } });
    }
  },

  async handleComponent(interaction, [action, idRaw]) {
    const request = db.getCallsignRequest(Number(idRaw));
    if (!request) return replyError(interaction, 'This callsign request no longer exists.');
    if (request.status !== 'PENDING') return replyError(interaction, `This request was already ${request.status.toLowerCase()}.`);
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.CALLSIGN_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.CALLSIGN_MANAGE);
    if (request.discord_id === interaction.user.id && getPermissionLevel(interaction.member) < 5) {
      return replyError(interaction, 'You cannot review your own callsign request.');
    }

    const target = await fetchMember(interaction.guild, request.discord_id);
    const rank = target ? getMemberRank(target) : null;
    const embedContext = { rankName: rank?.name, department: rank?.department };

    if (action === 'approve') {
      if (!target) {
        db.decideCallsignRequest(request.id, 'DENIED', interaction.user.id, 'Member left the server');
        return interaction.update({ embeds: [requestEmbed(request, { ...embedContext, status: 'DENIED', decidedBy: interaction.user.id, note: 'Member left the server' })], components: [] });
      }
      const error = validateCallsign(request.requested_callsign, target.id);
      if (error) return replyError(interaction, `${error} Deny this request instead.`);

      db.decideCallsignRequest(request.id, 'APPROVED', interaction.user.id);
      syncMemberRecord(target);
      const previous = assignCallsign(interaction.guild, target, request.requested_callsign, interaction.user, `Request #${request.id} approved`);
      const embed = requestEmbed(request, { ...embedContext, status: 'APPROVED', decidedBy: interaction.user.id });
      await interaction.update({ embeds: [embed], components: [] });
      await safeDM(target.user, { embeds: [embed] });
      return logCallsigns(interaction.guild, {
        title: 'Callsign Approved',
        member: target,
        staff: interaction.user,
        color: COLORS.SUCCESS,
        fields: { Callsign: request.requested_callsign, Previous: previous, Request: `#${request.id}` },
      });
    }

    if (action === 'deny') {
      const modalId = `modal:callsign-deny:${request.id}:${interaction.id}`;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(`Deny Callsign Request #${request.id}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('reason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
            )
          )
      );
      const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 300000 }).catch(() => null);
      if (!submit) return;

      const fresh = db.getCallsignRequest(request.id);
      if (fresh.status !== 'PENDING') return replyError(submit, `This request was already ${fresh.status.toLowerCase()}.`);
      const note = submit.fields.getTextInputValue('reason');
      db.decideCallsignRequest(request.id, 'DENIED', interaction.user.id, note);
      const embed = requestEmbed(request, { ...embedContext, status: 'DENIED', decidedBy: interaction.user.id, note });
      await submit.update({ embeds: [embed], components: [] });
      if (target) await safeDM(target.user, { embeds: [embed] });
      return logCallsigns(interaction.guild, {
        title: 'Callsign Denied',
        member: { id: request.discord_id },
        staff: interaction.user,
        color: COLORS.DANGER,
        fields: { Requested: request.requested_callsign, Reason: note, Request: `#${request.id}` },
      });
    }
  },
};

async function request(interaction) {
  const member = interaction.member;
  const rank = getMemberRank(member);
  if (!rank) return replyError(interaction, 'Only LAFD members with a rank can request a callsign.');
  if (!getChannelId('CALLSIGN_REQUESTS')) return replyError(interaction, 'The callsign request channel is not configured. Ask a Department Head to run `/config channel`.');

  const callsign = normalizeCallsign(interaction.options.getString('callsign'));
  const reason = interaction.options.getString('reason');
  const record = syncMemberRecord(member);

  if (record?.callsign === callsign) return replyError(interaction, `\`${callsign}\` is already your callsign.`);
  const error = validateCallsign(callsign, member.id);
  if (error) return replyError(interaction, error);

  const pending = db.getPendingCallsignRequest(member.id);
  if (pending) return replyError(interaction, `You already have a pending request for \`${pending.requested_callsign}\` (#${pending.id}). Wait for it to be reviewed.`);
  const competing = db.getPendingRequestForCallsign(callsign);
  if (competing) return replyError(interaction, `Someone else already has a pending request for \`${callsign}\`.`);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = db.createCallsignRequest(member.id, callsign, reason);
  const message = await postTo(interaction.guild, 'CALLSIGN_REQUESTS', {
    embeds: [requestEmbed(created, { rankName: rank.name, department: rank.department })],
    components: [requestButtons(created.id)],
  });
  if (!message) {
    db.decideCallsignRequest(created.id, 'DENIED', interaction.client.user.id, 'Could not post request');
    return replyError(interaction, 'Could not post your request - the bot cannot access the callsign request channel. Contact a Department Head.');
  }
  db.setCallsignRequestMessage(created.id, message.channelId, message.id);
  return replySuccess(interaction, 'Callsign Request Submitted', `Your request for \`${callsign}\` (#${created.id}) was sent for review. You'll get a DM with the decision.`);
}

async function lookup(interaction) {
  const callsign = normalizeCallsign(interaction.options.getString('callsign'));
  const holder = db.getMemberByCallsign(callsign);
  const pending = db.getPendingRequestForCallsign(callsign);
  const embed = baseEmbed({ color: COLORS.INFO, title: `${ICONS.CALLSIGN} Callsign Lookup • ${callsign}` });
  addField(embed, 'Holder', holder ? `<@${holder.discord_id}>` : 'Available', true);
  if (pending) addField(embed, 'Pending Request', `<@${pending.discord_id}> (#${pending.id})`, true);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function list(interaction) {
  const rows = db.getAssignedCallsigns();
  const lines = rows.map((r) => `\`${r.callsign.padEnd(8, ' ')}\` <@${r.discord_id}>`);
  const pages = (lines.length ? chunkLines(lines, 3500, 25) : [['No callsigns assigned yet.']]).map((chunk) =>
    baseEmbed({ color: COLORS.NEUTRAL, title: `${ICONS.CALLSIGN} Assigned Callsigns (${rows.length})`, description: chunk.join('\n') })
  );
  return sendPaginated(interaction, pages);
}
