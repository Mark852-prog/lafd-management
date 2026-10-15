/**
 * utils/channels.js
 * -----------------------------------------------------------------------
 * Fetch configured channels and post to them safely. A missing or
 * inaccessible channel is reported back as null - never a crash.
 * -----------------------------------------------------------------------
 */

const { getChannelId } = require('../config');

async function fetchTextChannel(guild, channelKey) {
  const channelId = getChannelId(channelKey);
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

/** Posts to a configured channel. Returns the sent Message, or null on failure. */
async function postTo(guild, channelKey, payload) {
  const channel = await fetchTextChannel(guild, channelKey);
  if (!channel) {
    console.warn(`[Channels] ${channelKey} is not configured or not accessible.`);
    return null;
  }
  try {
    return await channel.send(payload);
  } catch (err) {
    console.warn(`[Channels] Failed to post to ${channelKey} (${channel.id}): ${err.message}`);
    return null;
  }
}

/** Fetches a message the bot posted earlier (e.g. to update a request embed). */
async function fetchMessage(guild, channelId, messageId) {
  if (!channelId || !messageId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

/** Sends a DM, ignoring members who have DMs closed. Returns true on success. */
async function safeDM(user, payload) {
  try {
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

module.exports = { fetchTextChannel, postTo, fetchMessage, safeDM };
