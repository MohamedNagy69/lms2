@echo off
rem Starts the database and the site, then opens it in the browser.
rem Kept ASCII-only on purpose: cmd misreads UTF-8 batch files. Messages come from scripts\local-control.mjs.
chcp 65001 >nul
cd /d "%~dp0"
title Mudarris - start
node scripts\local-control.mjs start
if errorlevel 1 (
  pause
  exit /b 1
)
ping -n 6 127.0.0.1 >nul
