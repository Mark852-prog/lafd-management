/**
 * branding.config.js
 * -----------------------------------------------------------------------
 * Visual identity used across every embed. Re-theme the bot here without
 * touching command logic.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

const LOGO_URL = process.env.LAFD_LOGO_URL || null;
const DEPARTMENT_NAME = process.env.DEPARTMENT_NAME || 'Los Angeles Fire Department';
const DEPARTMENT_SHORT = process.env.DEPARTMENT_SHORT || 'LAFD';

const COLORS = {
  FIRE: 0xb3261e, // fire engine red
  EMS: 0x1f5fae, // EMS blue
  NEUTRAL: 0x2b2f36, // dark slate
  BRAND: 0x9e1b1b, // LAFD crimson
  SUCCESS: 0x2e9e5b,
  WARNING: 0xe0a100,
  DANGER: 0xd93a3a,
  INFO: 0x3a7bd5,
  GOLD: 0xc9a227, // commendations / promotions
};

const ICONS = {
  FIRE: '🔥',
  EMS: '🚑',
  BADGE: '🎖️',
  CALLSIGN: '📻',
  SHIFT: '🕒',
  ROSTER: '📋',
  DISCIPLINE: '⚖️',
  ANNOUNCEMENT: '📢',
  PROMOTION: '⬆️',
  DEMOTION: '⬇️',
  DENY: '❌',
  APPROVE: '✅',
  LEAVE: '🌴',
  INCIDENT: '🚒',
  TRAINING: '🎓',
  SESSION: '📡',
  CERT: '📜',
  STAR: '⭐',
  BLACKLIST: '⛔',
  CONFIG: '⚙️',
  ACTIVITY: '📊',
  ON: '🟢',
  OFF: '⚫',
  AWAY: '🟡',
  ALERT: '🔴',
};

const FOOTER_TEXT = `${DEPARTMENT_NAME} • ${DEPARTMENT_SHORT} Management`;

module.exports = { LOGO_URL, DEPARTMENT_NAME, DEPARTMENT_SHORT, COLORS, ICONS, FOOTER_TEXT };
