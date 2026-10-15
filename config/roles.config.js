/**
 * roles.config.js
 * -----------------------------------------------------------------------
 * Rank ladders, status/division roles, and certifications.
 *
 * Role IDs are NOT hardcoded. Each entry resolves its ID at runtime via
 * config/settings.js (value saved with /config first, then .env).
 *
 * Permission levels granted by ranks (higher = more access, cumulative):
 *   4 = Department Head   (Fire Chief / Medical Director)
 *   3 = Senior Staff      (Deputy/Assistant Chiefs, Deputy/Assistant Medical Director)
 *   2 = Command Staff     (Battalion Chief, High Rank tiers, Division Medical Officer)
 *   1 = Company Officer   (Lieutenant/Captain tiers - Fire & EMS)
 *   0 = Member
 * See config/permissions.config.js for what each level can do.
 * -----------------------------------------------------------------------
 */

const { resolve } = require('./settings');

function defineRank(department, envPrefix, rank) {
  const settingKey = `rank.${department}.${rank.key}`;
  const envName = `${envPrefix}${rank.key}`;
  const def = { ...rank, department, settingKey, envName };
  Object.defineProperty(def, 'roleId', { enumerable: true, get: () => resolve(settingKey, envName) });
  return Object.freeze(def);
}

// order = position in the ladder, lowest to highest
// level = permission level the rank grants
const FIRE_RANKS = [
  { key: 'PROBATIONARY_FIREFIGHTER', name: 'Probationary Firefighter', order: 1, level: 0 },
  { key: 'FIREFIGHTER_I', name: 'Firefighter I', order: 2, level: 0 },
  { key: 'FIREFIGHTER_II', name: 'Firefighter II', order: 3, level: 0 },
  { key: 'FIREFIGHTER_III', name: 'Firefighter III', order: 4, level: 0 },
  { key: 'JUNIOR_ENGINEER', name: 'Junior Engineer', order: 5, level: 0 },
  { key: 'ENGINEER', name: 'Engineer', order: 6, level: 0 },
  { key: 'SENIOR_ENGINEER', name: 'Senior Engineer', order: 7, level: 0 },
  { key: 'LIEUTENANT', name: 'Lieutenant', order: 8, level: 1 },
  { key: 'CAPTAIN', name: 'Captain', order: 9, level: 1 },
  { key: 'BATTALION_CHIEF', name: 'Battalion Chief', order: 10, level: 2 },
  { key: 'HIGH_RANK', name: 'High Rank', order: 11, level: 2 },
  { key: 'ASSISTANT_FIRE_CHIEF', name: 'Assistant Fire Chief', order: 12, level: 3 },
  { key: 'DEPUTY_FIRE_CHIEF', name: 'Deputy Fire Chief', order: 13, level: 3 },
  { key: 'FIRE_CHIEF', name: 'Fire Chief', order: 14, level: 4 },
].map((r) => defineRank('FIRE', 'FIRE_ROLE_', r));

const EMS_RANKS = [
  { key: 'PROBATIONARY_EMT', name: 'Probationary EMT', order: 1, level: 0 },
  { key: 'EMT', name: 'EMT', order: 2, level: 0 },
  { key: 'JUNIOR_PARAMEDIC', name: 'Junior Paramedic', order: 3, level: 0 },
  { key: 'PARAMEDIC', name: 'Paramedic', order: 4, level: 0 },
  { key: 'PARAMEDIC_IN_CHARGE', name: 'Paramedic in Charge', order: 5, level: 0 },
  { key: 'JUNIOR_SUPERVISORY_MEDIC', name: 'Junior Supervisory Medic', order: 6, level: 0 },
  { key: 'SUPERVISORY_MEDIC', name: 'Supervisory Medic', order: 7, level: 0 },
  { key: 'SENIOR_SUPERVISORY_MEDIC', name: 'Senior Supervisory Medic', order: 8, level: 0 },
  { key: 'EMS_SUPERVISORY', name: 'EMS Supervisory', order: 9, level: 0 },
  { key: 'PARAMEDIC_LIEUTENANT', name: 'Paramedic Lieutenant', order: 10, level: 1 },
  { key: 'PARAMEDIC_CAPTAIN', name: 'Paramedic Captain', order: 11, level: 1 },
  { key: 'DIVISION_MEDICAL_OFFICER', name: 'Division Medical Officer', order: 12, level: 2 },
  { key: 'EMS_HIGH_RANK', name: 'EMS High Rank', order: 13, level: 2 },
  { key: 'EMS_SENIOR_HIGH_RANK', name: 'EMS Senior High Rank', order: 14, level: 2 },
  { key: 'ASSISTANT_MEDICAL_DIRECTOR', name: 'Assistant Medical Director', order: 15, level: 3 },
  { key: 'DEPUTY_MEDICAL_DIRECTOR', name: 'Deputy Medical Director', order: 16, level: 3 },
  { key: 'MEDICAL_DIRECTOR', name: 'Medical Director', order: 17, level: 4 },
].map((r) => defineRank('EMS', 'EMS_ROLE_', r));

const ALL_RANKS = [...FIRE_RANKS, ...EMS_RANKS];

const DEPARTMENTS = {
  FIRE: { key: 'FIRE', name: 'Fire Division', short: 'Fire', ranks: FIRE_RANKS, divisionRole: 'FIRE_DIVISION' },
  EMS: { key: 'EMS', name: 'EMS Division', short: 'EMS', ranks: EMS_RANKS, divisionRole: 'EMS_DIVISION' },
};

/**
 * Non-rank roles. `autoCreate` is the name used by /config autosetup when
 * the role is missing. `level` (optional) grants a permission level to
 * anyone holding the role.
 */
const ROLE_SETTINGS = {
  LAFD_MEMBER: { label: 'LAFD Member', env: 'ROLE_LAFD_MEMBER', autoCreate: 'LAFD Member', description: 'Base role every department member holds.' },
  FIRE_DIVISION: { label: 'Fire Division', env: 'ROLE_FIRE_DIVISION', autoCreate: 'Fire Division', description: 'Given to everyone holding a Fire rank.' },
  EMS_DIVISION: { label: 'EMS Division', env: 'ROLE_EMS_DIVISION', autoCreate: 'EMS Division', description: 'Given to everyone holding an EMS rank.' },
  ON_DUTY: { label: 'On Duty', env: 'ROLE_ON_DUTY', autoCreate: 'On Duty', description: 'Held while a member has an active shift.' },
  LEAVE_OF_ABSENCE: { label: 'Leave of Absence', env: 'ROLE_LEAVE_OF_ABSENCE', autoCreate: 'Leave of Absence', description: 'Held during an approved leave of absence.' },
  ADMIN_LEAVE: { label: 'Administrative Leave', env: 'ROLE_ADMIN_LEAVE', autoCreate: 'Administrative Leave', description: 'Held while placed on administrative leave by staff.' },
  SUSPENDED: { label: 'Suspended', env: 'ROLE_SUSPENDED', autoCreate: 'Suspended', description: 'Held during an active suspension.' },
  SESSION_PING: { label: 'Session Ping', env: 'ROLE_SESSION_PING', autoCreate: 'Session Ping', description: 'Pinged when a department session starts.' },
  TRAINING_PING: { label: 'Training Ping', env: 'ROLE_TRAINING_PING', autoCreate: 'Training Ping', description: 'Pinged when a training is scheduled.' },
  SUPERVISORY_TEAM: {
    label: 'Supervisory Team',
    env: ['ROLE_SUPERVISORY_TEAM', 'SPECIAL_ROLE_SUPERVISORY_TEAM'],
    autoCreate: 'Supervisory Team',
    level: 1,
    description: 'Grants Company Officer permissions (callsigns, leave, trainings).',
  },
};

/** Certifications - each can optionally be linked to a role that is granted/removed with it. */
const CERTIFICATIONS = [
  { key: 'APPARATUS_OPERATOR', name: 'Apparatus Operator', env: ['CERT_ROLE_APPARATUS_OPERATOR', 'SPECIAL_ROLE_APPARATUS_OPERATOR'] },
  { key: 'EMT_BASIC', name: 'EMT - Basic', env: 'CERT_ROLE_EMT_BASIC' },
  { key: 'ADVANCED_LIFE_SUPPORT', name: 'Advanced Life Support', env: 'CERT_ROLE_ADVANCED_LIFE_SUPPORT' },
  { key: 'HAZMAT', name: 'Hazardous Materials', env: 'CERT_ROLE_HAZMAT' },
  { key: 'TECHNICAL_RESCUE', name: 'Technical Rescue', env: 'CERT_ROLE_TECHNICAL_RESCUE' },
  { key: 'WILDLAND', name: 'Wildland Firefighting', env: 'CERT_ROLE_WILDLAND' },
  { key: 'AIR_OPERATIONS', name: 'Air Operations', env: 'CERT_ROLE_AIR_OPERATIONS' },
  { key: 'FIELD_TRAINING_OFFICER', name: 'Field Training Officer', env: 'CERT_ROLE_FIELD_TRAINING_OFFICER' },
].map((c) => {
  const def = { ...c, settingKey: `cert.${c.key}` };
  Object.defineProperty(def, 'roleId', { enumerable: true, get: () => resolve(def.settingKey, c.env) });
  return Object.freeze(def);
});

function getRoleId(key) {
  const def = ROLE_SETTINGS[key];
  if (!def) throw new Error(`Unknown role setting "${key}"`);
  return resolve(`role.${key}`, def.env);
}

function getCertification(key) {
  return CERTIFICATIONS.find((c) => c.key === key) || null;
}

function getRankByRoleId(roleId) {
  if (!roleId) return null;
  return ALL_RANKS.find((r) => r.roleId === roleId) || null;
}

function getRankByKey(department, key) {
  return (DEPARTMENTS[department]?.ranks || []).find((r) => r.key === key) || null;
}

function getRankByOrder(department, order) {
  return (DEPARTMENTS[department]?.ranks || []).find((r) => r.order === order) || null;
}

/** Every configured rank a member holds, highest first. */
function getMemberRanks(member) {
  return ALL_RANKS.filter((r) => r.roleId && member.roles.cache.has(r.roleId)).sort(compareRanks);
}

/** The member's highest rank (by permission level, then ladder position). */
function getMemberRank(member) {
  return getMemberRanks(member)[0] || null;
}

/** The member's highest rank within one department. */
function getMemberRankIn(member, department) {
  return getMemberRanks(member).find((r) => r.department === department) || null;
}

function compareRanks(a, b) {
  return b.level - a.level || b.order - a.order;
}

module.exports = {
  FIRE_RANKS,
  EMS_RANKS,
  ALL_RANKS,
  DEPARTMENTS,
  ROLE_SETTINGS,
  CERTIFICATIONS,
  getRoleId,
  getCertification,
  getRankByRoleId,
  getRankByKey,
  getRankByOrder,
  getMemberRanks,
  getMemberRank,
  getMemberRankIn,
  compareRanks,
};
