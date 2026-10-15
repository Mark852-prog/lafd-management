/**
 * department.config.js
 * -----------------------------------------------------------------------
 * Department policy: infraction types, incident/training/session types,
 * quotas and limits. Numeric limits can be overridden in .env.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// severity: 1 = minor, 2 = moderate, 3 = severe (severe ones need confirmation)
const INFRACTION_TYPES = [
  { key: 'NOTICE', name: 'Notice', severity: 1 },
  { key: 'VERBAL_WARNING', name: 'Verbal Warning', severity: 1 },
  { key: 'WARNING', name: 'Warning', severity: 1 },
  { key: 'STRIKE', name: 'Strike', severity: 2 },
  { key: 'SUSPENSION', name: 'Suspension', severity: 3 },
  { key: 'DEMOTION', name: 'Demotion', severity: 3 },
  { key: 'TERMINATION', name: 'Termination', severity: 3 },
];

const INCIDENT_TYPES = [
  { key: 'STRUCTURE_FIRE', name: 'Structure Fire', department: 'FIRE', emoji: '🏠' },
  { key: 'VEHICLE_FIRE', name: 'Vehicle Fire', department: 'FIRE', emoji: '🚗' },
  { key: 'WILDLAND_FIRE', name: 'Wildland / Brush Fire', department: 'FIRE', emoji: '🌲' },
  { key: 'RESCUE', name: 'Rescue / Extrication', department: 'FIRE', emoji: '🪝' },
  { key: 'HAZMAT', name: 'Hazmat', department: 'FIRE', emoji: '☣️' },
  { key: 'MEDICAL', name: 'Medical Emergency', department: 'EMS', emoji: '🩺' },
  { key: 'TRAUMA', name: 'Trauma / MVA', department: 'EMS', emoji: '🚑' },
  { key: 'CARDIAC_ARREST', name: 'Cardiac Arrest', department: 'EMS', emoji: '❤️' },
  { key: 'DOA', name: 'Dead on Arrival', department: 'EMS', emoji: '🕯️' },
  { key: 'MCI', name: 'Mass Casualty Incident', department: 'BOTH', emoji: '🚨' },
  { key: 'OTHER', name: 'Other / Public Assist', department: 'BOTH', emoji: '📋' },
];

const TRAINING_TYPES = [
  { key: 'ACADEMY', name: 'Recruit Academy', department: 'BOTH' },
  { key: 'FIRE_SUPPRESSION', name: 'Fire Suppression', department: 'FIRE' },
  { key: 'APPARATUS', name: 'Apparatus / Driver', department: 'FIRE' },
  { key: 'RESCUE', name: 'Rescue Operations', department: 'FIRE' },
  { key: 'MEDICAL', name: 'Medical / Patient Care', department: 'EMS' },
  { key: 'ADVANCED_MEDICAL', name: 'Advanced Medical', department: 'EMS' },
  { key: 'CERTIFICATION', name: 'Certification Exam', department: 'BOTH' },
  { key: 'LEADERSHIP', name: 'Leadership / Officer', department: 'BOTH' },
];

const SESSION_TYPES = [
  { key: 'DEPARTMENT', name: 'Department-wide Session', department: 'BOTH' },
  { key: 'FIRE', name: 'Fire Division Session', department: 'FIRE' },
  { key: 'EMS', name: 'EMS Division Session', department: 'EMS' },
  { key: 'JOINT', name: 'Joint Operations Session', department: 'BOTH' },
];

const POLICY = {
  WEEKLY_QUOTA_HOURS: envNumber('QUOTA_WEEKLY_HOURS', 2),
  MAX_SHIFT_HOURS: envNumber('SHIFT_MAX_HOURS', 12), // shifts longer than this are auto-ended
  MAX_LEAVE_DAYS: envNumber('LEAVE_MAX_DAYS', 60),
  CALLSIGN_PATTERN: /^[A-Z0-9][A-Z0-9-]{1,11}$/, // 2-12 chars, letters/numbers/dashes
  BLACKLIST_ACTION: ['alert', 'kick', 'ban'].includes((process.env.BLACKLIST_ACTION || '').toLowerCase())
    ? process.env.BLACKLIST_ACTION.toLowerCase()
    : 'alert',
};

const byKey = (list) => (key) => list.find((t) => t.key === key) || null;

module.exports = {
  INFRACTION_TYPES,
  INCIDENT_TYPES,
  TRAINING_TYPES,
  SESSION_TYPES,
  POLICY,
  getInfractionType: byKey(INFRACTION_TYPES),
  getIncidentType: byKey(INCIDENT_TYPES),
  getTrainingType: byKey(TRAINING_TYPES),
  getSessionType: byKey(SESSION_TYPES),
};
