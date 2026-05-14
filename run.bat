@echo off
title LoL Guide Crawler
echo ============================================
echo   LoL Guide Crawler - Starting Up...
echo ============================================
echo.

where node >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo [SETUP] Checking backend dependencies...
call npm install --no-audit --no-fund --quiet
echo.

echo [SETUP] Checking dashboard dependencies...
cd hextech-dashboard
call npm install --legacy-peer-deps --no-audit --no-fund --quiet
cd ..
echo.

echo [OK] Starting LoL Guide...
echo.
node --max-old-space-size=8192 index.js
pause
