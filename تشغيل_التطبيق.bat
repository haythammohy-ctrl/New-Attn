@echo off
title تشغيل تطبيق الحضور والمرتبات
cd /d "%~dp0"
echo ==============================================
echo   جاري تشغيل سيرفر الحضور والمرتبات...
echo   اترك هذه النافذة مفتوحة أثناء استخدام التطبيق
echo ==============================================
start http://localhost:8080/?demo
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Get-Content -Raw serve.ps1)"
pause

