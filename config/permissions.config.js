/**
 * permissions.config.js
 * -----------------------------------------------------------------------
 * Centralized permission levels. Change the numbers here to change what
 * each tier can do - nothing else needs to change.
 *
 * Levels are CUMULATIVE: level 3 can do everything level 1 and 2 can.
 * -----------------------------------------------------------------------
 */

const PERMISSION_LEVELS = {
  MEMBER: 0,
  COMPANY_OFFICER: 1, // Lieutenant / Captain tiers, Supervisory Team
  COMMAND_STAFF: 2, // Battalion Chief, High Rank tiers, Division Medical Officer
  SENIOR_STAFF: 3, // Deputy/Assistant Chiefs & Medical Directors
  DEPARTMENT_HEAD: 4, // Fire Chief / Medical Director
  BOT_OWNER: 5, // Server owner + BOT_OWNER_IDS in .env (cannot be locked out)
};

const LEVEL_NAMES = {
  0: 'Member',
  1: 'Company Officer',
  2: 'Command Staff',
  3: 'Senior Staff',
  4: 'Department Head',
  5: 'Bot Owner',
};

const L = PERMISSION_LEVELS;

// Minimum level required for each feature. Update these if policy changes.
const REQUIRED_LEVEL = {
  // Everyone
  CALLSIGN_REQUEST: L.MEMBER,
  ROSTER_VIEW: L.MEMBER,
  PROFILE_VIEW: L.MEMBER,
  SHIFT_SELF: L.MEMBER,
  ON_DUTY_VIEW: L.MEMBER,
  LEAVE_REQUEST: L.MEMBER,
  INCIDENT_REPORT: L.MEMBER,
  ACTIVITY_SELF: L.MEMBER,

  // Company Officer
  CALLSIGN_MANAGE: L.COMPANY_OFFICER, // approve/deny/assign/revoke callsigns
  LEAVE_MANAGE: L.COMPANY_OFFICER, // approve/deny leave, end someone's leave
  TRAINING_HOST: L.COMPANY_OFFICER,
  TRAINING_LOG: L.COMPANY_OFFICER,
  SHIFT_MANAGE: L.COMPANY_OFFICER, // force-end another member's shift
  COMMEND: L.COMPANY_OFFICER,
  ACTIVITY_OTHERS: L.COMPANY_OFFICER, // view someone else's activity

  // Command Staff
  SESSION_HOST: L.COMMAND_STAFF,
  CERT_MANAGE: L.COMMAND_STAFF,
  INCIDENT_MANAGE: L.COMMAND_STAFF, // void incident reports
  QUOTA_CHECK: L.COMMAND_STAFF,

  // Senior Staff
  DISCIPLINE_VIEW: L.SENIOR_STAFF,
  INFRACTION_ISSUE: L.SENIOR_STAFF,
  INFRACTION_REMOVE: L.SENIOR_STAFF,
  RANK_MANAGE: L.SENIOR_STAFF, // hire, promote, demote
  ADMIN_LEAVE: L.SENIOR_STAFF,
  BLACKLIST: L.SENIOR_STAFF,
  ANNOUNCE: L.SENIOR_STAFF,

  // Department Head (server Administrators may also use /config to bootstrap)
  CONFIG: L.DEPARTMENT_HEAD,
};

module.exports = { PERMISSION_LEVELS, LEVEL_NAMES, REQUIRED_LEVEL };
