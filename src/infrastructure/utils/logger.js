/**
 * Colored, timestamped logger for the crawler and other scripts.
 *
 * Usage:
 *   const Logger = require("../utils/logger");
 *   Logger.info("Starting crawl...");
 *   Logger.success("Done!");
 */

const logBuffer = [];
const MAX_LOGS = 100;

function addLog(msg, type = "info") {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    logBuffer.push({ msg: `[${time}] ${msg}`, type });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

const Logger = {
    log: (msg) => {
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
        addLog(msg, "info");
    },

    info: (msg) => {
        console.log(`\x1b[36mℹ ${msg}\x1b[0m`);
        // Filter out noisy crawler logs from the UI
        if (msg.includes("Page ") || msg.includes("Resting for") || msg.includes("[CRAWLING ")) {
            return; 
        }
        addLog(`ℹ ${msg}`, "info");
    },

    success: (msg) => {
        console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
        addLog(`✔ ${msg}`, "success");
    },

    warn: (msg) => {
        console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
        addLog(`⚠ ${msg}`, "warning");
    },

    error: (msg, err) => {
        console.error(`\x1b[31m✘ ${msg}\x1b[0m`, err?.message || "");
        addLog(`✘ ${msg} ${err?.message || ""}`.trim(), "error");
    },

    request: (reqNum, msg) => {
        const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        console.log(`[${time}] [REQ ${reqNum}] ${msg}`);
        // We usually don't buffer every single HTTP request because it floods the UI, but let's keep it simple or skip it.
        // Let's skip buffering HTTP requests so the UI logs are clean.
    },

    getLogs: () => logBuffer,
    clearLogs: () => { logBuffer.length = 0; }
};

module.exports = Logger;
