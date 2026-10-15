@echo off
title LAFD Management
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org then run this again. & pause & exit /b 1)
if not exist .env (copy .env.example .env >nul & echo Created .env - open it in Notepad, fill in DISCORD_TOKEN, CLIENT_ID and GUILD_ID, then run this again. & pause & exit /b 1)
echo Updating dependencies...
call npm install --no-fund --no-audit
:loop
echo Starting LAFD Management... (close this window to stop the bot)
call npm start
echo Bot stopped. Restarting in 5 seconds - close this window to stop.
timeout /t 5 >nul
goto loop
