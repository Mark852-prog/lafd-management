#!/usr/bin/env bash
# Mac/Linux launcher: installs dependencies and keeps the bot running.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org"; exit 1; }
[ -f .env ] || { cp .env.example .env; echo "Created .env - fill in DISCORD_TOKEN, CLIENT_ID and GUILD_ID, then run this again."; exit 1; }
npm install --no-fund --no-audit
while true; do
  npm start
  echo "Bot stopped. Restarting in 5 seconds (Ctrl+C to quit)..."
  sleep 5
done
