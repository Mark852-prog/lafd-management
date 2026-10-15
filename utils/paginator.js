/**
 * utils/paginator.js
 * -----------------------------------------------------------------------
 * Sends a list of embeds as one message with ◀ / ▶ buttons. Only the user
 * who ran the command can flip pages.
 * -----------------------------------------------------------------------
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

async function sendPaginated(interaction, pages, { ephemeral = true, timeMs = 300000 } = {}) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
  }

  const total = pages.length;
  pages.forEach((embed, i) => {
    if (total > 1) {
      const footer = embed.data.footer;
      embed.setFooter({ text: `Page ${i + 1}/${total} • ${footer?.text || ''}`.trim(), iconURL: footer?.icon_url });
    }
  });

  let page = 0;
  const prevId = `pg:prev:${interaction.id}`;
  const nextId = `pg:next:${interaction.id}`;
  const row = () =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(prevId).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('pg:indicator').setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(nextId).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1)
    );

  const message = await interaction.editReply({ embeds: [pages[0]], components: total > 1 ? [row()] : [] });
  if (total <= 1) return;

  const collector = message.createMessageComponentCollector({
    filter: (i) => i.customId === prevId || i.customId === nextId,
    time: timeMs,
  });

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'Only the person who ran this command can change pages.', flags: MessageFlags.Ephemeral });
    }
    page = i.customId === prevId ? Math.max(0, page - 1) : Math.min(total - 1, page + 1);
    await i.update({ embeds: [pages[page]], components: [row()] });
  });

  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
}

module.exports = { sendPaginated };
