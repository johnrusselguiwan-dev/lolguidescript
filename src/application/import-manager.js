/**
 * Import Manager — Handles exporting and importing SQLite databases
 * for easy team sharing without needing to move JSON files around.
 *
 * Supports:
 *   - Export to Desktop (CLI legacy)
 *   - Export to data/exports/ folder (Dashboard/API)
 *   - Single-file import
 *   - Batch import from data/import/ bin folder
 */

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const { STORAGE } = require("../../config/constants");
const Database = require("../infrastructure/database/sqlite-client");
const Logger = require("../infrastructure/utils/logger");

class ImportManager {
    /**
     * Export the local crawler.db to the user's Desktop.
     * Before exporting, it runs VACUUM to ensure the file is as small as possible.
     */
    static async exportDatabase() {
        const desktopPath = path.join(os.homedir(), "Desktop");
        return this.exportToFolder(desktopPath);
    }

    /**
     * Export the local crawler.db to a specific folder.
     * VACUUMs the DB first, then copies it with a timestamped name.
     * @param {string} destDir — destination directory path
     * @returns {{ fileName: string, filePath: string, sizeMB: string } | null}
     */
    static async exportToFolder(destDir) {
        try {
            await Database.connect();

            // Ensure destination directory exists
            await fs.mkdir(destDir, { recursive: true });

            const dateStr = new Date().toISOString().replace(/[:.]/g, "-").split("T").join("_").slice(0, 19);
            const exportFileName = `worker_export_${dateStr}.db`;
            const exportPath = path.join(destDir, exportFileName);

            // Use "VACUUM INTO" to create an optimized copy without closing the main handle.
            // This prevents background crawler crashes during export.
            await Database.vacuumInto(exportPath);

            const stats = await fs.stat(exportPath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

            Logger.success(`\nExport complete! File saved to:`);
            Logger.success(`  ➜ ${exportFileName} (${sizeMB} MB)`);

            return { fileName: exportFileName, filePath: exportPath, sizeMB };
        } catch (e) {
            Logger.error("Failed to export database: " + e.message);
            // Try reconnecting in case we closed it
            try { await Database.connect(); } catch (_) {}
            return null;
        }
    }

    /**
     * Import matches from a coworker's exported .db file.
     * @param {string} incomingDbPath
     * @returns {{ newMatches: number, totalIncoming: number } | null}
     */
    static async runImport(incomingDbPath) {
        if (!incomingDbPath) return null;

        // Clean up quotes if user dragged-and-dropped the file
        incomingDbPath = incomingDbPath.replace(/^["']|["']$/g, "").trim();

        try {
            await fs.access(incomingDbPath);
        } catch {
            Logger.error(`Cannot read file at: ${incomingDbPath}`);
            return null;
        }

        Logger.info(`Connecting to incoming database at ${incomingDbPath}...`);

        await Database.connect();

        try {
            // Read incoming DB metadata safely first
            const incomingDb = new sqlite3.Database(incomingDbPath, sqlite3.OPEN_READONLY);
            const totalIncoming = await new Promise((res, rej) => {
                incomingDb.get("SELECT COUNT(*) as c FROM matches", (err, row) => {
                    if (err) rej(err);
                    else res(row ? row.c : 0);
                });
            });

            if (totalIncoming === 0) {
                Logger.warn("Incoming database has no matches.");
                incomingDb.close();
                return { newMatches: 0, totalIncoming: 0 };
            }

            // Get columns to handle schema differences safely
            const incomingCols = await new Promise((res, rej) => {
                incomingDb.all("PRAGMA table_info(matches)", (err, rows) => {
                    if (err) rej(err);
                    else res(rows.map(r => r.name));
                });
            });
            
            // Close readonly connection before ATTACH to avoid locking issues
            await new Promise(res => incomingDb.close(res));

            Logger.info(`Found ${totalIncoming} matches. Merging via ATTACH DATABASE...`);

            // Attach to local DB
            await Database.run(`ATTACH DATABASE ? AS incoming`, [incomingDbPath]);

            // Get local columns
            const localColsRows = await Database.all("PRAGMA table_info(matches)");
            const localCols = localColsRows.map(r => r.name);

            // Construct SELECT safely (use defaults if incoming is missing columns like 'region')
            const selectCols = localCols.map(col => {
                if (incomingCols.includes(col)) {
                    return `incoming.matches.${col}`;
                } else {
                    if (col === 'region') return "'sea' as region";
                    if (col === 'patch') return "NULL as patch";
                    return "NULL";
                }
            }).join(", ");

            // Count before merge
            const countBeforeRow = await Database.get("SELECT COUNT(*) as c FROM matches");
            const countBefore = countBeforeRow ? countBeforeRow.c : 0;

            await Database.run("BEGIN TRANSACTION");
            
            // 1. Bulk merge matches
            await Database.run(`
                INSERT OR IGNORE INTO matches (${localCols.join(", ")})
                SELECT ${selectCols} FROM incoming.matches
            `);
            
            // 2. Bulk merge timelines
            await Database.run(`
                INSERT OR IGNORE INTO timelines (matchId, data)
                SELECT matchId, data FROM incoming.timelines
            `);

            await Database.run("COMMIT");

            // Count after merge
            const countAfterRow = await Database.get("SELECT COUNT(*) as c FROM matches");
            const countAfter = countAfterRow ? countAfterRow.c : 0;
            const newMatches = countAfter - countBefore;

            // Detach incoming database
            await Database.run(`DETACH DATABASE incoming`);

            if (newMatches > 0) {
                Logger.success(`Successfully merged ${newMatches} new matches from ${path.basename(incomingDbPath)}`);
            } else {
                Logger.info(`All matches from ${path.basename(incomingDbPath)} are already in your local database.`);
            }

            return { newMatches, totalIncoming };

        } catch (e) {
            await Database.run("ROLLBACK").catch(() => {});
            await Database.run(`DETACH DATABASE incoming`).catch(() => {});
            Logger.error("Error during import: " + e.message);
            return null;
        }
    }

    /**
     * Batch import all .db files from the data/import/ bin folder.
     * Processes each file sequentially, then optionally deletes them.
     * @param {boolean} deleteAfterImport — if true, remove .db files after successful import
     * @returns {{ results: Array<{ fileName: string, newMatches: number, totalIncoming: number }>, totalNew: number }}
     */
    static async batchImportFromBin(deleteAfterImport = false) {
        const importDir = STORAGE.IMPORT;
        const results = [];
        let totalNew = 0;

        try {
            await fs.mkdir(importDir, { recursive: true });
            const files = await fs.readdir(importDir);
            const dbFiles = files.filter(f => f.endsWith(".db"));

            if (dbFiles.length === 0) {
                Logger.info("No .db files found in the import bin.");
                return { results, totalNew };
            }

            Logger.info(`Found ${dbFiles.length} file(s) in the import bin. Starting batch merge...`);

            for (const fileName of dbFiles) {
                const filePath = path.join(importDir, fileName);
                Logger.info(`\n── Processing: ${fileName} ──`);

                const result = await this.runImport(filePath);

                if (result) {
                    results.push({ fileName, ...result });
                    totalNew += result.newMatches;

                    if (deleteAfterImport) {
                        try {
                            await fs.unlink(filePath);
                            Logger.info(`  Cleaned up: ${fileName}`);
                        } catch (e) {
                            Logger.warn(`  Could not delete ${fileName}: ${e.message}`);
                        }
                    }
                } else {
                    results.push({ fileName, newMatches: 0, totalIncoming: 0, error: true });
                }
            }

            Logger.success(`\nBatch import complete! ${totalNew} new matches merged from ${dbFiles.length} file(s).`);

        } catch (e) {
            Logger.error("Batch import failed: " + e.message);
        }

        return { results, totalNew };
    }

    /**
     * List all .db files currently in the import bin.
     * @returns {Array<{ fileName: string, sizeMB: string, modifiedAt: string }>}
     */
    static async listImportBin() {
        const importDir = STORAGE.IMPORT;
        try {
            await fs.mkdir(importDir, { recursive: true });
            const files = await fs.readdir(importDir);
            const dbFiles = files.filter(f => f.endsWith(".db"));

            const result = [];
            for (const fileName of dbFiles) {
                const filePath = path.join(importDir, fileName);
                const stats = await fs.stat(filePath);
                result.push({
                    fileName,
                    sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                    modifiedAt: stats.mtime.toISOString()
                });
            }
            return result;
        } catch (e) {
            Logger.error("Failed to list import bin: " + e.message);
            return [];
        }
    }

    /**
     * List all exported .db files.
     * @returns {Array<{ fileName: string, sizeMB: string, modifiedAt: string }>}
     */
    static async listExports() {
        const exportDir = STORAGE.EXPORTS;
        try {
            await fs.mkdir(exportDir, { recursive: true });
            const files = await fs.readdir(exportDir);
            const dbFiles = files.filter(f => f.endsWith(".db"));

            const result = [];
            for (const fileName of dbFiles) {
                const filePath = path.join(exportDir, fileName);
                const stats = await fs.stat(filePath);
                result.push({
                    fileName,
                    sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                    modifiedAt: stats.mtime.toISOString()
                });
            }
            return result;
        } catch (e) {
            return [];
        }
    }

    /**
     * Remove a file from the import bin.
     * @param {string} fileName
     */
    static async removeFromBin(fileName) {
        const filePath = path.join(STORAGE.IMPORT, fileName);
        try {
            await fs.unlink(filePath);
            Logger.info(`Removed ${fileName} from import bin.`);
            return true;
        } catch (e) {
            Logger.error(`Failed to remove ${fileName}: ${e.message}`);
            return false;
        }
    }
}

module.exports = ImportManager;
