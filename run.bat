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

IF NOT EXIST "node_modules\" (
    echo [SETUP] Installing dependencies for first time...
    call npm install
    echo.
)

echo [OK] Starting LoL Guide...
echo.
node --max-old-space-size=8192 index.js
pause
