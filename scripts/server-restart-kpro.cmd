@echo off
chcp 65001 > nul
title K-pro server restart
echo Введите пароль root от VPS, если SSH спросит пароль.
echo.
ssh root@132.243.114.107 "bash -lc 'echo KPRO_RESTART; systemctl restart kassa-pro-admin.service; systemctl reload nginx || systemctl restart nginx; sleep 2; echo SERVICE; systemctl is-active kassa-pro-admin.service; systemctl is-active nginx; echo PORTS; ss -ltnp; echo LOCAL_TESTS; curl -I --max-time 8 http://127.0.0.1:5173/; curl -I --max-time 8 http://127.0.0.1/; echo LOGS; journalctl -u kassa-pro-admin.service -n 60 --no-pager; echo DONE'"
echo.
echo Window will stay open. Copy errors here if site still does not open.
pause
