/**
 * utils/logger.js
 * -----------------------------------------------------------------------
 * Sends structured log embeds to the configured logging channels. Each
 * category falls back to LOG_DEFAULT when its own channel isn't set, and
 * a missing channel never crashes a command.
 * -----------------------------------------------------------------------
 */

const { logEmbed } = require('./embeds');
const { postTo } = require('./channels');

function sendLog(guild, channelKey, payload) {
  return postTo(guild, channelKey, { embeds: [logEmbed(payload)], allowedMentions: { parse: [] } });
}

module.exports = {
  logManagement: (guild, payload) => sendLog(guild, 'LOG_MANAGEMENT', payload),
  logDiscipline: (guild, payload) => sendLog(guild, 'LOG_DISCIPLINE', payload),
  logCallsigns: (guild, payload) => sendLog(guild, 'LOG_CALLSIGNS', payload),
  logShifts: (guild, payload) => sendLog(guild, 'LOG_SHIFTS', payload),
  logPersonnel: (guild, payload) => sendLog(guild, 'LOG_PERSONNEL', payload),
  logOperations: (guild, payload) => sendLog(guild, 'LOG_OPERATIONS', payload),
};
