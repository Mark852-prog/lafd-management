/**
 * /announce [channel] [ping] [image] [style]
 * -----------------------------------------------------------------------
 * Opens a form for the title and message (multi-line supported), then
 * posts a branded announcement. Defaults to the configured announcements
 * channel. Only the chosen role is pinged - never @everyone by accident.
 * -----------------------------------------------------------------------
 */

const {
  SlashCommandBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { REQUIRED_LEVEL, COLORS, ICONS, getChannelId } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed } = require('../../utils/embeds');
const { logManagement } = require('../../utils/logger');
const { isValidUrl } = require('../../utils/format');

const STYLES = {
  general: { label: 'General', color: COLORS.BRAND, icon: ICONS.ANNOUNCEMENT },
  fire: { label: 'Fire Division', color: COLORS.FIRE, icon: ICONS.FIRE },
  ems: { label: 'EMS Division', color: COLORS.EMS, icon: ICONS.EMS },
  urgent: { label: 'Urgent', color: COLORS.DANGER, icon: '🚨' },
  update: { label: 'Update / Changelog', color: COLORS.INFO, icon: '🛠️' },
};

module.exports = {
  category: 'Management',
  level: REQUIRED_LEVEL.ANNOUNCE,
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a department announcement (opens a form).')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Where to post (default: announcements channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addRoleOption((o) => o.setName('ping').setDescription('Role to ping (optional)'))
    .addStringOption((o) => o.setName('style').setDescription('Colour/icon style').addChoices(...Object.entries(STYLES).map(([value, s]) => ({ name: s.label, value }))))
    .addStringOption((o) => o.setName('image').setDescription('Image URL (optional)').setMaxLength(500)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.ANNOUNCE)) return replyNoPermission(interaction, REQUIRED_LEVEL.ANNOUNCE);

    const channelOption = interaction.options.getChannel('channel');
    const channelId = channelOption?.id || getChannelId('ANNOUNCEMENTS');
    if (!channelId) return replyError(interaction, 'No channel chosen and the announcements channel is not configured. Run `/config channel`.');
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return replyError(interaction, 'That channel could not be found.');
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return replyError(interaction, `The bot needs View Channel, Send Messages and Embed Links in ${channel}.`);
    }

    const imageUrl = interaction.options.getString('image');
    if (imageUrl && !isValidUrl(imageUrl)) return replyError(interaction, 'The image must be a full http(s) URL.');
    const role = interaction.options.getRole('ping');
    const style = STYLES[interaction.options.getString('style') || 'general'];

    const modalId = `modal:announce:${interaction.id}`;
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('New Announcement')
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('message').setLabel('Message (markdown supported)').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)
          )
        )
    );
    const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 900000 }).catch(() => null);
    if (!submit) return;

    const title = submit.fields.getTextInputValue('title');
    const message = submit.fields.getTextInputValue('message');
    const embed = baseEmbed({ color: style.color, title: `${style.icon} ${title}`, description: message });
    embed.addFields({ name: '​', value: `— <@${interaction.user.id}>` });
    if (imageUrl) embed.setImage(imageUrl);

    const isEveryone = role && role.id === interaction.guild.id;
    try {
      const sent = await channel.send({
        content: role ? (isEveryone ? '@everyone' : `<@&${role.id}>`) : null,
        embeds: [embed],
        allowedMentions: isEveryone ? { parse: ['everyone'] } : { roles: role ? [role.id] : [] },
      });
      await submit.reply({ content: `${ICONS.APPROVE} Announcement posted: ${sent.url}`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('[Announce] Failed to post:', err);
      return replyError(submit, `Could not post in ${channel}: ${err.message}`);
    }

    await logManagement(interaction.guild, {
      title: 'Announcement Posted',
      member: null,
      staff: interaction.user,
      color: COLORS.INFO,
      fields: { Title: title, Channel: `<#${channel.id}>`, Ping: role ? (isEveryone ? '@everyone' : `<@&${role.id}>`) : 'None' },
    });
  },
};
