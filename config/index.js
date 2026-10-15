/**
 * config/index.js
 * -----------------------------------------------------------------------
 * Barrel file - import everything configuration-related from here.
 * Also validates the required core env vars so the bot fails fast with a
 * clear message instead of crashing deep in discord.js.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

const roles = require('./roles.config');
const channels = require('./channels.config');
const permissions = require('./permissions.config');
const branding = require('./branding.config');
const department = require('./department.config');
const settings = require('./settings');

const REQUIRED_CORE_VARS = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];

const BOT_OWNER_IDS = (process.env.BOT_OWNER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function validateCoreConfig() {
  const missing = REQUIRED_CORE_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('\n[LAFD Management] Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error('\nCopy .env.example to .env and fill in these values before starting the bot.\n');
    process.exit(1);
  }

  const configuredRanks = roles.ALL_RANKS.filter((r) => r.roleId).length;
  if (configuredRanks === 0) {
    console.warn(
      '[LAFD Management] No rank roles are configured yet. Run /config rank in Discord ' +
        '(server owner or Administrators can do this) or fill in FIRE_ROLE_* / EMS_ROLE_* in .env.'
    );
  }
}

module.exports = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  BOT_OWNER_IDS,
  ...roles,
  ...channels,
  ...permissions,
  ...branding,
  ...department,
  settings,
  validateCoreConfig,
};
