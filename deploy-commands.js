/**
 * deploy-commands.js
 * -----------------------------------------------------------------------
 * Registers all slash commands with Discord for your server (guild
 * commands update instantly). Run once initially and again any time you
 * add/change a command's options:
 *
 *   npm run deploy
 *
 * This REPLACES the server's command list, so commands removed from the
 * codebase (e.g. the old /warn, /infract, /promote) disappear too.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, validateCoreConfig } = require('./config');

validateCoreConfig();

function collectCommandData(dir) {
  let commands = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      commands = commands.concat(collectCommandData(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if (command.data) commands.push(command.data.toJSON());
    }
  }
  return commands;
}

const commands = collectCommandData(path.join(__dirname, 'commands'));
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`[Deploy] Registering ${commands.length} slash command(s) to guild ${GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('[Deploy] Successfully registered commands:');
    console.log(`         ${commands.map((c) => `/${c.name}`).join('  ')}`);
  } catch (err) {
    console.error('[Deploy] Failed to register commands:', err);
    process.exit(1);
  }
})();
