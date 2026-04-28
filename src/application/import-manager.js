/**
 * Import Manager — Handles exporting and importing SQLite databases
 * for easy team sharing without needing to move JSON files around.
 */

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const { STORAGE } = require("../../config/constants");
const Database = require("../infrastructure/database/sqlite-client");
const Logger = require("../infrastructure/utils/logger");
const MatchRegistry = require("../infrastructure/database/firebase-firestore");

class ImportManager {
    /**
     * Export the local crawler.db to the user's Desktop.
     * Before exporting, it runs VACUUM to ensure the file is as small as possible.
     */
    static async exportDatabase() {
        try {
            await Database.connect();
            Logger.info("Optimizing database before export...");
            await Database.vacuum();

            const dateStr = new Date().toISOString().split("T")[0];
            const desktopPath = path.join(os.homedir(), "Desktop");
            const exportFileName = `worker_export_${dateStr}.db`;
            const exportPath = path.join(desktopPath, exportFileName);

            Logger.info(`Copying database to ${exportPath}...`);
            
            // Close DB briefly to ensure safe copy
            Database.close();
            await fs.copyFile(STORAGE.DATABASE, exportPath);
            await Database.connect(); // Reconnect

            const stats = await fs.stat(exportPath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

            Logger.success(`\nExport complete! File saved to your Desktop:`);
            Logger.success(`  ➜ ${exportFileName} (${sizeMB} MB)`);
            Logger.info(`Send this file to your Master laptop for aggregation.\n`);

        } catch (e) {
            Logger.error("Failed to export database: " + e.message);
        }
    }

    /**
     * Import matches from a coworker's exported .db file.
     * @param {string} incomingDbPath 
     */
    static async runImport(incomingDbPath) {
        if (!incomingDbPath) return;
        
        // Clean up quotes if user dragged-and-dropped the file
        incomingDbPath = incomingDbPath.replace(/^["']|["']$/g, "").trim();

        try {
            await fs.access(incomingDbPath);
        } catch {
            Logger.error(`Cannot read file at: ${incomingDbPath}`);
            return;
        }

        Logger.info(`Connecting to incoming database at ${incomingDbPath}...`);
        
        await Database.connect();

        return new Promise((resolve, reject) => {
            const incomingDb = new sqlite3.Database(incomingDbPath, sqlite3.OPEN_READONLY, async (err) => {
                if (err) {
                    Logger.error("Failed to open incoming DB: " + err.message);
                    return resolve();
                }

                try {
                    Logger.info("Reading matches from incoming database...");
                    
                    // Fetch all matches from incoming DB
                    const matches = await new Promise((res, rej) => {
                        incomingDb.all("SELECT * FROM matches", (e, rows) => {
                            if (e) rej(e);
                            else res(rows);
                        });
                    });

                    // Fetch all timelines from incoming DB
                    const timelines = await new Promise((res, rej) => {
                        incomingDb.all("SELECT * FROM timelines", (e, rows) => {
                            if (e) rej(e);
                            else res(rows);
                        });
                    });

                    if (matches.length === 0) {
                        Logger.warn("Incoming database has no matches.");
                        incomingDb.close();
                        return resolve();
                    }

                    Logger.info(`Found ${matches.length} matches. Merging into local database...`);

                    // Create lookup map for timelines
                    const tlMap = {};
                    for (const tl of timelines) {
                        tlMap[tl.matchId] = tl.data;
                    }

                    await Database.run("BEGIN TRANSACTION");
                    
                    let newMatches = 0;
                    const newIds = [];

                    for (const m of matches) {
                        // Check if we already have it
                        const exists = await Database.isSeen(m.matchId);
                        if (!exists) {
                            try {
                                const detail = JSON.parse(m.data);
                                detail.tier = m.tier;
                                detail.division = m.division;
                                
                                const tlData = tlMap[m.matchId] ? JSON.parse(tlMap[m.matchId]) : null;
                                
                                const saved = await Database.saveMatch(detail, tlData, false); // false = already stripped
                                if (saved) {
                                    newMatches++;
                                    newIds.push(m.matchId);
                                }
                            } catch (e) {
                                // Skip malformed
                            }
                        }
                    }

                    await Database.run("COMMIT");

                    if (newMatches > 0) {
                        Logger.success(`Successfully merged ${newMatches} new matches!`);
                        Logger.info("Syncing new IDs to Firebase cache...");
                        await MatchRegistry.markSeen(newIds);
                    } else {
                        Logger.info("All matches in the incoming database are already in your local database. Nothing new to add.");
                    }

                } catch (e) {
                    await Database.run("ROLLBACK").catch(() => {});
                    Logger.error("Error during import: " + e.message);
                } finally {
                    incomingDb.close();
                    resolve();
                }
            });
        });
    }
}

module.exports = ImportManager;
