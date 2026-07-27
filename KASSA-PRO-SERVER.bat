@echo off
set "APP_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%APP_DIR%Start-Kassa.ps1" -Mode Server
exit
