@echo off
title Attendance App Server
cd /d "%~dp0"
echo ==============================================
echo   Starting Attendance and Payroll Server...
echo   Keep this window open while using the app
echo ==============================================
start http://localhost:8080/?demo
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Get-Content -Raw serve.ps1)"
pause

