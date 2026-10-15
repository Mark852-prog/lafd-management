/**
 * channels.config.js
 * -----------------------------------------------------------------------
 * Every channel the bot posts to. IDs resolve at runtime (value saved with
 * /config first, then .env). `visibility` controls the permissions used if
 * /config autosetup has to create the channel:
 *   public   - everyone can read, only staff/bot can post
 *   staff    - hidden from @everyone
 * `fallback` - if unset, this channel falls back to another one.
 * -----------------------------------------------------------------------
 */

const { resolve } = require('./settings');

const CHANNEL_SETTINGS = {
  ANNOUNCEMENTS: { label: 'Announcements', env: 'CHANNEL_ANNOUNCEMENTS', autoCreate: 'announcements', visibility: 'public', category: 'board', description: '/announce posts here.' },
  PROMOTIONS: { label: 'Promotions Board', env: 'CHANNEL_PROMOTIONS', autoCreate: 'promotions', visibility: 'public', category: 'board', description: 'Public promotion announcements.' },
  COMMENDATIONS: { label: 'Commendations', env: 'CHANNEL_COMMENDATIONS', autoCreate: 'commendations', visibility: 'public', category: 'board', description: '/commend posts here.' },
  SESSIONS: { label: 'Sessions', env: 'CHANNEL_SESSIONS', autoCreate: 'sessions', visibility: 'public', category: 'board', description: 'Department session (mass shift) announcements.' },
  TRAINING: { label: 'Training Board', env: 'CHANNEL_TRAINING', autoCreate: 'training-board', visibility: 'public', category: 'board', description: 'Scheduled trainings with RSVP buttons.' },
  INCIDENT_REPORTS: { label: 'Incident Reports', env: 'CHANNEL_INCIDENT_REPORTS', autoCreate: 'incident-reports', visibility: 'public', category: 'board', description: 'Filed incident reports.' },
  CALLSIGN_REQUESTS: { label: 'Callsign Requests', env: 'CHANNEL_CALLSIGN_REQUESTS', autoCreate: 'callsign-requests', visibility: 'staff', category: 'staff', description: 'Callsign requests awaiting approval.' },
  LEAVE_REQUESTS: { label: 'Leave Requests', env: 'CHANNEL_LEAVE_REQUESTS', autoCreate: 'leave-requests', visibility: 'staff', category: 'staff', description: 'Leave of absence requests awaiting approval.' },
  LOG_DEFAULT: { label: 'Logs - Default', env: 'LOG_CHANNEL_DEFAULT', autoCreate: 'lafd-logs', visibility: 'staff', category: 'logs', description: 'Fallback for any log channel left unset.' },
  LOG_MANAGEMENT: { label: 'Logs - Management', env: 'LOG_CHANNEL_MANAGEMENT', autoCreate: 'management-logs', visibility: 'staff', category: 'logs', fallback: 'LOG_DEFAULT', description: 'Rank changes, announcements, config changes.' },
  LOG_DISCIPLINE: { label: 'Logs - Discipline', env: 'LOG_CHANNEL_DISCIPLINE', autoCreate: 'discipline-logs', visibility: 'staff', category: 'logs', fallback: 'LOG_DEFAULT', description: 'Infractions, removals, blacklist.' },
  LOG_CALLSIGNS: { label: 'Logs - Callsigns', env: 'LOG_CHANNEL_CALLSIGNS', autoCreate: 'callsign-logs', visibility: 'staff', category: 'logs', fallback: 'LOG_DEFAULT', description: 'Callsign approvals, denials, assignments.' },
  LOG_SHIFTS: { label: 'Logs - Shifts', env: 'LOG_CHANNEL_SHIFTS', autoCreate: 'shift-logs', visibility: 'staff', category: 'logs', fallback: 'LOG_DEFAULT', description: 'Shift starts/ends.' },
  LOG_PERSONNEL: { label: 'Logs - Personnel', env: 'LOG_CHANNEL_PERSONNEL', autoCreate: 'personnel-logs', visibility: 'staff', category: 'logs', fallback: 'LOG_DEFAULT', description: 'Leave, certifications, commendations.' },
  LOG_OPERATIONS: { label: 'Logs - Operations', env: 'LOG_CHANNEL_OPERATIONS', autoCreate: 'operations-logs', visibility: 'staff', category: 'logs', fallback: 'LOG_DEFAULT', description: 'Sessions, trainings, incidents.' },
};

function getChannelId(key) {
  const def = CHANNEL_SETTINGS[key];
  if (!def) throw new Error(`Unknown channel setting "${key}"`);
  const value = resolve(`channel.${key}`, def.env);
  if (value) return value;
  return def.fallback ? getChannelId(def.fallback) : null;
}

module.exports = { CHANNEL_SETTINGS, getChannelId };
