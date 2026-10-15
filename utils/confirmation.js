/**
 * utils/confirmation.js
 * -----------------------------------------------------------------------
 * Reusable "are you sure?" flow with Confirm/Cancel buttons. Only the
 * person who ran the command can press them.
 * -----------------------------------------------------------------------
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { respond } = require('./replies');

/**
 * Shows `embed` with Confirm/Cancel buttons and waits for the initiating
 * user. Resolves { confirmed, timedOut }. When not confirmed, the prompt
 * is replaced with a short "cancelled"/"timed out" note automatically.
 */
async function requestConfirmation(interaction, embed, { timeoutMs = 60000, confirmLabel = 'Confirm', danger = false } = {}) {
  const confirmId = `confirm:yes:${interaction.id}`;
  const cancelId = `confirm:no:${interaction.id}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  const message = await respond(interaction, { embeds: [embed], components: [row] });
  const prompt = message ?? (await interaction.fetchReply());

  try {
    const click = await prompt.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: timeoutMs,
    });
    const confirmed = click.customId === confirmId;
    await click.update({ components: [] });
    if (!confirmed) {
      await interaction.editReply({ content: '✖️ Action cancelled. Nothing was changed.', embeds: [], components: [] });
    }
    return { confirmed, timedOut: false };
  } catch {
    await interaction
      .editReply({ content: '⌛ Confirmation timed out. Nothing was changed.', embeds: [], components: [] })
      .catch(() => {});
    return { confirmed: false, timedOut: true };
  }
}

module.exports = { requestConfirmation };
