/**
 * utils/replies.js
 * -----------------------------------------------------------------------
 * Consistent replies. Every helper works whether or not the interaction
 * has already been deferred/replied to.
 * -----------------------------------------------------------------------
 */

const { MessageFlags } = require('discord.js');
const { LEVEL_NAMES } = require('../config');
const { errorEmbed, successEmbed } = require('./embeds');

/** Replies, edits the deferred reply, or follows up - whichever is valid right now. */
async function respond(interaction, payload, { ephemeral = true } = {}) {
  if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
  return interaction.reply({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
}

function replyNoPermission(interaction, requiredLevel) {
  const needed = requiredLevel !== undefined ? ` (requires **${LEVEL_NAMES[requiredLevel]}** or higher)` : '';
  return respond(interaction, {
    embeds: [errorEmbed(`You do not have the required LAFD rank to use this${needed}.`, 'Access Denied')],
    components: [],
  });
}

const replyError = (interaction, message, title) => respond(interaction, { content: null, embeds: [errorEmbed(message, title)], components: [] });

const replySuccess = (interaction, title, message, extra = {}) =>
  respond(interaction, { content: null, embeds: [successEmbed(title, message)], components: [], ...extra });

/** Defers ephemerally (or publicly) so slow work doesn't hit Discord's 3-second limit. */
function deferEphemeral(interaction) {
  return interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

module.exports = { respond, replyNoPermission, replyError, replySuccess, deferEphemeral };
