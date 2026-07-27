@echo off
set "APP_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%APP_DIR%Start-Admin.ps1"
exit
