/**
 * roles.config.js
 * -----------------------------------------------------------------------
 * Maps the EXISTING LAFD Discord rank roles to their role IDs (from .env)
 * and assigns each rank a permission level + order index.
 *
 * IMPORTANT: This file does NOT create roles. It only references role IDs
 * that must already exist in the Discord server and be pasted into .env.
 *
 * Permission levels (higher number = more access, cumulative):
 *   4 = Department Head   (Fire Chief / Medical Director)
 *   3 = Senior Staff      (Deputy/Assistant Fire Chief, Asst. Medical Director)
 *   2 = Command Staff     (High Rank tiers, Battalion Chief, Division Medical Officer)
 *   1 = Company Officer   (Lieutenant/Captain tiers - Fire & EMS)
 *   0 = Member            (everyone else)
 *
 * See config/permissions.config.js for what each level is allowed to do.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();

// order = position in the rank ladder, lowest to highest (used for promote/demote math)
// level = permission level granted by holding this rank (see table above)
const FIRE_RANKS = [
  { key: 'PROBATIONARY_FIREFIGHTER', name: 'Probationary Firefighter', order: 1, level: 0 },
  { key: 'FIREFIGHTER_I', name: 'Firefighter I', order: 2, level: 0 },
  { key: 'FIREFIGHTER_II', name: 'Firefighter II', order: 3, level: 0 },
  { key: 'FIREFIGHTER_III', name: 'Firefighter III', order: 4, level: 0 },
  { key: 'ENGINEER', name: 'Engineer', order: 5, level: 0 },
  { key: 'SENIOR_ENGINEER', name: 'Senior Engineer', order: 6, level: 0 },
  { key: 'JUNIOR_ENGINEER', name: 'Junior Engineer', order: 7, level: 0 },
  { key: 'LIEUTENANT', name: 'Lieutenant', order: 8, level: 1 },
  { key: 'CAPTAIN', name: 'Captain', order: 9, level: 1 },
  { key: 'BATTALION_CHIEF', name: 'Battalion Chief', order: 10, level: 2 },
  { key: 'HIGH_RANK', name: 'High Rank', order: 11, level: 2 },
  { key: 'ASSISTANT_FIRE_CHIEF', name: 'Assistant Fire Chief', order: 12, level: 3 },
  { key: 'DEPUTY_FIRE_CHIEF', name: 'Deputy Fire Chief', order: 13, level: 3 },
  { key: 'FIRE_CHIEF', name: 'Fire Chief', order: 14, level: 4 },
].map((r) => ({ ...r, department: 'FIRE', roleId: process.env[`FIRE_ROLE_${r.key}`] || null }));

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
].map((r) => ({ ...r, department: 'EMS', roleId: process.env[`EMS_ROLE_${r.key}`] || null }));

// Special roles - NOT part of the rank ladder. Never used for promotion/demotion.
const SPECIAL_ROLES = {
  APPARATUS_OPERATOR: process.env.SPECIAL_ROLE_APPARATUS_OPERATOR || null,
  SUPERVISORY_TEAM: process.env.SPECIAL_ROLE_SUPERVISORY_TEAM || null,
};

const ALL_RANKS = [...FIRE_RANKS, ...EMS_RANKS];

/** Look up a rank definition by its Discord role ID. */
function getRankByRoleId(roleId) {
  return ALL_RANKS.find((r) => r.roleId && r.roleId === roleId) || null;
}

/** Look up a rank definition by department + order index (1-based). */
function getRankByOrder(department, order) {
  const list = department === 'FIRE' ? FIRE_RANKS : EMS_RANKS;
  return list.find((r) => r.order === order) || null;
}

/** Given a GuildMember, find the rank they currently hold (if any). */
function getMemberRank(member) {
  for (const rank of ALL_RANKS) {
    if (rank.roleId && member.roles.cache.has(rank.roleId)) {
      return rank;
    }
  }
  return null;
}

module.exports = {
  FIRE_RANKS,
  EMS_RANKS,
  ALL_RANKS,
  SPECIAL_ROLES,
  getRankByRoleId,
  getRankByOrder,
  getMemberRank,
};
