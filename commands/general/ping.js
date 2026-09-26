const { SlashCommandBuilder } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that LAFD Management is online and responding.'),

  async execute(interaction) {
    const sent = Date.now() - interaction.createdTimestamp;
    await interaction.reply({
      embeds: [successEmbed('LAFD Management | Online', `Bot is operational. Latency: \`${sent}ms\``)],
      ephemeral: true,
    });
  },
};
