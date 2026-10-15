/**
 * /cert grant | revoke | view | holders
 * -----------------------------------------------------------------------
 * Certifications (Apparatus Operator, Hazmat, ALS...). If a certification
 * has a role linked via /config role, that role is granted/removed too.
 * Certifications are also granted automatically by passing a
 * /training log with a certification selected.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, CERTIFICATIONS, getCertification } = require('../../config');
const db = require('../../database/db');
const { hasPermission, checkAuthorityOver } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed, addField } = require('../../utils/embeds');
const { fetchMember, addRoles, removeRoles, syncMemberRecord } = require('../../utils/members');
const { logPersonnel } = require('../../utils/logger');
const { safeDM } = require('../../utils/channels');
const { sendPaginated } = require('../../utils/paginator');
const { ts, chunkLines } = require('../../utils/format');

const CERT_CHOICES = CERTIFICATIONS.map((c) => ({ name: c.name, value: c.key }));

/** Grants a certification + its role. Shared with /training log. Returns false if already held. */
async function grantCert(guild, member, cert, actor, note) {
  syncMemberRecord(member);
  const added = db.grantCertification(member.id, cert.key, actor.id);
  const roles = await addRoles(member, [cert.roleId], `Certified: ${cert.name}`);
  if (!added) return { added: false, failed: roles.failed };
  db.addHistoryEntry({ discordId: member.id, actionType: 'CERTIFICATION', newValue: cert.name, actorId: actor.id, reason: note });
  await safeDM(member.user, {
    embeds: [baseEmbed({ color: COLORS.GOLD, title: `${ICONS.CERT} Certification Awarded`, description: `You are now certified in **${cert.name}**. Congratulations!` })],
  });
  await logPersonnel(guild, { title: 'Certification Granted', member, staff: actor, color: COLORS.SUCCESS, fields: { Certification: cert.name, Notes: note } });
  return { added: true, failed: roles.failed };
}

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.PROFILE_VIEW,
  levels: { grant: REQUIRED_LEVEL.CERT_MANAGE, revoke: REQUIRED_LEVEL.CERT_MANAGE, view: REQUIRED_LEVEL.PROFILE_VIEW, holders: REQUIRED_LEVEL.PROFILE_VIEW },
  grantCert,
  data: new SlashCommandBuilder()
    .setName('cert')
    .setDescription('Manage member certifications.')
    .addSubcommand((s) =>
      s
        .setName('grant')
        .setDescription('Award a certification to a member.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('certification').setDescription('Certification').setRequired(true).addChoices(...CERT_CHOICES))
        .addStringOption((o) => o.setName('notes').setDescription('Notes (optional)').setMaxLength(500))
    )
    .addSubcommand((s) =>
      s
        .setName('revoke')
        .setDescription('Remove a certification from a member.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('certification').setDescription('Certification').setRequired(true).addChoices(...CERT_CHOICES))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription("View a member's certifications.")
        .addUserOption((o) => o.setName('member').setDescription('Member (defaults to you)'))
    )
    .addSubcommand((s) =>
      s
        .setName('holders')
        .setDescription('List everyone holding a certification.')
        .addStringOption((o) => o.setName('certification').setDescription('Certification').setRequired(true).addChoices(...CERT_CHOICES))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cert = getCertification(interaction.options.getString('certification'));

    if (sub === 'view') {
      const user = interaction.options.getUser('member') || interaction.user;
      const certs = db.getCertifications(user.id);
      const embed = baseEmbed({ color: COLORS.INFO, title: `${ICONS.CERT} Certifications • ${user.username}` });
      embed.setDescription(
        CERTIFICATIONS.map((c) => {
          const held = certs.find((h) => h.cert_key === c.key);
          return held ? `${ICONS.APPROVE} **${c.name}** — since ${ts(held.granted_at, 'D')} (by <@${held.granted_by}>)` : `▫️ ${c.name}`;
        }).join('\n')
      );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'holders') {
      const holders = db.getCertificationHolders(cert.key);
      const lines = holders.map((h) => `• <@${h.discord_id}> — ${ts(h.granted_at, 'd')}`);
      const pages = (lines.length ? chunkLines(lines, 3500, 25) : [['Nobody holds this certification yet.']]).map((chunk) =>
        baseEmbed({ color: COLORS.INFO, title: `${ICONS.CERT} ${cert.name} • ${holders.length} holder(s)`, description: chunk.join('\n') })
      );
      return sendPaginated(interaction, pages);
    }

    if (!hasPermission(interaction.member, REQUIRED_LEVEL.CERT_MANAGE)) return replyNoPermission(interaction, REQUIRED_LEVEL.CERT_MANAGE);
    const target = await fetchMember(interaction.guild, interaction.options.getUser('member').id);
    if (!target) return replyError(interaction, 'That user is not in this server.');
    const authorityError = checkAuthorityOver(interaction.member, target);
    if (authorityError) return replyError(interaction, authorityError, 'Chain of Command');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'grant') {
      const notes = interaction.options.getString('notes');
      const { added, failed } = await grantCert(interaction.guild, target, cert, interaction.user, notes);
      if (!added) return replyError(interaction, `${target} already holds **${cert.name}**.`);
      const embed = baseEmbed({ color: COLORS.SUCCESS, title: `${ICONS.CERT} Certification Granted` });
      addField(embed, 'Member', `${target}`, true);
      addField(embed, 'Certification', cert.name, true);
      addField(embed, 'Role', cert.roleId ? `<@&${cert.roleId}>` : 'No role linked', true);
      return interaction.editReply({ content: failed.length ? `⚠️ Could not add role: ${failed.join(', ')}` : null, embeds: [embed] });
    }

    if (sub === 'revoke') {
      const reason = interaction.options.getString('reason');
      if (!db.revokeCertification(target.id, cert.key)) return replyError(interaction, `${target} does not hold **${cert.name}**.`);
      const { failed } = await removeRoles(target, [cert.roleId], `Certification revoked: ${cert.name}`);
      db.addHistoryEntry({ discordId: target.id, actionType: 'CERTIFICATION_REVOKED', oldValue: cert.name, actorId: interaction.user.id, reason });
      await logPersonnel(interaction.guild, { title: 'Certification Revoked', member: target, staff: interaction.user, color: COLORS.DANGER, fields: { Certification: cert.name, Reason: reason } });
      const embed = baseEmbed({ color: COLORS.DANGER, title: `${ICONS.CERT} Certification Revoked`, description: `Removed **${cert.name}** from ${target}.\n**Reason:** ${reason}` });
      return interaction.editReply({ content: failed.length ? `⚠️ Could not remove role: ${failed.join(', ')}` : null, embeds: [embed] });
    }
  },
};
