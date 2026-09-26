/**
 * utils/replies.js
 * -----------------------------------------------------------------------
 * Small helpers so every command sends permission/validation errors the
 * same professional way.
 * -----------------------------------------------------------------------
 */

const { errorEmbed } = require('./embeds');

async function replyNoPermission(interaction) {
  return interaction.reply({
    embeds: [errorEmbed('You do not have the required LAFD rank/permissions to use this command.')],
    ephemeral: true,
  });
}

async function replyError(interaction, message) {
  const payload = { embeds: [errorEmbed(message)], ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

module.exports = { replyNoPermission, replyError };
