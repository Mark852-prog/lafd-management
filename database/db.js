/**
 * database/db.js
 * -----------------------------------------------------------------------
 * A single SQLite database (via better-sqlite3) for all persistent data.
 * better-sqlite3 is synchronous, which keeps the code simple and is more
 * than fast enough for a Discord bot's workload.
 *
 * The file is created automatically at database/lafd.sqlite (git-ignored).
 * Existing databases from the previous version are upgraded in place -
 * new tables are created and missing columns are added on startup.
 * -----------------------------------------------------------------------
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'lafd.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const now = () => new Date().toISOString();

// -------------------------------------------------------------------
// Schema
// -------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    discord_id    TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    department    TEXT,
    rank_role_id  TEXT,
    callsign      TEXT,
    join_date     TEXT NOT NULL,
    duty_status   TEXT NOT NULL DEFAULT 'OFF_DUTY'
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id       TEXT NOT NULL,
    start_time       TEXT NOT NULL,
    end_time         TEXT,
    duration_seconds INTEGER,
    active           INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS discipline (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id     TEXT NOT NULL,
    issuer_id      TEXT NOT NULL,
    type           TEXT NOT NULL,
    reason         TEXT NOT NULL,
    notes          TEXT,
    evidence       TEXT,
    created_at     TEXT NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1,
    removed_by     TEXT,
    removed_reason TEXT,
    removed_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id   TEXT NOT NULL,
    action_type  TEXT NOT NULL,
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
    status              TEXT NOT NULL DEFAULT 'PENDING',
    requested_at        TEXT NOT NULL,
    decided_by          TEXT,
    decided_at          TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leaves (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id    TEXT NOT NULL,
    type          TEXT NOT NULL,              -- LOA | ADMIN
    reason        TEXT NOT NULL,
    status        TEXT NOT NULL,              -- PENDING | SCHEDULED | ACTIVE | ENDED | DENIED | CANCELLED
    starts_at     TEXT NOT NULL,
    ends_at       TEXT,                       -- NULL = indefinite (admin leave only)
    requested_by  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    decided_by    TEXT,
    decided_at    TEXT,
    decision_note TEXT,
    ended_by      TEXT,
    ended_at      TEXT,
    channel_id    TEXT,
    message_id    TEXT
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id     TEXT NOT NULL,
    username       TEXT,
    reason         TEXT NOT NULL,
    evidence       TEXT,
    added_by       TEXT NOT NULL,
    added_at       TEXT NOT NULL,
    expires_at     TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    removed_by     TEXT,
    removed_at     TEXT,
    removed_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL,
    location     TEXT NOT NULL,
    units        TEXT,
    patients     INTEGER NOT NULL DEFAULT 0,
    narrative    TEXT NOT NULL,
    outcome      TEXT,
    reporter_id  TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    voided       INTEGER NOT NULL DEFAULT 0,
    voided_by    TEXT,
    void_reason  TEXT,
    channel_id   TEXT,
    message_id   TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,                -- SESSION | TRAINING
    subtype     TEXT NOT NULL,
    host_id     TEXT NOT NULL,
    starts_at   TEXT NOT NULL,
    ended_at    TEXT,
    status      TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | ENDED | CANCELLED
    notes       TEXT,
    channel_id  TEXT,
    message_id  TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_attendees (
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    discord_id  TEXT NOT NULL,
    joined_at   TEXT NOT NULL,
    PRIMARY KEY (event_id, discord_id)
  );

  CREATE TABLE IF NOT EXISTS training_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id     TEXT NOT NULL,
    type           TEXT NOT NULL,
    result         TEXT NOT NULL,            -- PASS | FAIL
    score          TEXT,
    cert_key       TEXT,
    notes          TEXT,
    instructor_id  TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS certifications (
    discord_id  TEXT NOT NULL,
    cert_key    TEXT NOT NULL,
    granted_by  TEXT NOT NULL,
    granted_at  TEXT NOT NULL,
    PRIMARY KEY (discord_id, cert_key)
  );

  CREATE TABLE IF NOT EXISTS commendations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT NOT NULL,
    issuer_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    reason      TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_member ON shifts (discord_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_discipline_member ON discipline (discord_id);
  CREATE INDEX IF NOT EXISTS idx_history_member ON history (discord_id);
  CREATE INDEX IF NOT EXISTS idx_leaves_member ON leaves (discord_id, status);
  CREATE INDEX IF NOT EXISTS idx_blacklist_member ON blacklist (discord_id, active);
  CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents (reporter_id, created_at);
`);

// -------------------------------------------------------------------
// Migrations for databases created by the previous version
// -------------------------------------------------------------------
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('members', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'"); // ACTIVE | TERMINATED
addColumnIfMissing('shifts', 'ended_by', 'TEXT');
addColumnIfMissing('shifts', 'end_reason', 'TEXT');
addColumnIfMissing('discipline', 'expires_at', 'TEXT');
addColumnIfMissing('discipline', 'expired', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('callsign_requests', 'reason', 'TEXT');
addColumnIfMissing('callsign_requests', 'decision_note', 'TEXT');
addColumnIfMissing('callsign_requests', 'channel_id', 'TEXT');
addColumnIfMissing('callsign_requests', 'message_id', 'TEXT');

// -------------------------------------------------------------------
// Settings
// -------------------------------------------------------------------
const getAllSettings = () => db.prepare('SELECT key, value FROM settings').all();
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
const deleteSetting = (key) => db.prepare('DELETE FROM settings WHERE key = ?').run(key);

// -------------------------------------------------------------------
// Members
// -------------------------------------------------------------------
function getMember(discordId) {
  return db.prepare('SELECT * FROM members WHERE discord_id = ?').get(discordId);
}

/** Creates or refreshes a member row. Undefined/null fields leave existing values untouched. */
function upsertMember({ discordId, username, department = null, rankRoleId = null }) {
  db.prepare(
    `INSERT INTO members (discord_id, username, department, rank_role_id, callsign, join_date, duty_status, status)
     VALUES (@discordId, @username, @department, @rankRoleId, NULL, @now, 'OFF_DUTY', 'ACTIVE')
     ON CONFLICT(discord_id) DO UPDATE SET
       username = excluded.username,
       department = COALESCE(excluded.department, members.department),
       rank_role_id = COALESCE(excluded.rank_role_id, members.rank_role_id)`
  ).run({ discordId, username, department: department ?? null, rankRoleId: rankRoleId ?? null, now: now() });
  return getMember(discordId);
}

function getAllMembers() {
  return db.prepare('SELECT * FROM members ORDER BY username COLLATE NOCASE').all();
}

function setMemberRank(discordId, department, rankRoleId) {
  db.prepare('UPDATE members SET department = ?, rank_role_id = ? WHERE discord_id = ?').run(department, rankRoleId, discordId);
}

function setMemberStatus(discordId, status) {
  db.prepare('UPDATE members SET status = ? WHERE discord_id = ?').run(status, discordId);
}

function setMemberCallsign(discordId, callsign) {
  db.prepare('UPDATE members SET callsign = ? WHERE discord_id = ?').run(callsign, discordId);
}

function getMemberByCallsign(callsign) {
  return db.prepare('SELECT * FROM members WHERE callsign = ? COLLATE NOCASE').get(callsign);
}

function getAssignedCallsigns() {
  return db.prepare("SELECT * FROM members WHERE callsign IS NOT NULL AND callsign != '' ORDER BY callsign COLLATE NOCASE").all();
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
  const startTime = now();
  const info = db.prepare('INSERT INTO shifts (discord_id, start_time, active) VALUES (?, ?, 1)').run(discordId, startTime);
  setDutyStatus(discordId, 'ON_DUTY');
  return { id: info.lastInsertRowid, discord_id: discordId, start_time: startTime };
}

/** Ends the member's active shift. Returns the finished shift, or null if none was active. */
function endShift(discordId, { endedBy = null, reason = null, endTime = new Date() } = {}) {
  const shift = getActiveShift(discordId);
  if (!shift) return null;
  const durationSeconds = Math.max(0, Math.floor((endTime.getTime() - new Date(shift.start_time).getTime()) / 1000));
  db.prepare('UPDATE shifts SET end_time = ?, duration_seconds = ?, active = 0, ended_by = ?, end_reason = ? WHERE id = ?').run(
    endTime.toISOString(),
    durationSeconds,
    endedBy,
    reason,
    shift.id
  );
  setDutyStatus(discordId, 'OFF_DUTY');
  return { ...shift, end_time: endTime.toISOString(), duration_seconds: durationSeconds, active: 0 };
}

function getAllActiveShifts() {
  return db.prepare('SELECT * FROM shifts WHERE active = 1 ORDER BY start_time').all();
}

function getShiftHistory(discordId, limit = 10) {
  return db.prepare('SELECT * FROM shifts WHERE discord_id = ? AND active = 0 ORDER BY id DESC LIMIT ?').all(discordId, limit);
}

/** Total seconds on shift since `sinceIso` (null = all time), including any running shift. */
function getShiftStats(discordId, sinceIso = null) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(duration_seconds), 0) AS seconds
       FROM shifts WHERE discord_id = ? AND active = 0 AND (? IS NULL OR start_time >= ?)`
    )
    .get(discordId, sinceIso, sinceIso);
  const active = getActiveShift(discordId);
  let seconds = row.seconds;
  if (active && (!sinceIso || active.start_time >= sinceIso)) {
    seconds += Math.floor((Date.now() - new Date(active.start_time).getTime()) / 1000);
  }
  return { count: row.count + (active ? 1 : 0), seconds };
}

/** Map of discord_id -> { seconds, count } for every member with a completed shift since `sinceIso`. */
function getShiftTotals(sinceIso = null) {
  const rows = db
    .prepare(
      `SELECT discord_id, COUNT(*) AS count, COALESCE(SUM(duration_seconds), 0) AS seconds
       FROM shifts WHERE active = 0 AND (? IS NULL OR start_time >= ?) GROUP BY discord_id`
    )
    .all(sinceIso, sinceIso);
  const totals = new Map(rows.map((r) => [r.discord_id, { seconds: r.seconds, count: r.count }]));
  for (const shift of getAllActiveShifts()) {
    if (sinceIso && shift.start_time < sinceIso) continue;
    const running = Math.floor((Date.now() - new Date(shift.start_time).getTime()) / 1000);
    const entry = totals.get(shift.discord_id) || { seconds: 0, count: 0 };
    totals.set(shift.discord_id, { seconds: entry.seconds + running, count: entry.count + 1 });
  }
  return totals;
}

function getShiftsOverLimit(maxSeconds) {
  const cutoff = new Date(Date.now() - maxSeconds * 1000).toISOString();
  return db.prepare('SELECT * FROM shifts WHERE active = 1 AND start_time <= ?').all(cutoff);
}

// -------------------------------------------------------------------
// Discipline
// -------------------------------------------------------------------
function addInfraction({ discordId, issuerId, type, reason, notes = null, evidence = null, expiresAt = null }) {
  const createdAt = now();
  const info = db
    .prepare(
      `INSERT INTO discipline (discord_id, issuer_id, type, reason, notes, evidence, created_at, active, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(discordId, issuerId, type, reason, notes, evidence, createdAt, expiresAt);
  return getInfractionById(info.lastInsertRowid);
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
  db.prepare('UPDATE discipline SET active = 0, removed_by = ?, removed_reason = ?, removed_at = ? WHERE id = ?').run(
    removedBy,
    removedReason,
    now(),
    id
  );
  return getInfractionById(id);
}

/** Infractions whose expiry has passed and haven't been processed yet. */
function getDueInfractions() {
  return db.prepare('SELECT * FROM discipline WHERE active = 1 AND expired = 0 AND expires_at IS NOT NULL AND expires_at <= ?').all(now());
}

function markInfractionExpired(id, { deactivate }) {
  if (deactivate) {
    db.prepare("UPDATE discipline SET expired = 1, active = 0, removed_reason = 'Expired', removed_at = ? WHERE id = ?").run(now(), id);
  } else {
    db.prepare('UPDATE discipline SET expired = 1 WHERE id = ?').run(id);
  }
}

function getActiveSuspension(discordId) {
  return db
    .prepare("SELECT * FROM discipline WHERE discord_id = ? AND type = 'Suspension' AND active = 1 AND expired = 0 ORDER BY id DESC")
    .get(discordId);
}

function getRecentInfractions(limit = 15) {
  return db.prepare('SELECT * FROM discipline ORDER BY id DESC LIMIT ?').all(limit);
}

// -------------------------------------------------------------------
// History (rank changes, callsigns, certifications, status changes)
// -------------------------------------------------------------------
function addHistoryEntry({ discordId, actionType, oldValue = null, newValue = null, actorId = null, reason = null }) {
  db.prepare(
    `INSERT INTO history (discord_id, action_type, old_value, new_value, actor_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(discordId, actionType, oldValue, newValue, actorId, reason, now());
}

function getHistory(discordId, limit = 10, actionTypes = null) {
  if (actionTypes && actionTypes.length) {
    const placeholders = actionTypes.map(() => '?').join(',');
    return db
      .prepare(`SELECT * FROM history WHERE discord_id = ? AND action_type IN (${placeholders}) ORDER BY id DESC LIMIT ?`)
      .all(discordId, ...actionTypes, limit);
  }
  return db.prepare('SELECT * FROM history WHERE discord_id = ? ORDER BY id DESC LIMIT ?').all(discordId, limit);
}

function getLastHistoryOf(discordId, actionTypes) {
  return getHistory(discordId, 1, actionTypes)[0] || null;
}

// -------------------------------------------------------------------
// Callsign requests
// -------------------------------------------------------------------
function createCallsignRequest(discordId, requestedCallsign, reason = null) {
  const info = db
    .prepare(`INSERT INTO callsign_requests (discord_id, requested_callsign, status, requested_at, reason) VALUES (?, ?, 'PENDING', ?, ?)`)
    .run(discordId, requestedCallsign, now(), reason);
  return getCallsignRequest(info.lastInsertRowid);
}

function setCallsignRequestMessage(id, channelId, messageId) {
  db.prepare('UPDATE callsign_requests SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

function decideCallsignRequest(id, status, decidedBy, note = null) {
  db.prepare('UPDATE callsign_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?').run(
    status,
    decidedBy,
    now(),
    note,
    id
  );
  return getCallsignRequest(id);
}

function getCallsignRequest(id) {
  return db.prepare('SELECT * FROM callsign_requests WHERE id = ?').get(id);
}

function getPendingCallsignRequest(discordId) {
  return db.prepare("SELECT * FROM callsign_requests WHERE discord_id = ? AND status = 'PENDING'").get(discordId);
}

function getPendingRequestForCallsign(callsign) {
  return db.prepare("SELECT * FROM callsign_requests WHERE requested_callsign = ? COLLATE NOCASE AND status = 'PENDING'").get(callsign);
}

// -------------------------------------------------------------------
// Leave
// -------------------------------------------------------------------
function createLeave({ discordId, type, reason, status, startsAt, endsAt, requestedBy }) {
  const info = db
    .prepare(
      `INSERT INTO leaves (discord_id, type, reason, status, starts_at, ends_at, requested_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(discordId, type, reason, status, startsAt, endsAt, requestedBy, now());
  return getLeave(info.lastInsertRowid);
}

const getLeave = (id) => db.prepare('SELECT * FROM leaves WHERE id = ?').get(id);

function updateLeave(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getLeave(id);
  db.prepare(`UPDATE leaves SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  return getLeave(id);
}

/** The member's current leave that is pending, scheduled, or active (at most one). */
function getOpenLeave(discordId) {
  return db
    .prepare("SELECT * FROM leaves WHERE discord_id = ? AND status IN ('PENDING','SCHEDULED','ACTIVE') ORDER BY id DESC")
    .get(discordId);
}

function getActiveLeave(discordId) {
  return db.prepare("SELECT * FROM leaves WHERE discord_id = ? AND status = 'ACTIVE' ORDER BY id DESC").get(discordId);
}

function getLeavesByStatus(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM leaves WHERE status IN (${placeholders}) ORDER BY starts_at`).all(...statuses);
}

function getLeavesToActivate() {
  return db.prepare("SELECT * FROM leaves WHERE status = 'SCHEDULED' AND starts_at <= ?").all(now());
}

function getLeavesToEnd() {
  return db.prepare("SELECT * FROM leaves WHERE status = 'ACTIVE' AND ends_at IS NOT NULL AND ends_at <= ?").all(now());
}

function getLeaveHistory(discordId, limit = 5) {
  return db.prepare('SELECT * FROM leaves WHERE discord_id = ? ORDER BY id DESC LIMIT ?').all(discordId, limit);
}

// -------------------------------------------------------------------
// Blacklist
// -------------------------------------------------------------------
function addBlacklist({ discordId, username, reason, evidence, addedBy, expiresAt }) {
  const info = db
    .prepare(
      `INSERT INTO blacklist (discord_id, username, reason, evidence, added_by, added_at, expires_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(discordId, username, reason, evidence, addedBy, now(), expiresAt);
  return db.prepare('SELECT * FROM blacklist WHERE id = ?').get(info.lastInsertRowid);
}

function getActiveBlacklist(discordId) {
  return db
    .prepare('SELECT * FROM blacklist WHERE discord_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC')
    .get(discordId, now());
}

function getBlacklistHistory(discordId) {
  return db.prepare('SELECT * FROM blacklist WHERE discord_id = ? ORDER BY id DESC').all(discordId);
}

function getAllActiveBlacklists() {
  return db.prepare('SELECT * FROM blacklist WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC').all(now());
}

function removeBlacklist(discordId, removedBy, reason) {
  return db
    .prepare('UPDATE blacklist SET active = 0, removed_by = ?, removed_at = ?, removed_reason = ? WHERE discord_id = ? AND active = 1')
    .run(removedBy, now(), reason, discordId).changes;
}

// -------------------------------------------------------------------
// Incidents
// -------------------------------------------------------------------
function createIncident({ type, location, units, patients, narrative, outcome, reporterId }) {
  const info = db
    .prepare(
      `INSERT INTO incidents (type, location, units, patients, narrative, outcome, reporter_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(type, location, units, patients, narrative, outcome, reporterId, now());
  return getIncident(info.lastInsertRowid);
}

const getIncident = (id) => db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);

function setIncidentMessage(id, channelId, messageId) {
  db.prepare('UPDATE incidents SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

function voidIncident(id, voidedBy, reason) {
  db.prepare('UPDATE incidents SET voided = 1, voided_by = ?, void_reason = ? WHERE id = ?').run(voidedBy, reason, id);
  return getIncident(id);
}

function getRecentIncidents({ reporterId = null, type = null, limit = 10 } = {}) {
  return db
    .prepare(
      `SELECT * FROM incidents WHERE voided = 0 AND (? IS NULL OR reporter_id = ?) AND (? IS NULL OR type = ?)
       ORDER BY id DESC LIMIT ?`
    )
    .all(reporterId, reporterId, type, type, limit);
}

function countIncidents(reporterId, sinceIso = null) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM incidents WHERE voided = 0 AND reporter_id = ? AND (? IS NULL OR created_at >= ?)')
    .get(reporterId, sinceIso, sinceIso).n;
}

function getIncidentTypeCounts(sinceIso = null) {
  return db
    .prepare('SELECT type, COUNT(*) AS n FROM incidents WHERE voided = 0 AND (? IS NULL OR created_at >= ?) GROUP BY type ORDER BY n DESC')
    .all(sinceIso, sinceIso);
}

// -------------------------------------------------------------------
// Events (sessions + trainings) and attendance
// -------------------------------------------------------------------
function createEvent({ kind, subtype, hostId, startsAt, notes }) {
  const info = db
    .prepare(`INSERT INTO events (kind, subtype, host_id, starts_at, notes, status, created_at) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`)
    .run(kind, subtype, hostId, startsAt, notes, now());
  return getEvent(info.lastInsertRowid);
}

const getEvent = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);

function setEventMessage(id, channelId, messageId) {
  db.prepare('UPDATE events SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

function closeEvent(id, status = 'ENDED') {
  db.prepare('UPDATE events SET status = ?, ended_at = ? WHERE id = ?').run(status, now(), id);
  return getEvent(id);
}

function getOpenEvents(kind) {
  return db.prepare("SELECT * FROM events WHERE kind = ? AND status = 'OPEN' ORDER BY starts_at").all(kind);
}

/** Toggles attendance. Returns true if the member is now attending. */
function toggleAttendance(eventId, discordId) {
  const existing = db.prepare('SELECT 1 FROM event_attendees WHERE event_id = ? AND discord_id = ?').get(eventId, discordId);
  if (existing) {
    db.prepare('DELETE FROM event_attendees WHERE event_id = ? AND discord_id = ?').run(eventId, discordId);
    return false;
  }
  db.prepare('INSERT INTO event_attendees (event_id, discord_id, joined_at) VALUES (?, ?, ?)').run(eventId, discordId, now());
  return true;
}

function getAttendees(eventId) {
  return db.prepare('SELECT * FROM event_attendees WHERE event_id = ? ORDER BY joined_at').all(eventId);
}

function countAttendance(discordId, kind, sinceIso = null) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM event_attendees a JOIN events e ON e.id = a.event_id
       WHERE a.discord_id = ? AND e.kind = ? AND e.status != 'CANCELLED' AND (? IS NULL OR e.starts_at >= ?)`
    )
    .get(discordId, kind, sinceIso, sinceIso).n;
}

function countHosted(discordId, kind, sinceIso = null) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM events WHERE host_id = ? AND kind = ? AND status != 'CANCELLED' AND (? IS NULL OR starts_at >= ?)`)
    .get(discordId, kind, sinceIso, sinceIso).n;
}

// -------------------------------------------------------------------
// Training results & certifications
// -------------------------------------------------------------------
function addTrainingResult({ discordId, type, result, score, certKey, notes, instructorId }) {
  const info = db
    .prepare(
      `INSERT INTO training_results (discord_id, type, result, score, cert_key, notes, instructor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(discordId, type, result, score, certKey, notes, instructorId, now());
  return db.prepare('SELECT * FROM training_results WHERE id = ?').get(info.lastInsertRowid);
}

function getTrainingResults(discordId, limit = 10) {
  return db.prepare('SELECT * FROM training_results WHERE discord_id = ? ORDER BY id DESC LIMIT ?').all(discordId, limit);
}

function grantCertification(discordId, certKey, grantedBy) {
  return (
    db
      .prepare('INSERT OR IGNORE INTO certifications (discord_id, cert_key, granted_by, granted_at) VALUES (?, ?, ?, ?)')
      .run(discordId, certKey, grantedBy, now()).changes > 0
  );
}

function revokeCertification(discordId, certKey) {
  return db.prepare('DELETE FROM certifications WHERE discord_id = ? AND cert_key = ?').run(discordId, certKey).changes > 0;
}

function getCertifications(discordId) {
  return db.prepare('SELECT * FROM certifications WHERE discord_id = ? ORDER BY granted_at').all(discordId);
}

function getCertificationHolders(certKey) {
  return db.prepare('SELECT * FROM certifications WHERE cert_key = ? ORDER BY granted_at').all(certKey);
}

// -------------------------------------------------------------------
// Commendations
// -------------------------------------------------------------------
function addCommendation({ discordId, issuerId, title, reason }) {
  const info = db
    .prepare('INSERT INTO commendations (discord_id, issuer_id, title, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(discordId, issuerId, title, reason, now());
  return db.prepare('SELECT * FROM commendations WHERE id = ?').get(info.lastInsertRowid);
}

function getCommendations(discordId, limit = 5) {
  return db.prepare('SELECT * FROM commendations WHERE discord_id = ? ORDER BY id DESC LIMIT ?').all(discordId, limit);
}

function countCommendations(discordId, sinceIso = null) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM commendations WHERE discord_id = ? AND (? IS NULL OR created_at >= ?)')
    .get(discordId, sinceIso, sinceIso).n;
}

// -------------------------------------------------------------------
// Stats
// -------------------------------------------------------------------
function getDatabaseStats() {
  const count = (sql) => db.prepare(sql).get().n;
  return {
    members: count('SELECT COUNT(*) AS n FROM members'),
    shifts: count('SELECT COUNT(*) AS n FROM shifts'),
    incidents: count('SELECT COUNT(*) AS n FROM incidents WHERE voided = 0'),
    infractions: count('SELECT COUNT(*) AS n FROM discipline WHERE active = 1'),
    events: count('SELECT COUNT(*) AS n FROM events'),
  };
}

module.exports = {
  db,
  // settings
  getAllSettings,
  setSetting,
  deleteSetting,
  // members
  getMember,
  upsertMember,
  getAllMembers,
  setMemberRank,
  setMemberStatus,
  setMemberCallsign,
  getMemberByCallsign,
  getAssignedCallsigns,
  setDutyStatus,
  // shifts
  getActiveShift,
  startShift,
  endShift,
  getAllActiveShifts,
  getShiftHistory,
  getShiftStats,
  getShiftTotals,
  getShiftsOverLimit,
  // discipline
  addInfraction,
  getInfractions,
  getInfractionById,
  removeInfraction,
  getDueInfractions,
  markInfractionExpired,
  getActiveSuspension,
  getRecentInfractions,
  // history
  addHistoryEntry,
  getHistory,
  getLastHistoryOf,
  // callsigns
  createCallsignRequest,
  setCallsignRequestMessage,
  decideCallsignRequest,
  getCallsignRequest,
  getPendingCallsignRequest,
  getPendingRequestForCallsign,
  // leave
  createLeave,
  getLeave,
  updateLeave,
  getOpenLeave,
  getActiveLeave,
  getLeavesByStatus,
  getLeavesToActivate,
  getLeavesToEnd,
  getLeaveHistory,
  // blacklist
  addBlacklist,
  getActiveBlacklist,
  getBlacklistHistory,
  getAllActiveBlacklists,
  removeBlacklist,
  // incidents
  createIncident,
  getIncident,
  setIncidentMessage,
  voidIncident,
  getRecentIncidents,
  countIncidents,
  getIncidentTypeCounts,
  // events
  createEvent,
  getEvent,
  setEventMessage,
  closeEvent,
  getOpenEvents,
  toggleAttendance,
  getAttendees,
  countAttendance,
  countHosted,
  // training & certs
  addTrainingResult,
  getTrainingResults,
  grantCertification,
  revokeCertification,
  getCertifications,
  getCertificationHolders,
  // commendations
  addCommendation,
  getCommendations,
  countCommendations,
  // stats
  getDatabaseStats,
};
