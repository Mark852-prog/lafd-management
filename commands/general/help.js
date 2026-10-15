/**
 * /help
 * -----------------------------------------------------------------------
 * Lists every command the caller can actually use, grouped by category.
 * Commands above the caller's permission level are hidden.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, ApplicationCommandOptionType } = require('discord.js');
const { COLORS, ICONS, LEVEL_NAMES } = require('../../config');
const { getPermissionLevel } = require('../../utils/permissions');
const { baseEmbed } = require('../../utils/embeds');
const { sendPaginated } = require('../../utils/paginator');

const CATEGORY_ORDER = ['General', 'Personnel', 'Operations', 'Discipline', 'Management'];
const CATEGORY_ICONS = { General: '🧭', Personnel: ICONS.BADGE, Operations: ICONS.INCIDENT, Discipline: ICONS.DISCIPLINE, Management: ICONS.CONFIG };

/** Flattens a command into "/name sub" entries with their required level. */
function commandEntries(command) {
  const json = command.data.toJSON();
  const subs = (json.options || []).filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
  if (!subs.length) return [{ usage: `/${json.name}`, description: json.description, level: command.level ?? 0 }];
  return subs.map((sub) => ({
    usage: `/${json.name} ${sub.name}`,
    description: sub.description,
    level: command.levels?.[sub.name] ?? command.level ?? 0,
  }));
}

module.exports = {
  category: 'General',
  data: new SlashCommandBuilder().setName('help').setDescription('Show every LAFD Management command you have access to.'),

  async execute(interaction) {
    const level = getPermissionLevel(interaction.member);
    const byCategory = new Map();
    for (const command of interaction.client.commands.values()) {
      const entries = commandEntries(command).filter((e) => e.level <= level);
      if (!entries.length) continue;
      const category = command.category || 'General';
      byCategory.set(category, [...(byCategory.get(category) || []), ...entries]);
    }

    const categories = [...byCategory.keys()].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    const total = [...byCategory.values()].reduce((n, list) => n + list.length, 0);

    const overview = baseEmbed({
      color: COLORS.BRAND,
      title: `${ICONS.BADGE} LAFD Management • Command Guide`,
      description: [
        `Your access level: **${LEVEL_NAMES[level]}** • **${total}** commands available to you.`,
        '',
        ...categories.map((c) => `${CATEGORY_ICONS[c] || '•'} **${c}** — ${byCategory.get(c).length} command(s)`),
        '',
        'Use the ▶️ button to browse each category. Commands above your rank are hidden.',
      ].join('\n'),
    });

    const pages = [overview];
    for (const category of categories) {
      const entries = byCategory.get(category).sort((a, b) => a.usage.localeCompare(b.usage));
      pages.push(
        baseEmbed({
          color: COLORS.NEUTRAL,
          title: `${CATEGORY_ICONS[category] || ''} ${category} Commands`,
          description: entries
            .map((e) => `**\`${e.usage}\`**${e.level > 0 ? ` · *${LEVEL_NAMES[e.level]}+*` : ''}\n${e.description}`)
            .join('\n\n'),
        })
      );
    }

    return sendPaginated(interaction, pages);
  },
};
