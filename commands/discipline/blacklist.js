/**
 * /blacklist add | remove | check | list
 * -----------------------------------------------------------------------
 * Bars a user from the department. Works for users who are NOT in the
 * server (paste their user ID into the user option). Blacklisted users
 * cannot be hired, and the bot alerts staff (or kicks/bans, depending on
 * BLACKLIST_ACTION in .env) if they rejoin.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver } = require('../../utils/permissions');
const { replyNoPermission, replyError, deferEphemeral } = require('../../utils/replies');
const { baseEmbed, addField } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { fetchMember, stripDepartmentRoles } = require('../../utils/members');
const { logDiscipline } = require('../../utils/logger');
const { safeDM } = require('../../utils/channels');
const { sendPaginated } = require('../../utils/paginator');
const { ts, addDays, chunkLines, truncate } = require('../../utils/format');
const { endMemberShift } = require('../../services/shifts');

module.exports = {
  category: 'Discipline',
  level: REQUIRED_LEVEL.BLACKLIST,
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Bar users from the department.')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Blacklist a user (they do not need to be in the server).')
        .addUserOption((o) => o.setName('user').setDescription('User (or paste their ID)').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
        .addIntegerOption((o) => o.setName('days').setDescription('Length in days (leave empty for permanent)').setMinValue(1).setMaxValue(3650))
        .addStringOption((o) => o.setName('evidence').setDescription('Evidence link(s)').setMaxLength(1000))
        .addStringOption((o) =>
          o
            .setName('server_action')
            .setDescription('Also remove them from the server? (default: keep)')
            .addChoices({ name: 'Keep in server (strip LAFD roles)', value: 'none' }, { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' })
        )
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Lift a blacklist.')
        .addUserOption((o) => o.setName('user').setDescription('User (or paste their ID)').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((s) =>
      s
        .setName('check')
        .setDescription("Check a user's blacklist status and history.")
        .addUserOption((o) => o.setName('user').setDescription('User (or paste their ID)').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all active blacklists.')),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.BLACKLIST)) return replyNoPermission(interaction, REQUIRED_LEVEL.BLACKLIST);
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return add(interaction);
    if (sub === 'remove') return remove(interaction);
    if (sub === 'check') return check(interaction);
    if (sub === 'list') return list(interaction);
  },
};

async function add(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const evidence = interaction.options.getString('evidence');
  const days = interaction.options.getInteger('days');
  const serverAction = interaction.options.getString('server_action') || 'none';

  if (user.bot) return replyError(interaction, 'Bots cannot be blacklisted.');
  if (user.id === interaction.user.id) return replyError(interaction, 'You cannot blacklist yourself.');
  const existing = db.getActiveBlacklist(user.id);
  if (existing) return replyError(interaction, `${user} is already blacklisted (#${existing.id}).`);

  const member = await fetchMember(interaction.guild, user.id);
  if (member) {
    const authorityError = checkAuthorityOver(interaction.member, member);
    if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');
  }

  const expiresAt = days ? addDays(new Date(), days) : null;
  await deferEphemeral(interaction);

  const preview = baseEmbed({ color: COLORS.DANGER, title: `${ICONS.BLACKLIST} Confirm Blacklist`, description: '**Review and confirm.**' });
  addField(preview, 'User', `${user} (\`${user.id}\`)`, true);
  addField(preview, 'Duration', expiresAt ? `${days} day(s) — until ${ts(expiresAt, 'D')}` : 'Permanent', true);
  addField(preview, 'In Server', member ? `Yes — ${{ none: 'LAFD roles will be removed', kick: 'will be kicked', ban: 'will be banned' }[serverAction]}` : 'No', true);
  addField(preview, 'Reason', reason);
  addField(preview, 'Evidence', evidence);
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Blacklist', danger: true });
  if (!confirmed) return;

  const entry = db.addBlacklist({ discordId: user.id, username: user.username, reason, evidence, addedBy: interaction.user.id, expiresAt: expiresAt?.toISOString() ?? null });
  let outcome = member ? 'LAFD roles removed' : 'User not in server';

  if (member) {
    await endMemberShift(interaction.guild, member.id, { endedBy: interaction.user, reason: 'Blacklisted' });
    await stripDepartmentRoles(member, `Blacklisted: ${reason}`);
    db.setMemberCallsign(member.id, null);
    db.setMemberStatus(member.id, 'TERMINATED');
    const openLeave = db.getOpenLeave(member.id);
    if (openLeave) db.updateLeave(openLeave.id, { status: 'CANCELLED', ended_by: interaction.user.id, ended_at: new Date().toISOString(), decision_note: 'Blacklisted' });

    const notice = baseEmbed({
      color: COLORS.DANGER,
      title: `${ICONS.BLACKLIST} You have been blacklisted`,
      description: `You have been blacklisted from the department${expiresAt ? ` until ${ts(expiresAt, 'D')}` : ' permanently'}.\n**Reason:** ${reason}`,
    });
    await safeDM(user, { embeds: [notice] });

    try {
      if (serverAction === 'kick') {
        await member.kick(`Blacklisted (#${entry.id}): ${reason}`);
        outcome = 'Kicked from server';
      } else if (serverAction === 'ban') {
        await member.ban({ reason: `Blacklisted (#${entry.id}): ${reason}` });
        outcome = 'Banned from server';
      }
    } catch (err) {
      outcome = `Roles removed, but ${serverAction} failed: ${err.message}`;
    }
  }

  const result = baseEmbed({ color: COLORS.DANGER, title: `${ICONS.BLACKLIST} User Blacklisted • #${entry.id}` });
  addField(result, 'User', `${user} (\`${user.id}\`)`, true);
  addField(result, 'Expires', expiresAt ? ts(expiresAt, 'D') : 'Never', true);
  addField(result, 'Outcome', outcome, true);
  addField(result, 'Reason', reason);
  await interaction.editReply({ content: null, embeds: [result], components: [] });

  await logDiscipline(interaction.guild, {
    title: `User Blacklisted • #${entry.id}`,
    member: user,
    staff: interaction.user,
    color: COLORS.DANGER,
    fields: { 'User ID': user.id, Duration: expiresAt ? `${days} day(s)` : 'Permanent', Outcome: outcome, Reason: reason, Evidence: evidence },
  });
}

async function remove(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const changed = db.removeBlacklist(user.id, interaction.user.id, reason);
  if (!changed) return replyError(interaction, `${user} is not blacklisted.`);

  await interaction.reply({
    embeds: [baseEmbed({ color: COLORS.SUCCESS, title: `${ICONS.APPROVE} Blacklist Lifted`, description: `${user} may be hired again.\n**Reason:** ${reason}` })],
    flags: MessageFlags.Ephemeral,
  });
  await logDiscipline(interaction.guild, { title: 'Blacklist Lifted', member: user, staff: interaction.user, color: COLORS.SUCCESS, fields: { Reason: reason } });
}

async function check(interaction) {
  const user = interaction.options.getUser('user');
  const active = db.getActiveBlacklist(user.id);
  const historyRows = db.getBlacklistHistory(user.id);

  const embed = baseEmbed({
    color: active ? COLORS.DANGER : COLORS.SUCCESS,
    title: `${ICONS.BLACKLIST} Blacklist Check • ${user.username}`,
    description: active
      ? `**BLACKLISTED** (#${active.id}) ${active.expires_at ? `until ${ts(active.expires_at, 'D')}` : 'permanently'}\n**Reason:** ${truncate(active.reason, 800)}`
      : '✅ Not currently blacklisted.',
  });
  if (historyRows.length) {
    addField(
      embed,
      'History',
      historyRows
        .slice(0, 8)
        .map((b) => `#${b.id} • ${ts(b.added_at, 'd')} by <@${b.added_by}> • ${b.active ? 'Active' : 'Lifted'} — ${truncate(b.reason, 80)}`)
        .join('\n')
    );
  }
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function list(interaction) {
  const rows = db.getAllActiveBlacklists();
  const lines = rows.map(
    (b) => `**#${b.id}** <@${b.discord_id}> (\`${b.discord_id}\`)\n> ${truncate(b.reason, 150)}\n> ${ts(b.added_at, 'd')} • ${b.expires_at ? `until ${ts(b.expires_at, 'd')}` : 'permanent'}`
  );
  const pages = (lines.length ? chunkLines(lines, 3500, 8) : [['No active blacklists.']]).map((chunk) =>
    baseEmbed({ color: COLORS.DANGER, title: `${ICONS.BLACKLIST} Active Blacklists (${rows.length})`, description: chunk.join('\n\n') })
  );
  return sendPaginated(interaction, pages);
}
