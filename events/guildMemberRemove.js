/**
 * events/guildMemberRemove.js
 * -----------------------------------------------------------------------
 * Ends the shift of anyone who leaves the server while on duty so their
 * hours don't keep counting.
 * -----------------------------------------------------------------------
 */

const { Events } = require('discord.js');
const { GUILD_ID } = require('../config');
const { getActiveShift } = require('../database/db');
const { endMemberShift } = require('../services/shifts');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.guild.id !== GUILD_ID) return;
    if (!getActiveShift(member.id)) return;
    await endMemberShift(member.guild, member.id, { reason: 'Member left the server' });
  },
};
