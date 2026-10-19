@echo off
rem Stops the site, the API and the local database.
rem Kept ASCII-only on purpose: cmd misreads UTF-8 batch files. Messages come from scripts\local-control.mjs.
chcp 65001 >nul
cd /d "%~dp0"
title Mudarris - stop
node scripts\local-control.mjs stop
ping -n 9 127.0.0.1 >nul
