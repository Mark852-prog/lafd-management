/**
 * permissions.config.js
 * -----------------------------------------------------------------------
 * Centralized permission levels. Change the numbers here to change what
 * each rank tier is allowed to do - nothing else in the codebase needs
 * to change.
 *
 * Levels are CUMULATIVE: a level 3 staffer automatically has everything
 * a level 1 or level 2 staffer has.
 * -----------------------------------------------------------------------
 */

const PERMISSION_LEVELS = {
  MEMBER: 0, // everyone
  COMPANY_OFFICER: 1, // Lieutenant / Captain / Paramedic Lieutenant / Paramedic Captain
  COMMAND_STAFF: 2, // High Rank / EMS High Rank / EMS Senior High Rank / Battalion Chief / Division Medical Officer
  SENIOR_STAFF: 3, // Deputy/Assistant Fire Chief, Assistant Medical Director
  DEPARTMENT_HEAD: 4, // Fire Chief / Medical Director
};

// Minimum permission level required to use each feature.
// Update these if department policy changes.
const REQUIRED_LEVEL = {
  CALLSIGN_REQUEST: PERMISSION_LEVELS.MEMBER, // anyone can request a callsign
  CALLSIGN_APPROVE: PERMISSION_LEVELS.COMPANY_OFFICER, // approve/deny requests
  ROSTER_VIEW: PERMISSION_LEVELS.MEMBER, // anyone can view the roster
  MEMBER_VIEW: PERMISSION_LEVELS.MEMBER, // anyone can view a basic profile
  DISCIPLINE_VIEW: PERMISSION_LEVELS.SENIOR_STAFF, // view another member's disciplinary history
  SHIFT_SELF: PERMISSION_LEVELS.MEMBER, // start/end your own shift
  ON_DUTY_VIEW: PERMISSION_LEVELS.MEMBER, // view who's on duty
  INFRACTION_ISSUE: PERMISSION_LEVELS.SENIOR_STAFF, // warn / infract
  INFRACTION_REMOVE: PERMISSION_LEVELS.SENIOR_STAFF, // clear-infraction
  PROMOTE_DEMOTE: PERMISSION_LEVELS.SENIOR_STAFF,
  ANNOUNCE: PERMISSION_LEVELS.SENIOR_STAFF,
  SETUP_PERMISSIONS: PERMISSION_LEVELS.DEPARTMENT_HEAD, // /setup-permissions (creates/updates tier roles)
  BOT_ADMIN: PERMISSION_LEVELS.DEPARTMENT_HEAD, // reserved for future full bot-management commands
};

module.exports = { PERMISSION_LEVELS, REQUIRED_LEVEL };
