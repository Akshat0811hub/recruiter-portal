@echo off
cd /d "%~dp0"
title Omnichannel Recruitment CRM Server (Live)
echo ===============================================================
echo  🚀 Omnichannel Recruitment CRM Server Starting...
echo ===============================================================
echo  Local PC Dashboard:    http://localhost:3000
echo  Frozen IP Dashboard:   http://192.168.1.34:3000
echo  Hostname Dashboard:    http://%COMPUTERNAME%:3000
echo  Extension Webhook:     http://192.168.1.34:3000/api/webhook
echo  Mobile Call Webhook:   http://192.168.1.34:3000/api/calls/log
echo ===============================================================
echo  Keep this window open while using the CRM!
echo ===============================================================

start "" "http://localhost:3000"
call "C:\Users\D552266\AppData\Roaming\Antigravity\bin\agy-node.cmd" server.js
pause
