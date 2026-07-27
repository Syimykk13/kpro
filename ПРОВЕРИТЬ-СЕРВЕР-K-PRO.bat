@echo off
title K-pro Server Diagnostics
cd /d "%~dp0"
echo.
echo K-pro: checking VPS 132.243.114.107
echo If OpenSSH asks for root password, type it and press Enter.
echo.
ssh.exe -o StrictHostKeyChecking=accept-new root@132.243.114.107 "echo SERVICE; systemctl --no-pager --full status kassa-pro-admin.service || true; echo; echo PORTS; ss -ltnp | grep 5173 || true; echo; echo LOGS; journalctl -u kassa-pro-admin.service -n 80 --no-pager || true; echo; echo FILES; ls -lah /opt/kassa-pro || true; echo; echo DATA; ls -lah /opt/kassa-pro/data || true; echo; echo NODE; node -v || true"
echo.
echo Window will stay open. Press any key to close.
pause >nul
