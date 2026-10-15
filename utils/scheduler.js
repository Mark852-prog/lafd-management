/**
 * utils/scheduler.js
 * -----------------------------------------------------------------------
 * Background jobs, run once a minute:
 *   - auto-end shifts that exceed SHIFT_MAX_HOURS (forgotten /shift end)
 *   - start scheduled leaves and end expired ones
 *   - lift finished suspensions and expire time-limited infractions
 * -----------------------------------------------------------------------
 */

const { GUILD_ID, POLICY } = require('../config');
const db = require('../database/db');
const { endMemberShift } = require('../services/shifts');
const { activateLeave, endLeave } = require('../services/leave');
const { processExpiredInfraction } = require('../services/discipline');
const { safeDM } = require('./channels');
const { warningEmbed } = require('./embeds');
const { fetchMember } = require('./members');

const INTERVAL_MS = 60 * 1000;
let running = false;

async function runJob(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[Scheduler] ${name} failed:`, err);
  }
}

async function tick(client) {
  if (running) return;
  running = true;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    await runJob('auto-end shifts', async () => {
      const maxSeconds = POLICY.MAX_SHIFT_HOURS * 3600;
      for (const shift of db.getShiftsOverLimit(maxSeconds)) {
        const endTime = new Date(new Date(shift.start_time).getTime() + maxSeconds * 1000);
        const reason = `Auto-ended after reaching the ${POLICY.MAX_SHIFT_HOURS}h shift limit`;
        await endMemberShift(guild, shift.discord_id, { reason, endTime });
        const member = await fetchMember(guild, shift.discord_id);
        if (member) {
          await safeDM(member.user, {
            embeds: [warningEmbed('Shift Auto-Ended', `${reason}. Only the first ${POLICY.MAX_SHIFT_HOURS} hours were counted - remember to use \`/shift end\`.`)],
          });
        }
      }
    });

    await runJob('leave', async () => {
      for (const leave of db.getLeavesToActivate()) await activateLeave(guild, leave);
      for (const leave of db.getLeavesToEnd()) await endLeave(guild, leave);
    });

    await runJob('infraction expiry', async () => {
      for (const record of db.getDueInfractions()) await processExpiredInfraction(guild, record);
    });
  } finally {
    running = false;
  }
}

function startScheduler(client) {
  tick(client);
  return setInterval(() => tick(client), INTERVAL_MS);
}

module.exports = { startScheduler };
