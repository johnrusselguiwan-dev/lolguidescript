@echo off
IF NOT EXIST "node_modules\" (
    echo Installing dependencies...
    call npm install
) ELSE (
    echo Dependencies already installed.
)
echo Running script...
node scripts/index.js
pause
