@echo off
cd /d "%~dp0"
node server.mjs --host 0.0.0.0
pause
