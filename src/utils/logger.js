/**
 * Colored, timestamped logger for the crawler and other scripts.
 *
 * Usage:
 *   const Logger = require("../utils/logger");
 *   Logger.info("Starting crawl...");
 *   Logger.success("Done!");
 */

const Logger = {
    log: (msg) =>
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),

    info: (msg) =>
        console.log(`\x1b[36mℹ ${msg}\x1b[0m`),

    success: (msg) =>
        console.log(`\x1b[32m✔ ${msg}\x1b[0m`),

    warn: (msg) =>
        console.log(`\x1b[33m⚠ ${msg}\x1b[0m`),

    error: (msg, err) =>
        console.error(`\x1b[31m✘ ${msg}\x1b[0m`, err?.message || ""),
};

module.exports = Logger;
