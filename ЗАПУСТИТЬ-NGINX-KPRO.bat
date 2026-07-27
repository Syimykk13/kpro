@echo off
title K-pro Nginx Setup
cd /d "%~dp0"
echo.
echo K-pro: setup nginx for kpro.kg on VPS
echo If OpenSSH asks for root password, type it and press Enter.
echo.
ssh.exe -o StrictHostKeyChecking=accept-new root@132.243.114.107 "bash /tmp/setup-kpro-nginx.sh; echo; echo PORTS; ss -ltnp | grep -E ':80|:443|:5173' || true; echo; echo NGINX; systemctl status nginx --no-pager --full || true; echo; echo KPRO_TEST; curl -I --max-time 8 http://127.0.0.1/ -H 'Host: kpro.kg' || true"
echo.
echo Window will stay open. Press any key to close.
pause >nul
