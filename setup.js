/**
 * setup.js  (npm run setup)
 * -----------------------------------------------------------------------
 * Interactive first-time setup. Asks ONLY for the bot token, then:
 *   - checks the token with Discord
 *   - finds CLIENT_ID and the server (GUILD_ID) automatically
 *   - matches every Fire/EMS rank + special role to your server's roles
 *     by name and fills in the role IDs
 *   - writes everything to .env and registers the slash commands
 * Safe to re-run. Values it can't find are left as they were.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const API = 'https://discord.com/api/v10';
const ENV_PATH = path.join(__dirname, '.env');
const EXAMPLE_PATH = path.join(__dirname, '.env.example');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

async function discord(token, route) {
  const res = await fetch(`${API}${route}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw Object.assign(new Error(`Discord API ${res.status} on ${route}`), { status: res.status });
  return res.json();
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) fs.copyFileSync(EXAMPLE_PATH, ENV_PATH);
  return fs.readFileSync(ENV_PATH, 'utf8');
}

function setEnv(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

// Rank env keys + display names, taken from roles.config.js so they stay in sync.
function rankEnvKeys() {
  const { FIRE_RANKS, EMS_RANKS } = require('./config/roles.config');
  return [
    ...FIRE_RANKS.map((r) => ({ envKey: `FIRE_ROLE_${r.key}`, name: r.name })),
    ...EMS_RANKS.map((r) => ({ envKey: `EMS_ROLE_${r.key}`, name: r.name })),
    { envKey: 'SPECIAL_ROLE_APPARATUS_OPERATOR', name: 'Apparatus Operator' },
    { envKey: 'SPECIAL_ROLE_SUPERVISORY_TEAM', name: 'Supervisory Team' },
  ];
}

(async () => {
  console.log('\n=== LAFD Management setup ===\n');
  console.log('Get your token: discord.com/developers/applications -> your app -> Bot -> Reset Token -> Copy');
  console.log('(Right-click to paste in the Windows terminal. The token will show on screen - that\'s fine, it stays on your PC.)\n');

  let token;
  let app;
  for (;;) {
    token = (await ask('Paste your bot token and press Enter: ')).replace(/^["']|["']$/g, '').replace(/^Bot\s+/i, '');
    try {
      app = await discord(token, '/oauth2/applications/@me');
      break;
    } catch (err) {
      console.log(err.status === 401
        ? '  That token was rejected. Make sure you copied the BOT token (Bot tab), not the Client Secret. Try again.\n'
        : `  Could not reach Discord (${err.message}). Check your internet and try again.\n`);
    }
  }
  console.log(`  Token OK - bot "${app.name}" (Client ID ${app.id})\n`);

  const guilds = await discord(token, '/users/@me/guilds');
  if (guilds.length === 0) {
    console.log('The bot is not in any server yet. Invite it with this link, then run "npm run setup" again:');
    console.log(`  https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=8\n`);
    rl.close();
    return;
  }
  let guild = guilds[0];
  if (guilds.length > 1) {
    guilds.forEach((g, i) => console.log(`  ${i + 1}. ${g.name}`));
    const pick = Number(await ask('Which server is the LAFD server? Type the number: '));
    guild = guilds[pick - 1] || guilds[0];
  }
  console.log(`  Using server "${guild.name}"\n`);

  const roles = await discord(token, `/guilds/${guild.id}/roles`);
  let env = readEnv();
  env = setEnv(env, 'DISCORD_TOKEN', token);
  env = setEnv(env, 'CLIENT_ID', app.id);
  env = setEnv(env, 'GUILD_ID', guild.id);

  const missing = [];
  for (const { envKey, name } of rankEnvKeys()) {
    const role = roles.find((r) => normalize(r.name) === normalize(name));
    if (role) env = setEnv(env, envKey, role.id);
    else missing.push(name);
  }
  fs.writeFileSync(ENV_PATH, env);

  const found = rankEnvKeys().length - missing.length;
  console.log(`  Matched ${found} role(s) by name and saved everything to .env`);
  if (missing.length) {
    console.log(`  No role found with these names (left blank - rename the role in Discord and re-run, or fill in .env by hand):`);
    missing.forEach((n) => console.log(`    - ${n}`));
  }
  console.log('  Channels (logs/announcements) are optional - set them in .env later if you want them.\n');
  rl.close();

  console.log('Registering slash commands...');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'deploy-commands.js')], { stdio: 'inherit' });
  } catch {
    console.log('Command registration failed - see the error above.');
    return;
  }
  console.log('\nAll set. Start the bot with:  npm start\n');
})().catch((err) => {
  console.error('\nSetup failed:', err.message);
  rl.close();
  process.exit(1);
});
