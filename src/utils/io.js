/**
 * JSON file I/O helpers.
 *
 * Handles missing files gracefully and auto-creates parent directories
 * on write so callers don't need to worry about fs boilerplate.
 */

const fs = require("fs/promises");
const path = require("path");

/**
 * Read and parse a JSON file.
 * Returns `fallback` if the file doesn't exist or can't be parsed.
 */
async function readJson(filePath, fallback = null) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

/**
 * Serialize `data` and write it to `filePath`.
 * Creates any missing parent directories automatically.
 */
async function writeJson(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { readJson, writeJson };
