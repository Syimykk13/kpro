@echo off
set "APP_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%Clear-Kassa-Test-Data.ps1"
pause
