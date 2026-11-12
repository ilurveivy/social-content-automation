@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Social Content Automation
echo   http://127.0.0.1:4319
echo.
echo   Ctrl+C 停止
echo.
node server.js
echo.
echo   服务已停止
pause
