/**
 * index.js
 * -----------------------------------------------------------------------
 * LAFD Management - bot entry point.
 * Loads config, commands, and events, then logs in to Discord.
 * Run `npm run deploy` first to register slash commands, then `npm start`.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');

config.validateCoreConfig();

const client = new Client({
  // GuildMembers is a privileged intent - enable "Server Members Intent" in the
  // Developer Portal (Bot tab). It powers the live roster, quota checks and
  // blacklist enforcement.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember, Partials.User],
});

// -------------------------------------------------------------------
// Load commands recursively from /commands
// -------------------------------------------------------------------
client.commands = new Collection();
client.componentHandlers = new Collection();

function loadCommands(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if (!command.data || !command.execute) {
        console.warn(`[Commands] Skipping ${fullPath} - missing "data" or "execute" export.`);
        continue;
      }
      client.commands.set(command.data.name, command);
      if (command.handleComponent) {
        for (const prefix of [].concat(command.componentPrefix || [])) client.componentHandlers.set(prefix, command);
      }
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));
console.log(`[LAFD Management] Loaded ${client.commands.size} command(s).`);

// -------------------------------------------------------------------
// Load events from /events
// -------------------------------------------------------------------
const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  const handler = (...args) =>
    Promise.resolve(event.execute(...args)).catch((err) => console.error(`[Events] ${event.name} handler failed:`, err));
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

process.on('unhandledRejection', (err) => console.error('[LAFD Management] Unhandled promise rejection:', err));

client.login(config.DISCORD_TOKEN).catch((err) => {
  if (String(err?.message).includes('disallowed intents') || err?.code === 'DisallowedIntents') {
    console.error(
      '\n[LAFD Management] Discord rejected the login because the Server Members Intent is disabled.\n' +
        'Fix: Developer Portal -> your application -> Bot -> Privileged Gateway Intents -> enable "Server Members Intent".\n'
    );
  } else {
    console.error('[LAFD Management] Failed to log in:', err);
  }
  process.exit(1);
});
