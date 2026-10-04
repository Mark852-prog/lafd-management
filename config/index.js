/**
 * config/index.js
 * -----------------------------------------------------------------------
 * Barrel file - import everything configuration-related from here.
 * Also validates that the required core env vars are present so the bot
 * fails fast with a clear message instead of crashing deep in Discord.js.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

const { FIRE_RANKS, EMS_RANKS, ALL_RANKS, SPECIAL_ROLES, getRankByRoleId, getRankByOrder, getMemberRank } = require('./roles.config');
const { CHANNELS, LOG_CHANNELS } = require('./channels.config');
const { PERMISSION_LEVELS, REQUIRED_LEVEL } = require('./permissions.config');
const { LOGO_URL, COLORS, ICONS, FOOTER_TEXT } = require('./branding.config');
const { FIRE_TIERS, EMS_TIERS, RANK_TIERS, STANDALONE_TIERS } = require('./tiers.config');
const { CHANNEL_PERMISSIONS } = require('./channel-permissions.config');

const REQUIRED_CORE_VARS = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];

function validateCoreConfig() {
  const missing = REQUIRED_CORE_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('\n[LAFD Management] Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error('\nCopy .env.example to .env and fill in these values before starting the bot.\n');
    process.exit(1);
  }

  const configuredRanks = ALL_RANKS.filter((r) => r.roleId).length;
  if (configuredRanks === 0) {
    console.warn(
      '[LAFD Management] WARNING: No rank role IDs are configured in .env. ' +
        'Promotion/demotion/roster features will not work until FIRE_ROLE_* and EMS_ROLE_* are set.'
    );
  }
}

module.exports = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  FIRE_RANKS,
  EMS_RANKS,
  ALL_RANKS,
  SPECIAL_ROLES,
  getRankByRoleId,
  getRankByOrder,
  getMemberRank,
  CHANNELS,
  LOG_CHANNELS,
  PERMISSION_LEVELS,
  REQUIRED_LEVEL,
  LOGO_URL,
  COLORS,
  ICONS,
  FOOTER_TEXT,
  FIRE_TIERS,
  EMS_TIERS,
  RANK_TIERS,
  STANDALONE_TIERS,
  CHANNEL_PERMISSIONS,
  validateCoreConfig,
};
