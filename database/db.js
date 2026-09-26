/**
 * database/db.js
 * -----------------------------------------------------------------------
 * A single SQLite database (via better-sqlite3) for all persistent data.
 * better-sqlite3 is synchronous, which keeps the code simple and is more
 * than fast enough for a Discord bot's workload.
 *
 * The database file is created automatically at database/lafd.sqlite the
 * first time the bot runs. It is git-ignored, so it is safe from an
 * accidental commit.
 * -----------------------------------------------------------------------
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'lafd.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// -------------------------------------------------------------------
// Schema
// -------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    discord_id    TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    department    TEXT,               -- 'FIRE' | 'EMS' | NULL
    rank_role_id  TEXT,
    callsign      TEXT,
    join_date     TEXT NOT NULL,      -- ISO timestamp, first time the bot saw them
    duty_status   TEXT NOT NULL DEFAULT 'OFF_DUTY' -- 'ON_DUTY' | 'OFF_DUTY'
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id      TEXT NOT NULL,
    start_time      TEXT NOT NULL,
    end_time        TEXT,
    duration_seconds INTEGER,
    active          INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS discipline (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id    TEXT NOT NULL,
    issuer_id     TEXT NOT NULL,
    type          TEXT NOT NULL, -- Notice | Verbal Warning | Warning | Strike | Suspension | Demotion | Termination
    reason        TEXT NOT NULL,
    notes         TEXT,
    evidence      TEXT,
    created_at    TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    removed_by    TEXT,
    removed_reason TEXT,
    removed_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id   TEXT NOT NULL,
    action_type  TEXT NOT NULL, -- PROMOTION | DEMOTION | ROLE_CHANGE | CALLSIGN_REQUEST | SHIFT
    old_value    TEXT,
    new_value    TEXT,
    actor_id     TEXT,
    reason       TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS callsign_requests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id          TEXT NOT NULL,
    requested_callsign  TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | DENIED
    requested_at        TEXT NOT NULL,
    decided_by          TEXT,
    decided_at          TEXT
  );
`);

// -------------------------------------------------------------------
// Members
// -------------------------------------------------------------------
function upsertMember({ discordId, username, department = null, rankRoleId = null }) {
  const existing = db.prepare('SELECT * FROM members WHERE discord_id = ?').get(discordId);
  if (existing) {
    db.prepare(
      `UPDATE members SET username = ?, department = COALESCE(?, department), rank_role_id = COALESCE(?, rank_role_id) WHERE discord_id = ?`
    ).run(username, department, rankRoleId, discordId);
    return db.prepare('SELECT * FROM members WHERE discord_id = ?').get(discordId);
  }
  db.prepare(
    `INSERT INTO members (discord_id, username, department, rank_role_id, callsign, join_date, duty_status)
     VALUES (?, ?, ?, ?, NULL, ?, 'OFF_DUTY')`
  ).run(discordId, username, department, rankRoleId, new Date().toISOString());
  return db.prepare('SELECT * FROM members WHERE discord_id = ?').get(discordId);
}

function getMember(discordId) {
  return db.prepare('SELECT * FROM members WHERE discord_id = ?').get(discordId);
}

function getAllMembers() {
  return db.prepare('SELECT * FROM members ORDER BY username COLLATE NOCASE').all();
}

function setMemberRank(discordId, department, rankRoleId) {
  db.prepare('UPDATE members SET department = ?, rank_role_id = ? WHERE discord_id = ?').run(department, rankRoleId, discordId);
}

function setMemberCallsign(discordId, callsign) {
  db.prepare('UPDATE members SET callsign = ? WHERE discord_id = ?').run(callsign, discordId);
}

function setDutyStatus(discordId, status) {
  db.prepare('UPDATE members SET duty_status = ? WHERE discord_id = ?').run(status, discordId);
}

// -------------------------------------------------------------------
// Shifts
// -------------------------------------------------------------------
function getActiveShift(discordId) {
  return db.prepare('SELECT * FROM shifts WHERE discord_id = ? AND active = 1').get(discordId);
}

function startShift(discordId) {
  const startTime = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO shifts (discord_id, start_time, active) VALUES (?, ?, 1)')
    .run(discordId, startTime);
  return { id: info.lastInsertRowid, discordId, startTime };
}

function endShift(discordId) {
  const shift = getActiveShift(discordId);
  if (!shift) return null;
  const endTime = new Date();
  const startTime = new Date(shift.start_time);
  const durationSeconds = Math.max(0, Math.floor((endTime.getTime() - startTime.getTime()) / 1000));
  db.prepare('UPDATE shifts SET end_time = ?, duration_seconds = ?, active = 0 WHERE id = ?').run(
    endTime.toISOString(),
    durationSeconds,
    shift.id
  );
  return { ...shift, end_time: endTime.toISOString(), duration_seconds: durationSeconds };
}

function getAllActiveShifts() {
  return db.prepare('SELECT * FROM shifts WHERE active = 1').all();
}

function getShiftHistory(discordId, limit = 10) {
  return db
    .prepare('SELECT * FROM shifts WHERE discord_id = ? AND active = 0 ORDER BY id DESC LIMIT ?')
    .all(discordId, limit);
}

// -------------------------------------------------------------------
// Discipline
// -------------------------------------------------------------------
function addInfraction({ discordId, issuerId, type, reason, notes = null, evidence = null }) {
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO discipline (discord_id, issuer_id, type, reason, notes, evidence, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(discordId, issuerId, type, reason, notes, evidence, createdAt);
  return { id: info.lastInsertRowid, discordId, issuerId, type, reason, notes, evidence, createdAt };
}

function getInfractions(discordId, includeRemoved = false) {
  if (includeRemoved) {
    return db.prepare('SELECT * FROM discipline WHERE discord_id = ? ORDER BY id DESC').all(discordId);
  }
  return db.prepare('SELECT * FROM discipline WHERE discord_id = ? AND active = 1 ORDER BY id DESC').all(discordId);
}

function getInfractionById(id) {
  return db.prepare('SELECT * FROM discipline WHERE id = ?').get(id);
}

function removeInfraction(id, removedBy, removedReason) {
  db.prepare(
    'UPDATE discipline SET active = 0, removed_by = ?, removed_reason = ?, removed_at = ? WHERE id = ?'
  ).run(removedBy, removedReason, new Date().toISOString(), id);
  return getInfractionById(id);
}

// -------------------------------------------------------------------
// History (promotions / demotions / role changes / callsign requests)
// -------------------------------------------------------------------
function addHistoryEntry({ discordId, actionType, oldValue = null, newValue = null, actorId = null, reason = null }) {
  db.prepare(
    `INSERT INTO history (discord_id, action_type, old_value, new_value, actor_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(discordId, actionType, oldValue, newValue, actorId, reason, new Date().toISOString());
}

function getHistory(discordId, limit = 10) {
  return db.prepare('SELECT * FROM history WHERE discord_id = ? ORDER BY id DESC LIMIT ?').all(discordId, limit);
}

// -------------------------------------------------------------------
// Callsign requests
// -------------------------------------------------------------------
function createCallsignRequest(discordId, requestedCallsign) {
  const requestedAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO callsign_requests (discord_id, requested_callsign, status, requested_at)
       VALUES (?, ?, 'PENDING', ?)`
    )
    .run(discordId, requestedCallsign, requestedAt);
  return { id: info.lastInsertRowid, discordId, requestedCallsign, status: 'PENDING', requestedAt };
}

function decideCallsignRequest(id, status, decidedBy) {
  db.prepare('UPDATE callsign_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(
    status,
    decidedBy,
    new Date().toISOString(),
    id
  );
  return db.prepare('SELECT * FROM callsign_requests WHERE id = ?').get(id);
}

function getCallsignRequest(id) {
  return db.prepare('SELECT * FROM callsign_requests WHERE id = ?').get(id);
}

module.exports = {
  db,
  // members
  upsertMember,
  getMember,
  getAllMembers,
  setMemberRank,
  setMemberCallsign,
  setDutyStatus,
  // shifts
  getActiveShift,
  startShift,
  endShift,
  getAllActiveShifts,
  getShiftHistory,
  // discipline
  addInfraction,
  getInfractions,
  getInfractionById,
  removeInfraction,
  // history
  addHistoryEntry,
  getHistory,
  // callsigns
  createCallsignRequest,
  decideCallsignRequest,
  getCallsignRequest,
};
