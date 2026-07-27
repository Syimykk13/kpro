@echo off
title K-pro Deploy Server
cd /d "%~dp0"
echo.
echo K-pro: deploy to VPS 132.243.114.107
echo If OpenSSH asks for root password, type it and press Enter.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0release\deploy-to-vps.ps1"
echo.
echo Window will stay open. Press any key to close.
pause >nul
