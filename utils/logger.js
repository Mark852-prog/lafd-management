/**
 * utils/logger.js
 * -----------------------------------------------------------------------
 * Sends structured log embeds to the EXISTING configured logging channels.
 * Never creates channels. Fails quietly (with a console warning) if a
 * channel ID isn't configured or the bot can't find/access it, so a
 * missing log channel never crashes a command.
 * -----------------------------------------------------------------------
 */

const { LOG_CHANNELS, COLORS } = require('../config');
const { logEmbed } = require('./embeds');

async function sendLog(guild, channelId, { action, member, staff, details, color }) {
  if (!channelId) {
    console.warn(`[Logger] No log channel configured for action "${action}" - skipping.`);
    return;
  }

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.warn(`[Logger] Configured log channel ${channelId} is missing or not text-based.`);
      return;
    }
    await channel.send({ embeds: [logEmbed({ action, member, staff, details, color: color || COLORS.NEUTRAL })] });
  } catch (err) {
    console.warn(`[Logger] Failed to send log to channel ${channelId}:`, err.message);
  }
}

const logManagement = (guild, payload) => sendLog(guild, LOG_CHANNELS.MANAGEMENT, payload);
const logDiscipline = (guild, payload) => sendLog(guild, LOG_CHANNELS.DISCIPLINE, payload);
const logCallsigns = (guild, payload) => sendLog(guild, LOG_CHANNELS.CALLSIGNS, payload);
const logShifts = (guild, payload) => sendLog(guild, LOG_CHANNELS.SHIFTS, payload);
const logDefault = (guild, payload) => sendLog(guild, LOG_CHANNELS.DEFAULT, payload);

module.exports = { logManagement, logDiscipline, logCallsigns, logShifts, logDefault };
