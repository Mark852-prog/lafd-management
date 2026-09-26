/**
 * channels.config.js
 * -----------------------------------------------------------------------
 * Central place for every EXISTING channel ID the bot needs to know about.
 * The bot never creates channels - all of these must be set in .env.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

const CHANNELS = {
  CALLSIGN_REQUESTS: process.env.CHANNEL_CALLSIGN_REQUESTS || null,
  ANNOUNCEMENTS: process.env.CHANNEL_ANNOUNCEMENTS || null,
};

const LOG_CHANNELS = {
  DEFAULT: process.env.LOG_CHANNEL_DEFAULT || null,
  MANAGEMENT: process.env.LOG_CHANNEL_MANAGEMENT || process.env.LOG_CHANNEL_DEFAULT || null,
  DISCIPLINE: process.env.LOG_CHANNEL_DISCIPLINE || process.env.LOG_CHANNEL_DEFAULT || null,
  CALLSIGNS: process.env.LOG_CHANNEL_CALLSIGNS || process.env.LOG_CHANNEL_DEFAULT || null,
  SHIFTS: process.env.LOG_CHANNEL_SHIFTS || process.env.LOG_CHANNEL_DEFAULT || null,
};

module.exports = { CHANNELS, LOG_CHANNELS };
