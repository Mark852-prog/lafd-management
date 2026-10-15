/**
 * /rank hire | promote | demote | history
 * -----------------------------------------------------------------------
 * All rank changes go through here, with chain-of-command enforcement:
 *   - you can only act on members ranked below you
 *   - you can only assign ranks below your own authority
 *   - promote must go up, demote must go down
 * Leaving the rank empty on promote/demote moves exactly one step.
 * Only EXISTING configured rank roles are ever assigned.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, DEPARTMENTS, getMemberRank, getMemberRankIn, getRankByKey } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver, checkCanAssignRank } = require('../../utils/permissions');
const { replyNoPermission, replyError, deferEphemeral } = require('../../utils/replies');
const { baseEmbed, rankChangeEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { fetchMember, applyRank, syncMemberRecord } = require('../../utils/members');
const { logManagement } = require('../../utils/logger');
const { postTo, safeDM } = require('../../utils/channels');
const { sendPaginated } = require('../../utils/paginator');
const { ts, chunkLines } = require('../../utils/format');

const DIVISION_CHOICES = [
  { name: 'Fire Division', value: 'FIRE' },
  { name: 'EMS Division', value: 'EMS' },
];

function parseRankValue(value) {
  const [department, key] = String(value || '').split(':');
  return getRankByKey(department, key);
}

/** The next configured rank above/below `order` in a department. */
function stepRank(department, order, direction) {
  const ladder = DEPARTMENTS[department].ranks.filter((r) => r.roleId);
  return direction > 0 ? ladder.find((r) => r.order > order) || null : [...ladder].reverse().find((r) => r.order < order) || null;
}

function rankStatusBlock(target) {
  if (db.getMember(target.id)?.status === 'TERMINATED') return null; // hire handles re-hiring terminated members
  if (db.getActiveSuspension(target.id)) return 'This member is currently suspended. Lift or revoke the suspension first.';
  return null;
}

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.RANK_MANAGE,
  levels: { hire: REQUIRED_LEVEL.RANK_MANAGE, promote: REQUIRED_LEVEL.RANK_MANAGE, demote: REQUIRED_LEVEL.RANK_MANAGE, history: REQUIRED_LEVEL.PROFILE_VIEW },
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Hire, promote and demote LAFD members.')
    .addSubcommand((s) =>
      s
        .setName('hire')
        .setDescription('Bring a new member into a division at a starting rank.')
        .addUserOption((o) => o.setName('member').setDescription('The new member').setRequired(true))
        .addStringOption((o) => o.setName('division').setDescription('Division to join').setRequired(true).addChoices(...DIVISION_CHOICES))
        .addStringOption((o) => o.setName('rank').setDescription('Starting rank (defaults to the lowest rank)').setAutocomplete(true))
        .addStringOption((o) => o.setName('notes').setDescription('Onboarding notes').setMaxLength(500))
    )
    .addSubcommand((s) =>
      s
        .setName('promote')
        .setDescription('Promote a member (one rank up if no rank is chosen).')
        .addUserOption((o) => o.setName('member').setDescription('Member to promote').setRequired(true))
        .addStringOption((o) => o.setName('rank').setDescription('New rank (leave empty for the next rank up)').setAutocomplete(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for the promotion').setMaxLength(1000))
        .addBooleanOption((o) => o.setName('announce').setDescription('Post to the public promotions channel (default: yes)'))
    )
    .addSubcommand((s) =>
      s
        .setName('demote')
        .setDescription('Demote a member (one rank down if no rank is chosen).')
        .addUserOption((o) => o.setName('member').setDescription('Member to demote').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for the demotion').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('rank').setDescription('New rank (leave empty for one rank down)').setAutocomplete(true))
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("View a member's full rank history.")
        .addUserOption((o) => o.setName('member').setDescription('Member to look up').setRequired(true))
    ),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused().toLowerCase();
    let candidates = [];

    if (sub === 'hire') {
      const division = interaction.options.getString('division');
      candidates = division ? DEPARTMENTS[division].ranks : [...DEPARTMENTS.FIRE.ranks, ...DEPARTMENTS.EMS.ranks];
    } else {
      const memberId = interaction.options.get('member')?.value;
      const target = memberId ? await fetchMember(interaction.guild, memberId) : null;
      const current = target ? getMemberRank(target) : null;
      if (current) {
        candidates = DEPARTMENTS[current.department].ranks.filter((r) => (sub === 'promote' ? r.order > current.order : r.order < current.order));
      } else {
        candidates = [...DEPARTMENTS.FIRE.ranks, ...DEPARTMENTS.EMS.ranks];
      }
    }

    const choices = candidates
      .filter((r) => r.roleId && r.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((r) => ({ name: `${r.name} (${DEPARTMENTS[r.department].short})`, value: `${r.department}:${r.key}` }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'history') return showHistory(interaction);

    if (!hasPermission(interaction.member, REQUIRED_LEVEL.RANK_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.RANK_MANAGE);

    const user = interaction.options.getUser('member');
    const target = await fetchMember(interaction.guild, user.id);
    if (!target) return replyError(interaction, 'That user is not in this server.');

    const authorityError = checkAuthorityOver(interaction.member, target);
    if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');

    if (sub === 'hire') return hire(interaction, target);
    return changeRank(interaction, target, sub === 'promote' ? 'PROMOTION' : 'DEMOTION');
  },
};

async function hire(interaction, target) {
  const division = interaction.options.getString('division');
  const notes = interaction.options.getString('notes');
  const rankValue = interaction.options.getString('rank');

  const blacklisted = db.getActiveBlacklist(target.id);
  if (blacklisted) return replyError(interaction, `This user is blacklisted (#${blacklisted.id}: ${blacklisted.reason}). Remove the blacklist first.`);

  const existing = getMemberRankIn(target, division);
  if (existing) return replyError(interaction, `${target} already holds **${existing.name}** in the ${DEPARTMENTS[division].name}. Use \`/rank promote\` instead.`);

  const rank = rankValue ? parseRankValue(rankValue) : DEPARTMENTS[division].ranks.find((r) => r.roleId);
  if (!rank || rank.department !== division) return replyError(interaction, 'Pick a rank from the list for the selected division.');
  if (!rank.roleId) return replyError(interaction, `**${rank.name}** has no role configured. Set it with \`/config rank\`.`);

  const assignError = checkCanAssignRank(interaction.member, rank);
  if (assignError) return replyError(interaction, assignError, 'Chain of Command');

  await deferEphemeral(interaction);
  const preview = rankChangeEmbed({ type: 'HIRE', member: target, rank, notes, actor: interaction.user }).setDescription(
    '**Review and confirm this hire.** Rank, division and LAFD member roles will be assigned.'
  );
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Confirm Hire' });
  if (!confirmed) return;

  const result = await applyRank(target, rank, `Hired by ${interaction.user.tag}`);
  if (!result.rankApplied) return roleFailure(interaction, result.failed);

  syncMemberRecord(target);
  db.setMemberStatus(target.id, 'ACTIVE');
  db.addHistoryEntry({ discordId: target.id, actionType: 'HIRE', newValue: rank.name, actorId: interaction.user.id, reason: notes });

  const embed = rankChangeEmbed({ type: 'HIRE', member: target, rank, notes, actor: interaction.user });
  await interaction.editReply({ content: warnFailed(result.failed), embeds: [embed], components: [] });
  await safeDM(target.user, {
    embeds: [embed.setDescription(`Welcome aboard! Start with \`/help\`, request a callsign with \`/callsign request\`, and clock in with \`/shift start\`.`)],
  });
  await logManagement(interaction.guild, {
    title: 'Member Hired',
    member: target,
    staff: interaction.user,
    color: COLORS.SUCCESS,
    fields: { Division: DEPARTMENTS[division].name, Rank: rank.name, Notes: notes },
  });
}

async function changeRank(interaction, target, type) {
  const isPromotion = type === 'PROMOTION';
  const rankValue = interaction.options.getString('rank');
  const reason = interaction.options.getString('reason') || (isPromotion ? 'Outstanding performance' : null);

  const statusError = rankStatusBlock(target);
  if (statusError) return replyError(interaction, statusError);

  let newRank;
  let currentRank;
  if (rankValue) {
    newRank = parseRankValue(rankValue);
    if (!newRank) return replyError(interaction, 'Pick a rank from the autocomplete list.');
    currentRank = getMemberRankIn(target, newRank.department);
    if (!currentRank) {
      return replyError(interaction, `${target} is not in the ${DEPARTMENTS[newRank.department].name}. Use \`/rank hire\` to add them to it.`);
    }
    if (isPromotion && newRank.order <= currentRank.order) return replyError(interaction, `**${newRank.name}** is not above their current rank (**${currentRank.name}**).`);
    if (!isPromotion && newRank.order >= currentRank.order) return replyError(interaction, `**${newRank.name}** is not below their current rank (**${currentRank.name}**).`);
  } else {
    currentRank = getMemberRank(target);
    if (!currentRank) return replyError(interaction, `${target} has no LAFD rank. Use \`/rank hire\` first.`);
    newRank = stepRank(currentRank.department, currentRank.order, isPromotion ? 1 : -1);
    if (!newRank) {
      return replyError(
        interaction,
        isPromotion
          ? `**${currentRank.name}** is the highest configured rank in this division.`
          : `**${currentRank.name}** is the lowest configured rank. Consider \`/discipline issue\` with Termination instead.`
      );
    }
  }

  if (!newRank.roleId) return replyError(interaction, `**${newRank.name}** has no role configured. Set it with \`/config rank\`.`);
  const assignError = checkCanAssignRank(interaction.member, newRank);
  if (assignError) return replyError(interaction, assignError, 'Chain of Command');

  await deferEphemeral(interaction);
  const embedArgs = { type, member: target, rank: newRank, oldRankName: currentRank.name, reason, actor: interaction.user };
  const preview = rankChangeEmbed(embedArgs).setDescription(`**Confirm this ${isPromotion ? 'promotion' : 'demotion'} before roles are changed.**`);
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: isPromotion ? 'Promote' : 'Demote', danger: !isPromotion });
  if (!confirmed) return;

  const result = await applyRank(target, newRank, `${isPromotion ? 'Promoted' : 'Demoted'} by ${interaction.user.tag}`);
  if (!result.rankApplied) return roleFailure(interaction, result.failed);

  syncMemberRecord(target);
  db.setMemberRank(target.id, newRank.department, newRank.roleId);
  db.addHistoryEntry({ discordId: target.id, actionType: type, oldValue: currentRank.name, newValue: newRank.name, actorId: interaction.user.id, reason });

  const embed = rankChangeEmbed(embedArgs);
  await interaction.editReply({ content: warnFailed(result.failed), embeds: [embed], components: [] });

  if (isPromotion && (interaction.options.getBoolean('announce') ?? true)) {
    await postTo(interaction.guild, 'PROMOTIONS', {
      content: `${ICONS.PROMOTION} Congratulations <@${target.id}>!`,
      embeds: [embed],
      allowedMentions: { users: [target.id] },
    });
  }
  await safeDM(target.user, { embeds: [embed] });
  await logManagement(interaction.guild, {
    title: isPromotion ? 'Promotion' : 'Demotion',
    member: target,
    staff: interaction.user,
    color: isPromotion ? COLORS.GOLD : COLORS.DANGER,
    fields: { 'Old Rank': currentRank.name, 'New Rank': newRank.name, Reason: reason },
  });
}

async function showHistory(interaction) {
  const user = interaction.options.getUser('member');
  const entries = db.getHistory(user.id, 100, ['HIRE', 'PROMOTION', 'DEMOTION', 'TERMINATION']);
  const icon = { HIRE: ICONS.BADGE, PROMOTION: ICONS.PROMOTION, DEMOTION: ICONS.DEMOTION, TERMINATION: ICONS.DENY };
  const lines = entries.map(
    (h) =>
      `${icon[h.action_type]} **${h.action_type.charAt(0) + h.action_type.slice(1).toLowerCase()}** — ${h.old_value ? `${h.old_value} → ` : ''}${h.new_value || 'Removed'}\n` +
      `   ${ts(h.created_at, 'D')}${h.actor_id ? ` by <@${h.actor_id}>` : ''}${h.reason ? ` • ${h.reason.slice(0, 120)}` : ''}`
  );
  const pages = (lines.length ? chunkLines(lines, 3500, 10) : [['No rank changes on record.']]).map((chunk) =>
    baseEmbed({ color: COLORS.NEUTRAL, title: `${ICONS.BADGE} Rank History • ${user.username}`, description: chunk.join('\n') })
  );
  return sendPaginated(interaction, pages);
}

function warnFailed(failed) {
  return failed.length ? `⚠️ Some roles could not be changed (${failed.join(', ')}). Move the bot's role above them in Server Settings → Roles.` : null;
}

function roleFailure(interaction, failed) {
  return interaction.editReply({
    content: null,
    embeds: [
      baseEmbed({
        color: COLORS.DANGER,
        title: `${ICONS.DENY} Role Update Failed`,
        description: `The bot could not update roles (${failed.join(', ') || 'unknown'}). Nothing was recorded.\nMake sure the bot has **Manage Roles** and its role is **above** every rank role.`,
      }),
    ],
    components: [],
  });
}
