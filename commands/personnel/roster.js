/**
 * /roster [division] [on_duty_only]
 * -----------------------------------------------------------------------
 * Live roster built from the server's actual rank roles (not just people
 * the bot has seen), grouped by division and rank, highest first.
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const { REQUIRED_LEVEL, ICONS, DEPARTMENTS, getMemberRankIn } = require('../../config');
const db = require('../../database/db');
const { baseEmbed, departmentColor } = require('../../utils/embeds');
const { fetchRankedMembers } = require('../../utils/members');
const { sendPaginated } = require('../../utils/paginator');
const { chunkLines } = require('../../utils/format');

module.exports = {
  category: 'Personnel',
  level: REQUIRED_LEVEL.ROSTER_VIEW,
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View the live LAFD roster by division and rank.')
    .addStringOption((o) =>
      o.setName('division').setDescription('Show one division only').addChoices({ name: 'Fire Division', value: 'FIRE' }, { name: 'EMS Division', value: 'EMS' })
    )
    .addBooleanOption((o) => o.setName('on_duty_only').setDescription('Only show members currently on duty')),

  async execute(interaction) {
    await interaction.deferReply();

    const division = interaction.options.getString('division');
    const onDutyOnly = interaction.options.getBoolean('on_duty_only') ?? false;

    const members = await fetchRankedMembers(interaction.guild);
    const onDuty = new Set(db.getAllActiveShifts().map((s) => s.discord_id));
    const onLeave = new Set(db.getLeavesByStatus(['ACTIVE']).map((l) => l.discord_id));

    const pages = [];
    for (const dept of Object.values(DEPARTMENTS)) {
      if (division && dept.key !== division) continue;

      const lines = [];
      let headcount = 0;
      for (const rank of [...dept.ranks].reverse()) {
        if (!rank.roleId) continue;
        const holders = members
          .filter((m) => getMemberRankIn(m, dept.key)?.roleId === rank.roleId)
          .filter((m) => !onDutyOnly || onDuty.has(m.id))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (!holders.size) continue;

        headcount += holders.size;
        lines.push(`**${rank.name}** (${holders.size})`);
        for (const m of holders.values()) {
          const callsign = db.getMember(m.id)?.callsign;
          const status = onDuty.has(m.id) ? ICONS.ON : onLeave.has(m.id) ? ICONS.AWAY : ICONS.OFF;
          lines.push(`${status} <@${m.id}>${callsign ? ` · \`${callsign}\`` : ''}`);
        }
        lines.push('');
      }

      const icon = dept.key === 'FIRE' ? ICONS.FIRE : ICONS.EMS;
      const chunks = lines.length ? chunkLines(lines, 3500, 40) : [['*No members to show.*']];
      chunks.forEach((chunk) =>
        pages.push(
          baseEmbed({
            color: departmentColor(dept.key),
            title: `${icon} ${dept.name} Roster • ${headcount} member(s)`,
            description: `${ICONS.ON} On duty  ${ICONS.AWAY} On leave  ${ICONS.OFF} Off duty\n\n${chunk.join('\n')}`,
          })
        )
      );
    }

    return sendPaginated(interaction, pages, { ephemeral: false });
  },
};
