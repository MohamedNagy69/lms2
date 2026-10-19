@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS first.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if errorlevel 1 goto failed
call npm run setup:local
if errorlevel 1 goto failed
call npm run db:migrate
if errorlevel 1 goto failed
echo Open http://localhost:3000
call npm run dev
exit /b %errorlevel%
:failed
echo Startup failed. Read the error above.
pause
exit /b 1
