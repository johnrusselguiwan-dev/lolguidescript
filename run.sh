#!/usr/bin/env bash

echo "============================================"
echo "  LoL Guide Crawler - Starting Up (Linux)..."
echo "============================================"
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in PATH!"
    echo "Please install Node.js (v18+) to continue."
    exit 1
fi

echo "[SETUP] Checking backend dependencies..."
npm install --no-audit --no-fund --quiet
echo ""

if [ -d "hextech-dashboard" ]; then
    echo "[SETUP] Checking dashboard dependencies..."
    cd hextech-dashboard
    npm install --legacy-peer-deps --no-audit --no-fund --quiet
    cd ..
    echo ""
fi

echo "[OK] Starting LoL Guide Crawler..."
echo ""
node --max-old-space-size=8192 index.js
