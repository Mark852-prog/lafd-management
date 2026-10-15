/**
 * /commend <member> <award> <reason>
 * -----------------------------------------------------------------------
 * Positive recognition. Posted publicly to the commendations channel,
 * DM'd to the member, and shown on their /profile.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, DEPARTMENT_NAME } = require('../../config');
const db = require('../../database/db');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed, addField } = require('../../utils/embeds');
const { fetchMember, syncMemberRecord } = require('../../utils/members');
const { logPersonnel } = require('../../utils/logger');
const { postTo, safeDM } = require('../../utils/channels');

const AWARDS = [
  { name: 'Meritorious Service', emoji: '🎖️' },
  { name: 'Lifesaving Award', emoji: '❤️' },
  { name: 'Medal of Valor', emoji: '🏅' },
  { name: 'Leadership Excellence', emoji: '🧭' },
  { name: 'Teamwork Award', emoji: '🤝' },
  { name: 'Training Excellence', emoji: '🎓' },
  { name: 'Community Service', emoji: '🏙️' },
  { name: 'Unit Citation', emoji: '🚒' },
];

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.COMMEND,
  data: new SlashCommandBuilder()
    .setName('commend')
    .setDescription('Formally recognise a member for outstanding work.')
    .addUserOption((o) => o.setName('member').setDescription('Member to commend').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('award')
        .setDescription('Type of commendation')
        .setRequired(true)
        .addChoices(...AWARDS.map((a) => ({ name: `${a.emoji} ${a.name}`, value: a.name })))
    )
    .addStringOption((o) => o.setName('reason').setDescription('What did they do?').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.COMMEND)) return replyNoPermission(interaction, REQUIRED_LEVEL.COMMEND);

    const target = await fetchMember(interaction.guild, interaction.options.getUser('member').id);
    if (!target || target.user.bot) return replyError(interaction, 'That user is not a member of this server.');
    if (target.id === interaction.user.id) return replyError(interaction, 'You cannot commend yourself.');

    const award = AWARDS.find((a) => a.name === interaction.options.getString('award'));
    const reason = interaction.options.getString('reason');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    syncMemberRecord(target);
    const record = db.addCommendation({ discordId: target.id, issuerId: interaction.user.id, title: award.name, reason });

    const embed = baseEmbed({ color: COLORS.GOLD, title: `${award.emoji} ${award.name}` }).setThumbnail(target.displayAvatarURL());
    embed.setDescription(`<@${target.id}> has been formally commended by the ${DEPARTMENT_NAME}.`);
    addField(embed, 'Citation', reason);
    addField(embed, 'Awarded By', `<@${interaction.user.id}>`, true);
    addField(embed, 'Total Commendations', String(db.countCommendations(target.id)), true);

    const posted = await postTo(interaction.guild, 'COMMENDATIONS', { content: `${ICONS.STAR} <@${target.id}>`, embeds: [embed], allowedMentions: { users: [target.id] } });
    await safeDM(target.user, { embeds: [embed] });
    await logPersonnel(interaction.guild, { title: 'Commendation Issued', member: target, staff: interaction.user, color: COLORS.GOLD, fields: { Award: award.name, ID: `#${record.id}`, Reason: reason } });

    return interaction.editReply({
      content: posted ? null : '⚠️ Saved, but the commendations channel is not configured so nothing was posted publicly.',
      embeds: [embed],
    });
  },
};
