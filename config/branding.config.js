/**
 * branding.config.js
 * -----------------------------------------------------------------------
 * Visual identity used across every embed. Keeping this in one file makes
 * it easy to re-theme the bot later without touching command logic.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

const LOGO_URL = process.env.LAFD_LOGO_URL || null;

const COLORS = {
  FIRE: 0xc0392b, // deep red - Fire Department actions
  EMS: 0x1f6fb2, // deep blue - EMS actions
  NEUTRAL: 0x2c3440, // dark slate - general management / roster / shifts
  SUCCESS: 0x2ecc71, // approvals / confirmations
  WARNING: 0xf39c12, // notices / verbal warnings
  DANGER: 0xe74c3c, // strikes / suspensions / terminations
  ANNOUNCEMENT: 0x8e2b2b, // department-wide announcements
};

const ICONS = {
  FIRE: '🔥',
  EMS: '🚑',
  BADGE: '🎖️',
  CALLSIGN: '📻',
  SHIFT: '🕒',
  ROSTER: '📋',
  DISCIPLINE: '⚠️',
  ANNOUNCEMENT: '📢',
  PROMOTION: '⬆️',
  DEMOTION: '⬇️',
  DENY: '✖️',
  APPROVE: '✔️',
};

const FOOTER_TEXT = 'Los Angeles Fire Department | LAFD Management';

module.exports = { LOGO_URL, COLORS, ICONS, FOOTER_TEXT };
