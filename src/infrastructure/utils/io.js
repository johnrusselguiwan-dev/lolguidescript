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
        const content = await fs.readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch {
        return fallback;
    }
}

/**
 * Serialize `data` and write it to `filePath`.
 * Creates any missing parent directories automatically.
 * 
 * @param {string} filePath - Path to save the file
 * @param {any} data - Object to serialize
 * @param {boolean} minify - If true, saves without spaces/newlines (safest for huge files)
 */
async function writeJson(filePath, data, minify = true) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    // For very large objects, pretty-printing (null, 2) can double the string size 
    // and hit V8's 1GB string limit. Minifying prevents this.
    const json = minify ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    
    await fs.writeFile(filePath, json, "utf8");
}

module.exports = { readJson, writeJson };
