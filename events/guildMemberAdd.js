/**
 * events/guildMemberAdd.js
 * -----------------------------------------------------------------------
 * When someone joins:
 *   - blacklisted users trigger an alert (and a kick/ban if
 *     BLACKLIST_ACTION is set in .env)
 *   - members who left mid-suspension get the Suspended role back, so
 *     leaving and rejoining can't be used to dodge a suspension
 * -----------------------------------------------------------------------
 */

const { Events } = require('discord.js');
const { GUILD_ID, POLICY, COLORS, getRoleId } = require('../config');
const { getActiveBlacklist, getActiveSuspension } = require('../database/db');
const { logDiscipline } = require('../utils/logger');
const { addRoles } = require('../utils/members');
const { ts } = require('../utils/format');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.guild.id !== GUILD_ID || member.user.bot) return;

    const entry = getActiveBlacklist(member.id);
    if (entry) {
      let outcome = 'Alert only (BLACKLIST_ACTION=alert)';
      try {
        if (POLICY.BLACKLIST_ACTION === 'kick') {
          await member.kick(`LAFD blacklist #${entry.id}: ${entry.reason}`);
          outcome = 'Kicked automatically';
        } else if (POLICY.BLACKLIST_ACTION === 'ban') {
          await member.ban({ reason: `LAFD blacklist #${entry.id}: ${entry.reason}` });
          outcome = 'Banned automatically';
        }
      } catch (err) {
        outcome = `Automatic ${POLICY.BLACKLIST_ACTION} failed: ${err.message}`;
      }
      await logDiscipline(member.guild, {
        title: '⛔ Blacklisted User Joined',
        member,
        staff: null,
        color: COLORS.DANGER,
        fields: {
          'Blacklist ID': `#${entry.id}`,
          Reason: entry.reason,
          'Blacklisted On': ts(entry.added_at, 'D'),
          Expires: entry.expires_at ? ts(entry.expires_at, 'D') : 'Never',
          Outcome: outcome,
        },
      });
      return;
    }

    const suspension = getActiveSuspension(member.id);
    if (suspension) {
      await addRoles(member, [getRoleId('SUSPENDED')], `Rejoined during suspension (case #${suspension.id})`);
      await logDiscipline(member.guild, {
        title: 'Suspended Member Rejoined',
        member,
        staff: null,
        color: COLORS.WARNING,
        fields: { Case: `#${suspension.id}`, 'Suspension Ends': suspension.expires_at ? ts(suspension.expires_at, 'f') : 'Indefinite' },
      });
    }
  },
};
