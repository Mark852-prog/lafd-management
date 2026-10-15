/**
 * config/settings.js
 * -----------------------------------------------------------------------
 * Runtime settings layer. Every role/channel ID the bot uses is resolved
 * in this order:
 *
 *   1. A value saved from Discord with /config (stored in SQLite)
 *   2. The matching variable in .env
 *
 * This means the bot can be fully configured from inside Discord without
 * editing .env or restarting, while .env-only setups keep working.
 * -----------------------------------------------------------------------
 */

const db = require('../database/db');

const cache = new Map(db.getAllSettings().map((row) => [row.key, row.value]));

function getSetting(key) {
  return cache.has(key) ? cache.get(key) : null;
}

function setSetting(key, value) {
  db.setSetting(key, value);
  cache.set(key, value);
}

function clearSetting(key) {
  db.deleteSetting(key);
  cache.delete(key);
}

function readEnv(name) {
  if (!name) return null;
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/**
 * Resolves a configured ID. `envNames` can be a single name or a list
 * (first non-empty wins - used for legacy variable names).
 * Returns { value, source } where source is 'discord' | 'env' | null.
 */
function resolveWithSource(key, envNames) {
  const saved = getSetting(key);
  if (saved) return { value: saved, source: 'discord' };
  for (const name of [].concat(envNames || [])) {
    const value = readEnv(name);
    if (value) return { value, source: 'env' };
  }
  return { value: null, source: null };
}

function resolve(key, envNames) {
  return resolveWithSource(key, envNames).value;
}

module.exports = { getSetting, setSetting, clearSetting, resolve, resolveWithSource, readEnv };
