/**
 * events/interactionCreate.js
 * -----------------------------------------------------------------------
 * Routes every interaction:
 *   - slash commands      -> command.execute
 *   - autocomplete        -> command.autocomplete
 *   - buttons/selects/    -> the command whose `componentPrefix` matches
 *     modals                 the first segment of the customId
 *                            ("callsign:approve:12" -> /callsign)
 * Components handled by short-lived collectors (confirmations, page
 * buttons, inline modals) have no registered prefix and are ignored here.
 * -----------------------------------------------------------------------
 */

const { Events, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');

async function reportFailure(interaction, label, err) {
  console.error(`[Interactions] ${label} failed:`, err);
  const payload = {
    content: null,
    embeds: [errorEmbed('Something went wrong while processing that. The error has been logged for the bot maintainer.', 'Unexpected Error')],
    components: [],
  };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch {
    /* interaction expired - nothing else we can do */
  }
}

/** Old (v1) callsign buttons used "callsign_approve_12" - keep them working. */
function normalizeCustomId(customId) {
  const legacy = /^callsign_(approve|deny)_(\d+)$/.exec(customId);
  return legacy ? `callsign:${legacy[1]}:${legacy[2]}` : customId;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.inGuild()) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'LAFD Management commands can only be used inside the department server.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        await reportFailure(interaction, `/${interaction.commandName}`, err);
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`[Interactions] Autocomplete for /${interaction.commandName} failed:`, err);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const [prefix, ...args] = normalizeCustomId(interaction.customId).split(':');
      const handler = interaction.client.componentHandlers.get(prefix);
      if (!handler) return;
      try {
        await handler.handleComponent(interaction, args, prefix);
      } catch (err) {
        await reportFailure(interaction, `component ${interaction.customId}`, err);
      }
    }
  },
};
