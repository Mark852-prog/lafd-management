const { Events, ActivityType } = require('discord.js');
const { GUILD_ID, DEPARTMENT_SHORT } = require('../config');
const { startScheduler } = require('../utils/scheduler');
const { version } = require('../package.json');

/**
 * Registers every loaded slash command to the server on startup, so the
 * command list in Discord always matches the running code (no separate
 * `npm run deploy` needed). Uses the logged-in application's own ID, so a
 * wrong CLIENT_ID in .env can't break it. Also clears any global commands
 * left over from older setups, which would otherwise show up as duplicates.
 * Set AUTO_DEPLOY_COMMANDS=false in .env to turn this off.
 */
async function syncCommands(client, guild) {
  if (String(process.env.AUTO_DEPLOY_COMMANDS).toLowerCase() === 'false') return;
  const body = client.commands.map((c) => c.data.toJSON());
  try {
    await client.application.commands.set(body, guild.id);
    console.log(`[LAFD Management] Registered ${body.length} slash command(s) in ${guild.name}.`);
  } catch (err) {
    console.error(`[LAFD Management] Could not register slash commands: ${err.message}`);
    if (err.code === 50001) {
      console.error(
        '  -> The bot was invited without the "applications.commands" scope. Re-invite it from\n' +
          '     Developer Portal -> OAuth2 -> URL Generator with BOTH "bot" and "applications.commands" ticked.'
      );
    }
    return;
  }
  try {
    const globals = await client.application.commands.fetch();
    if (globals.size) {
      await client.application.commands.set([]);
      console.log(`[LAFD Management] Removed ${globals.size} old global command(s).`);
    }
  } catch (err) {
    console.warn(`[LAFD Management] Could not clear old global commands: ${err.message}`);
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[LAFD Management] v${version} logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      const servers = client.guilds.cache.map((g) => `${g.name} (${g.id})`).join(', ') || 'none';
      console.warn(
        `[LAFD Management] The bot is not in the server GUILD_ID=${GUILD_ID}.\n` +
          `  Servers the bot is in: ${servers}\n` +
          '  -> Put the correct server ID in GUILD_ID in .env (right-click server icon -> Copy Server ID), then restart.'
      );
    } else {
      console.log(`[LAFD Management] Serving ${guild.name} (${guild.id})`);
      await guild.roles.fetch().catch(() => {});
      await syncCommands(client, guild);
    }

    client.user.setPresence({ activities: [{ name: `over ${DEPARTMENT_SHORT} | /help`, type: ActivityType.Watching }], status: 'online' });
    startScheduler(client);
  },
};
