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
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.GuildMember, Partials.User],
});

// -------------------------------------------------------------------
// Load commands recursively from /commands
// -------------------------------------------------------------------
client.commands = new Collection();

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
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

client.login(config.DISCORD_TOKEN);
