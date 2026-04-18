/**
 * Import Manager — handles "Smart Merging" of match data from other laptops.
 * Now using SQLite for high-performance deduplication and storage.
 */

const fs = require("fs/promises");
const path = require("path");
const { STORAGE, RANK_HIERARCHY } = require("../../config/constants");
const { readJson } = require("../utils/io");
const Database = require("./database");
const MatchRegistry = require("./match-registry");
const Logger = require("../utils/logger");

class ImportManager {
    /**
     * Main entry point for the import process.
     */
    static async runImport() {
        // Ensure DB is connected
        await Database.connect();

        Logger.info("Starting Smart Import from 'data/import/'...");
        
        try {
            await fs.access(STORAGE.IMPORT);
        } catch {
            Logger.warn("Import directory 'data/import/' not found.");
            return;
        }

        let totalNewMatches = 0;
        let totalProcessedRanks = 0;
        const allNewIds = [];

        for (const rank of RANK_HIERARCHY) {
            const importRankDir = path.join(STORAGE.IMPORT, rank.tier, rank.division);
            
            try {
                await fs.access(importRankDir);
            } catch {
                continue; 
            }

            Logger.info(`Processing ${rank.tier} ${rank.division} from bin...`);
            totalProcessedRanks++;

            // Load incoming data
            const incomingStore = await readJson(path.join(importRankDir, "matchStore.json"), []);
            const incomingTL = await readJson(path.join(importRankDir, "timelines.json"), {});

            if (incomingStore.length === 0) {
                Logger.warn(`  ↳ Bin for ${rank.tier} ${rank.division} is empty.`);
                continue;
            }

            // Transactional Save to SQLite
            await Database.run("BEGIN TRANSACTION");
            let rankNewMatches = 0;

            for (const m of incomingStore) {
                const matchId = m.metadata.matchId;
                
                // Check if already in SQL
                const exists = await Database.isSeen(matchId);
                if (!exists) {
                    m.tier = rank.tier;
                    m.division = rank.division;
                    const success = await Database.saveMatch(m, incomingTL[matchId], true);
                    if (success) {
                        rankNewMatches++;
                        allNewIds.push(matchId);
                    }
                }
            }

            await Database.run("COMMIT");

            if (rankNewMatches > 0) {
                totalNewMatches += rankNewMatches;
                Logger.success(`  ↳ Merged ${rankNewMatches} new matches.`);
            } else {
                Logger.info(`  ↳ All matches in bin are duplicates.`);
            }
        }

        if (totalProcessedRanks > 0 && totalNewMatches > 0) {
            // Update cloud seen status
            Logger.info(`Syncing ${allNewIds.length} new IDs to Firebase...`);
            await MatchRegistry.markSeen(allNewIds);
            Logger.success(`\nImport Complete! Added ${totalNewMatches} matches.`);
        } else if (totalProcessedRanks > 0) {
            Logger.info("\nImport finished. No new data found.");
        }

        // Cleanup bin after successful import
        if (totalProcessedRanks > 0) {
            Logger.info("Cleaning up 'data/import/'...");
            await this.cleanImportDir();
        }
    }

    static async cleanImportDir() {
        try {
            const files = await fs.readdir(STORAGE.IMPORT);
            for (const file of files) {
                const fullPath = path.join(STORAGE.IMPORT, file);
                await fs.rm(fullPath, { recursive: true, force: true });
            }
        } catch (e) {
            Logger.warn("Cleanup failed: " + e.message);
        }
    }
}

module.exports = ImportManager;
