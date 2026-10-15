@echo off
title LAFD Management
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org/en/download
  echo then restart your computer and run this again.
  pause
  exit /b 1
)

if not exist .env (
  copy .env.example .env >nul
  echo Created a .env file. Open it in Notepad, fill in DISCORD_TOKEN, CLIENT_ID and GUILD_ID,
  echo save it, then run this again.
  pause
  exit /b 1
)

echo Installing / updating dependencies...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  Installing dependencies FAILED - the bot cannot start.
  echo  1. Close this window.
  echo  2. Delete the "node_modules" folder in this folder.
  echo  3. Run start.bat again.
  echo  If it fails again, send a screenshot of this window.
  echo ============================================================
  pause
  exit /b 1
)

:loop
echo.
echo Starting LAFD Management... (close this window to stop the bot)
call npm start
echo Bot stopped. Restarting in 10 seconds - close this window to stop.
timeout /t 10 >nul
goto loop
