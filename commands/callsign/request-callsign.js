/**
 * /request callsign <callsign>
 * -----------------------------------------------------------------------
 * Any member can request a callsign. The request is posted to the
 * EXISTING callsign request channel with Approve/Deny buttons for
 * authorized management (see events/interactionCreate.js for the button
 * handling logic).
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getMemberRank } = require('../../config');
const { CHANNELS } = require('../../config');
const { callsignRequestEmbed, errorEmbed, successEmbed } = require('../../utils/embeds');
const { upsertMember, createCallsignRequest } = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription('Submit a request to LAFD management.')
    .addSubcommand((sub) =>
      sub
        .setName('callsign')
        .setDescription('Request a callsign.')
        .addStringOption((opt) => opt.setName('callsign').setDescription('The callsign you are requesting, e.g. FE-01').setRequired(true).setMaxLength(20))
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'callsign') return;

    const requestedCallsign = interaction.options.getString('callsign').trim().toUpperCase();
    const member = interaction.member;

    if (!CHANNELS.CALLSIGN_REQUESTS) {
      return interaction.reply({
        embeds: [errorEmbed('The callsign request channel has not been configured yet. Ask an administrator to set CHANNEL_CALLSIGN_REQUESTS in .env.')],
        ephemeral: true,
      });
    }

    const rank = getMemberRank(member);
    upsertMember({
      discordId: member.id,
      username: member.user.username,
      department: rank ? rank.department : null,
      rankRoleId: rank ? rank.roleId : null,
    });

    const requestedAt = new Date();
    const dbRequest = createCallsignRequest(member.id, requestedCallsign);

    const embed = callsignRequestEmbed({
      member,
      rankName: rank ? rank.name : 'Unranked',
      department: rank ? rank.department : null,
      requestedCallsign,
      requestedAt,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`callsign_approve_${dbRequest.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✔️'),
      new ButtonBuilder().setCustomId(`callsign_deny_${dbRequest.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('✖️')
    );

    try {
      const channel = await interaction.guild.channels.fetch(CHANNELS.CALLSIGN_REQUESTS);
      await channel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('Failed to post callsign request:', err);
      return interaction.reply({
        embeds: [errorEmbed('Could not post your request to the callsign channel. Contact an administrator.')],
        ephemeral: true,
      });
    }

    return interaction.reply({
      embeds: [successEmbed('LAFD | Callsign Request Submitted', `Your request for \`${requestedCallsign}\` has been sent to LAFD management for review.`)],
      ephemeral: true,
    });
  },
};
