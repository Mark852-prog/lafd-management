/**
 * utils/confirmation.js
 * -----------------------------------------------------------------------
 * Reusable "are you sure?" confirmation flow using buttons. Used for
 * promotions, demotions, suspensions, terminations, and infraction
 * removal. Only the person who initiated the action can press the
 * buttons - everyone else gets an ephemeral rejection.
 * -----------------------------------------------------------------------
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Sends a confirmation prompt and resolves with true/false based on the
 * initiating user's button click, or null if it timed out.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - the original interaction (already replied/deferred ephemerally)
 * @param {import('discord.js').EmbedBuilder} embed - the embed describing the action to confirm
 * @param {number} timeoutMs - how long to wait for a response
 */
async function requestConfirmation(interaction, embed, timeoutMs = 30000) {
  const confirmId = `confirm_${interaction.id}`;
  const cancelId = `cancel_${interaction.id}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );

  const message = await interaction.editReply({ embeds: [embed], components: [row] });

  try {
    const buttonInteraction = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: timeoutMs,
    });

    const confirmed = buttonInteraction.customId === confirmId;
    await buttonInteraction.update({ components: [] });
    return { confirmed, followUp: buttonInteraction };
  } catch {
    await interaction.editReply({ components: [] }).catch(() => {});
    return { confirmed: false, timedOut: true };
  }
}

module.exports = { requestConfirmation };
