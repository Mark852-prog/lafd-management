/**
 * /discipline issue | revoke | history | case
 * -----------------------------------------------------------------------
 * One place for every disciplinary action. Severe actions (Suspension,
 * Demotion, Termination) need confirmation and are carried out
 * automatically:
 *   Suspension  -> Suspended role + shift ended, lifted automatically
 *                  after the chosen number of days
 *   Demotion    -> member drops one rank in their primary division
 *   Termination -> all department roles removed, shift/leave ended,
 *                  callsign released
 * Other types can be given an expiry in days, after which they stop
 * counting as active.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, INFRACTION_TYPES, DEPARTMENTS, getMemberRank, getRoleId } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver } = require('../../utils/permissions');
const { replyNoPermission, replyError, deferEphemeral } = require('../../utils/replies');
const { baseEmbed, addField, infractionEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { fetchMember, addRoles, removeRoles, applyRank, stripDepartmentRoles, syncMemberRecord } = require('../../utils/members');
const { logDiscipline } = require('../../utils/logger');
const { safeDM } = require('../../utils/channels');
const { sendPaginated } = require('../../utils/paginator');
const { ts, addDays, chunkLines, truncate } = require('../../utils/format');
const { endMemberShift } = require('../../services/shifts');

const typeByName = (name) => INFRACTION_TYPES.find((t) => t.name === name);

function previousRank(rank) {
  return [...DEPARTMENTS[rank.department].ranks].reverse().find((r) => r.order < rank.order && r.roleId) || null;
}

module.exports = {
  category: 'Discipline',
  level: REQUIRED_LEVEL.INFRACTION_ISSUE,
  levels: {
    issue: REQUIRED_LEVEL.INFRACTION_ISSUE,
    revoke: REQUIRED_LEVEL.INFRACTION_REMOVE,
    history: REQUIRED_LEVEL.DISCIPLINE_VIEW,
    case: REQUIRED_LEVEL.DISCIPLINE_VIEW,
  },
  data: new SlashCommandBuilder()
    .setName('discipline')
    .setDescription('Issue and manage disciplinary records.')
    .addSubcommand((s) =>
      s
        .setName('issue')
        .setDescription('Issue a disciplinary action to a member.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Type of action')
            .setRequired(true)
            .addChoices(...INFRACTION_TYPES.map((t) => ({ name: t.name, value: t.name })))
        )
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
        .addIntegerOption((o) =>
          o.setName('days').setDescription('Suspension length, or days until the record expires (optional for other types)').setMinValue(1).setMaxValue(365)
        )
        .addStringOption((o) => o.setName('notes').setDescription('Internal notes').setMaxLength(1000))
        .addStringOption((o) => o.setName('evidence').setDescription('Evidence link(s)').setMaxLength(1000))
    )
    .addSubcommand((s) =>
      s
        .setName('revoke')
        .setDescription('Remove (void) a disciplinary record.')
        .addIntegerOption((o) => o.setName('case').setDescription('Case number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('Why is it being removed?').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("View a member's disciplinary history.")
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addBooleanOption((o) => o.setName('include_removed').setDescription('Include removed/expired records (default: yes)'))
    )
    .addSubcommand((s) =>
      s
        .setName('case')
        .setDescription('View one disciplinary case in full.')
        .addIntegerOption((o) => o.setName('case').setDescription('Case number').setRequired(true).setMinValue(1))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const required = module.exports.levels[sub];
    if (!hasPermission(interaction.member, required)) return replyNoPermission(interaction, required);

    if (sub === 'issue') return issue(interaction);
    if (sub === 'revoke') return revoke(interaction);
    if (sub === 'history') return history(interaction);
    if (sub === 'case') return showCase(interaction);
  },
};

async function issue(interaction) {
  const target = await fetchMember(interaction.guild, interaction.options.getUser('member').id);
  if (!target) return replyError(interaction, 'That user is not in this server. To bar them from the department, use `/blacklist add`.');
  const authorityError = checkAuthorityOver(interaction.member, target);
  if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');

  const type = typeByName(interaction.options.getString('type'));
  const reason = interaction.options.getString('reason');
  const notes = interaction.options.getString('notes');
  const evidence = interaction.options.getString('evidence');
  const days = interaction.options.getInteger('days');
  const rank = getMemberRank(target);

  let effect = days ? `Record expires ${ts(addDays(new Date(), days), 'D')}` : null;
  let demoteTo = null;

  if (type.key === 'SUSPENSION') {
    if (!days) return replyError(interaction, 'Suspensions need a length - set the `days` option.');
    if (db.getActiveSuspension(target.id)) return replyError(interaction, `${target} is already suspended.`);
    effect = `Suspended for **${days} day(s)** — lifted automatically ${ts(addDays(new Date(), days), 'R')}.${getRoleId('SUSPENDED') ? '' : '\n⚠️ No Suspended role is configured.'}`;
  } else if (type.key === 'DEMOTION') {
    if (!rank) return replyError(interaction, `${target} has no rank to demote from.`);
    demoteTo = previousRank(rank);
    if (!demoteTo) return replyError(interaction, `**${rank.name}** is the lowest configured rank. Consider a Termination instead.`);
    effect = `Rank change: ${rank.name} → **${demoteTo.name}**`;
  } else if (type.key === 'TERMINATION') {
    effect = 'All department roles removed, active shift/leave ended, callsign released.';
  }

  await deferEphemeral(interaction);
  const embedArgs = { infractionType: type, member: target, rankName: rank?.name, issuer: interaction.user, extra: { reason, notes, evidence, effect } };

  if (type.severity >= 3) {
    const preview = infractionEmbed(embedArgs).setDescription(`**Confirm this ${type.name.toLowerCase()}.** The effects below are applied immediately.`);
    const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: `Issue ${type.name}`, danger: true });
    if (!confirmed) return;
  }

  syncMemberRecord(target);
  const warnings = [];

  if (type.key === 'SUSPENSION') {
    const { failed } = await addRoles(target, [getRoleId('SUSPENDED')], `Suspended: ${reason}`);
    warnings.push(...failed);
    await endMemberShift(interaction.guild, target.id, { endedBy: interaction.user, reason: 'Suspended' });
  } else if (type.key === 'DEMOTION') {
    const result = await applyRank(target, demoteTo, `Disciplinary demotion by ${interaction.user.tag}`);
    if (!result.rankApplied) return replyError(interaction, `Could not change roles (${result.failed.join(', ')}). Check the bot's role position. Nothing was recorded.`);
    warnings.push(...result.failed);
    db.setMemberRank(target.id, demoteTo.department, demoteTo.roleId);
    db.addHistoryEntry({ discordId: target.id, actionType: 'DEMOTION', oldValue: rank.name, newValue: demoteTo.name, actorId: interaction.user.id, reason });
  } else if (type.key === 'TERMINATION') {
    await endMemberShift(interaction.guild, target.id, { endedBy: interaction.user, reason: 'Terminated' });
    const openLeave = db.getOpenLeave(target.id);
    if (openLeave) db.updateLeave(openLeave.id, { status: 'CANCELLED', ended_by: interaction.user.id, ended_at: new Date().toISOString(), decision_note: 'Member terminated' });
    const { failed } = await stripDepartmentRoles(target, `Terminated: ${reason}`);
    warnings.push(...failed);
    db.setMemberCallsign(target.id, null);
    db.setMemberStatus(target.id, 'TERMINATED');
    db.addHistoryEntry({ discordId: target.id, actionType: 'TERMINATION', oldValue: rank?.name, newValue: null, actorId: interaction.user.id, reason });
  }

  const expiresAt = days ? addDays(new Date(), days).toISOString() : null;
  const record = db.addInfraction({ discordId: target.id, issuerId: interaction.user.id, type: type.name, reason, notes, evidence, expiresAt });
  const finalEmbed = infractionEmbed({ ...embedArgs, record });

  await interaction.editReply({
    content: warnings.length ? `⚠️ Recorded, but some roles could not be changed: ${warnings.join(', ')}` : null,
    embeds: [finalEmbed],
    components: [],
  });

  const dmEmbed = infractionEmbed({ ...embedArgs, record, extra: { reason, evidence, effect } });
  dmEmbed.data.fields = dmEmbed.data.fields.filter((f) => f.name !== 'Notes'); // internal notes stay internal
  const dmSent = await safeDM(target.user, { embeds: [dmEmbed] });

  await logDiscipline(interaction.guild, {
    title: `${type.name} Issued • Case #${record.id}`,
    member: target,
    staff: interaction.user,
    color: type.severity >= 3 ? COLORS.DANGER : COLORS.WARNING,
    fields: { Reason: reason, Effect: effect, Notes: notes, Evidence: evidence, 'Member Notified': dmSent ? 'Yes (DM)' : 'No - DMs closed' },
  });
}

async function revoke(interaction) {
  const record = db.getInfractionById(interaction.options.getInteger('case'));
  const reason = interaction.options.getString('reason');
  if (!record) return replyError(interaction, 'No case with that number exists.');
  if (!record.active) return replyError(interaction, `Case #${record.id} is already inactive (${record.removed_reason || 'removed'}).`);
  if (record.discord_id === interaction.user.id) return replyError(interaction, 'You cannot revoke a record issued against yourself.');

  await deferEphemeral(interaction);
  const preview = baseEmbed({ color: COLORS.WARNING, title: `Revoke Case #${record.id}?`, description: '**Confirm removal of this record.**' });
  addField(preview, 'Member', `<@${record.discord_id}>`, true);
  addField(preview, 'Type', record.type, true);
  addField(preview, 'Issued', ts(record.created_at, 'D'), true);
  addField(preview, 'Original Reason', record.reason);
  addField(preview, 'Removal Reason', reason);
  if (record.type === 'Demotion' || record.type === 'Termination') {
    addField(preview, 'Note', 'Roles are **not** restored automatically. Use `/rank` to restore rank if needed.');
  }
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Revoke Record' });
  if (!confirmed) return;

  const runningSuspension = record.type === 'Suspension' && !record.expired;
  db.removeInfraction(record.id, interaction.user.id, reason);
  if (runningSuspension) {
    const member = await fetchMember(interaction.guild, record.discord_id);
    if (member) await removeRoles(member, [getRoleId('SUSPENDED')], `Suspension revoked (case #${record.id})`);
  }

  const result = baseEmbed({ color: COLORS.SUCCESS, title: `${ICONS.APPROVE} Case #${record.id} Revoked` });
  addField(result, 'Member', `<@${record.discord_id}>`, true);
  addField(result, 'Type', record.type, true);
  addField(result, 'Reason', reason);
  if (runningSuspension) addField(result, 'Effect', 'Suspension lifted and Suspended role removed.');
  await interaction.editReply({ content: null, embeds: [result], components: [] });

  await logDiscipline(interaction.guild, {
    title: `Record Revoked • Case #${record.id}`,
    member: { id: record.discord_id },
    staff: interaction.user,
    color: COLORS.SUCCESS,
    fields: { Type: record.type, 'Removal Reason': reason },
  });
}

async function history(interaction) {
  const user = interaction.options.getUser('member');
  const includeRemoved = interaction.options.getBoolean('include_removed') ?? true;
  const records = db.getInfractions(user.id, includeRemoved);
  const activeCount = records.filter((r) => r.active).length;

  const lines = records.map((r) => {
    const status = r.active ? (r.type === 'Suspension' && !r.expired ? '🔴 Serving' : '🟠 Active') : r.removed_reason === 'Expired' ? '⌛ Expired' : '⚪ Removed';
    return [
      `**Case #${r.id} — ${r.type}** · ${status}`,
      `> ${truncate(r.reason, 200)}`,
      `> ${ts(r.created_at, 'D')} by <@${r.issuer_id}>${r.expires_at ? ` · ${r.active ? 'expires' : 'expired'} ${ts(r.expires_at, 'D')}` : ''}`,
      !r.active && r.removed_by ? `> Removed by <@${r.removed_by}>: ${truncate(r.removed_reason, 120)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  });

  const pages = (lines.length ? chunkLines(lines, 3500, 6) : [['No disciplinary records on file. ✅']]).map((chunk) =>
    baseEmbed({
      color: activeCount ? COLORS.WARNING : COLORS.SUCCESS,
      title: `${ICONS.DISCIPLINE} Disciplinary History • ${user.username}`,
      description: `**${activeCount}** active • **${records.length}** shown\n\n${chunk.join('\n\n')}`,
    })
  );
  return sendPaginated(interaction, pages);
}

async function showCase(interaction) {
  const record = db.getInfractionById(interaction.options.getInteger('case'));
  if (!record) return replyError(interaction, 'No case with that number exists.');
  const embed = baseEmbed({ color: record.active ? COLORS.WARNING : COLORS.NEUTRAL, title: `${ICONS.DISCIPLINE} Case #${record.id} • ${record.type}` });
  addField(embed, 'Member', `<@${record.discord_id}>`, true);
  addField(embed, 'Issued By', `<@${record.issuer_id}>`, true);
  addField(embed, 'Status', record.active ? 'Active' : record.removed_reason === 'Expired' ? 'Expired' : 'Removed', true);
  addField(embed, 'Issued', ts(record.created_at, 'F'), true);
  addField(embed, record.type === 'Suspension' ? 'Suspension Ends' : 'Expires', record.expires_at ? ts(record.expires_at, 'F') : null, true);
  addField(embed, 'Reason', record.reason);
  addField(embed, 'Notes', record.notes);
  addField(embed, 'Evidence', record.evidence);
  if (record.removed_by) addField(embed, 'Removed', `${ts(record.removed_at, 'f')} by <@${record.removed_by}>\n${record.removed_reason}`);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
