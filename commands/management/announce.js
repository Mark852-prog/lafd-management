/**
 * /announce <title> <message> [image] [role]
 * -----------------------------------------------------------------------
 * Posts a polished announcement to the EXISTING LAFD announcement channel.
 * Never creates a channel.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, CHANNELS } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { announcementEmbed } = require('../../utils/embeds');
const { logManagement } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a department announcement. (Authorized management only)')
    .addStringOption((opt) => opt.setName('title').setDescription('Announcement title').setRequired(true))
    .addStringOption((opt) => opt.setName('message').setDescription('Announcement message').setRequired(true))
    .addStringOption((opt) => opt.setName('image').setDescription('Image URL (optional)').setRequired(false))
    .addRoleOption((opt) => opt.setName('role').setDescription('Role to mention (optional)').setRequired(false)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.ANNOUNCE)) {
      return replyNoPermission(interaction);
    }

    if (!CHANNELS.ANNOUNCEMENTS) {
      return replyError(interaction, 'The announcement channel has not been configured yet. Ask an administrator to set CHANNEL_ANNOUNCEMENTS in .env.');
    }

    const title = interaction.options.getString('title');
    const message = interaction.options.getString('message');
    const imageUrl = interaction.options.getString('image');
    const role = interaction.options.getRole('role');

    const embed = announcementEmbed({ title, message, imageUrl, author: interaction.user });

    try {
      const channel = await interaction.guild.channels.fetch(CHANNELS.ANNOUNCEMENTS);
      await channel.send({ content: role ? `<@&${role.id}>` : undefined, embeds: [embed] });
    } catch (err) {
      console.error('Failed to post announcement:', err);
      return replyError(interaction, 'Could not post the announcement. Check that CHANNEL_ANNOUNCEMENTS is correct and the bot can access it.');
    }

    await interaction.reply({ content: 'Announcement posted.', ephemeral: true });

    await logManagement(interaction.guild, {
      action: 'Announcement Posted',
      member: null,
      staff: interaction.user,
      details: { Title: title },
    });
  },
};
