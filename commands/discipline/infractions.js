/**
 * /infractions <member>
 * -----------------------------------------------------------------------
 * Shows a member's disciplinary history. Ephemeral and restricted to
 * authorized management only - never publicly exposed.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, COLORS } = require('../../config');
const { hasPermission } = require('../../utils/permissions');
const { replyNoPermission } = require('../../utils/replies');
const { baseEmbed } = require('../../utils/embeds');
const { getInfractions } = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infractions')
    .setDescription('View a member\'s disciplinary history. (Authorized management only)')
    .addUserOption((opt) => opt.setName('member').setDescription('The member to look up').setRequired(true)),

  async execute(interaction) {
    if (!hasPermission(interaction.member, REQUIRED_LEVEL.DISCIPLINE_VIEW)) {
      return replyNoPermission(interaction);
    }

    const targetUser = interaction.options.getUser('member');
    const records = getInfractions(targetUser.id, true);

    const embed = baseEmbed().setColor(COLORS.WARNING).setTitle(`LAFD | Disciplinary History - ${targetUser.username}`);

    if (records.length === 0) {
      embed.setDescription('No disciplinary records on file for this member.');
    } else {
      embed.setDescription(`Showing ${Math.min(records.length, 15)} of ${records.length} record(s).`);
      for (const rec of records.slice(0, 15)) {
        const status = rec.active ? 'Active' : 'Removed';
        const date = new Date(rec.created_at);
        embed.addFields({
          name: `#${rec.id} - ${rec.type} (${status})`,
          value: [
            `**Reason:** ${rec.reason}`,
            rec.notes ? `**Notes:** ${rec.notes}` : null,
            `**Issued By:** <@${rec.issuer_id}>`,
            `**Date:** <t:${Math.floor(date.getTime() / 1000)}:f>`,
            !rec.active ? `**Removed By:** <@${rec.removed_by}> - ${rec.removed_reason || 'No reason given'}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        });
      }
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
