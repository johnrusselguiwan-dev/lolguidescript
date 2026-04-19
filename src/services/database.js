/**
 * Database Service — Wrapper for SQLite3 database operations.
 * Handles match storage, timelines, deduplication, and patch management.
 */

const sqlite3 = require("sqlite3").verbose();
const { STORAGE } = require("../../config/constants");
const Logger = require("../utils/logger");

class Database {
    constructor() {
        this.db = null;
    }

    /**
     * Connect to the SQLite database, enable WAL mode, and initialize schema.
     */
    async connect() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(STORAGE.DATABASE, (err) => {
                if (err) {
                    Logger.error("Failed to connect to SQLite: " + err.message);
                    return reject(err);
                }
                this.enableWAL()
                    .then(() => this.initSchema())
                    .then(() => this.runMigrations())
                    .then(resolve)
                    .catch(reject);
            });
        });
    }

    /**
     * Enable WAL (Write-Ahead Logging) mode for better concurrency
     * and to prevent SQLITE_READONLY errors on large databases.
     */
    async enableWAL() {
        await this.run("PRAGMA journal_mode=WAL");
    }

    /**
     * Set up the required tables if they don't exist.
     */
    async initSchema() {
        const queries = [
            `CREATE TABLE IF NOT EXISTS matches (
                matchId TEXT PRIMARY KEY,
                tier TEXT,
                division TEXT,
                patch TEXT,
                timestamp INTEGER,
                data TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS timelines (
                matchId TEXT PRIMARY KEY,
                data TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS seen_matches (
                matchId TEXT PRIMARY KEY
            )`,
            // Indices for faster aggregation
            `CREATE INDEX IF NOT EXISTS idx_matches_tier ON matches(tier, division)`
        ];

        for (const query of queries) {
            await this.run(query);
        }
    }

    /**
     * Run any pending migrations (e.g. add patch column to existing DBs).
     */
    async runMigrations() {
        // Check if patch column exists
        const columns = await this.all("PRAGMA table_info(matches)");
        const hasPatch = columns.some(c => c.name === "patch");

        if (!hasPatch) {
            Logger.info("Running migration: Adding 'patch' column to matches table...");
            await this.run("ALTER TABLE matches ADD COLUMN patch TEXT");
            
            // Backfill patch from stored JSON data
            Logger.info("Backfilling patch data from existing matches...");
            const rows = await this.all("SELECT matchId, data FROM matches WHERE patch IS NULL");
            
            if (rows.length > 0) {
                await this.run("BEGIN TRANSACTION");
                let filled = 0;
                for (const row of rows) {
                    try {
                        const match = JSON.parse(row.data);
                        const version = match.info.gameVersion;
                        const patch = version ? version.split(".").slice(0, 2).join(".") : null;
                        if (patch) {
                            await this.run(
                                "UPDATE matches SET patch = ? WHERE matchId = ?",
                                [patch, row.matchId]
                            );
                            filled++;
                        }
                    } catch (e) {
                        // Skip malformed entries
                    }
                }
                await this.run("COMMIT");
                Logger.success(`Backfilled patch for ${filled}/${rows.length} matches.`);
            }

            // Create indices for the new column
            await this.run("CREATE INDEX IF NOT EXISTS idx_matches_patch ON matches(patch)");
            await this.run("CREATE INDEX IF NOT EXISTS idx_matches_tier_patch ON matches(tier, division, patch)");
        }
    }

    // ── Core Helpers ────────────────────────────────────────────────────

    /**
     * Helper to run queries with Promises.
     */
    run(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    /**
     * Helper to get a single row.
     */
    get(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    /**
     * Helper to get multiple rows.
     */
    all(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // ── Match Operations ────────────────────────────────────────────────

    /**
     * Save a match and its timeline.
     * Deduplicates automatically. Stores the patch extracted from gameVersion.
     */
    async saveMatch(matchDetail, timeline, stripTimeline = true) {
        const matchId = matchDetail.metadata.matchId;
        const tier = matchDetail.tier || "UNKNOWN";
        const division = matchDetail.division || "UNKNOWN";
        const ts = matchDetail.info.gameCreation;
        const patch = matchDetail.info.gameVersion
            ? matchDetail.info.gameVersion.split(".").slice(0, 2).join(".")
            : null;

        // Strip timeline junk if requested (Only keep SKILL_LEVEL_UP events)
        let savedTimeline = null;
        if (stripTimeline && timeline && timeline.info) {
            savedTimeline = JSON.parse(JSON.stringify(timeline)); // clone
            savedTimeline.info.frames = timeline.info.frames.map(f => ({
                events: (f.events || []).filter(e => e.type === "SKILL_LEVEL_UP")
            }));
            // Remove huge metadata/participant fields if not needed
            delete savedTimeline.metadata;
        } else if (timeline) {
            savedTimeline = timeline;
        }

        try {
            await this.run(
                "INSERT OR IGNORE INTO matches (matchId, tier, division, patch, timestamp, data) VALUES (?, ?, ?, ?, ?, ?)",
                [matchId, tier, division, patch, ts, JSON.stringify(matchDetail)]
            );
            
            if (savedTimeline) {
                await this.run(
                    "INSERT OR IGNORE INTO timelines (matchId, data) VALUES (?, ?)",
                    [matchId, JSON.stringify(savedTimeline)]
                );
            }
            
            return true;
        } catch (e) {
            Logger.error(`Failed to save match ${matchId}: ${e.message}`);
            return false;
        }
    }

    /**
     * Get the number of matches stored for a specific rank.
     */
    async getMatchCountForRank(tier, division) {
        const row = await this.get(
            "SELECT COUNT(*) as count FROM matches WHERE tier = ? AND division = ?",
            [tier, division]
        );
        return row ? row.count : 0;
    }

    /**
     * Get all matches for a specific rank (no patch filter).
     */
    async getMatchesForRank(tier, division) {
        const rows = await this.all(
            "SELECT data FROM matches WHERE tier = ? AND division = ?",
            [tier, division]
        );
        return rows.map(r => JSON.parse(r.data));
    }

    /**
     * Get all matches for a specific rank filtered by patch.
     */
    async getMatchesForRankAndPatch(tier, division, patch) {
        const rows = await this.all(
            "SELECT data FROM matches WHERE tier = ? AND division = ? AND patch = ?",
            [tier, division, patch]
        );
        return rows.map(r => JSON.parse(r.data));
    }

    /**
     * Get timelines for a set of matches.
     */
    async getTimelinesForMatches(matchIds) {
        if (!matchIds || matchIds.length === 0) return {};
        
        // SQLite has a limit on variables in IN clause (usually 999)
        // For mass aggregation, we'll fetch them in chunks if needed
        const result = {};
        const chunkSize = 500;
        
        for (let i = 0; i < matchIds.length; i += chunkSize) {
            const chunk = matchIds.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => "?").join(",");
            const rows = await this.all(
                `SELECT matchId, data FROM timelines WHERE matchId IN (${placeholders})`,
                chunk
            );
            
            rows.forEach(r => {
                result[r.matchId] = JSON.parse(r.data);
            });
        }
        
        return result;
    }

    /**
     * Check if a match ID has already been seen.
     */
    async isSeen(matchId) {
        const row = await this.get("SELECT 1 FROM matches WHERE matchId = ?", [matchId]);
        return !!row;
    }

    // ── Patch Operations ────────────────────────────────────────────────

    /**
     * Get total match count for a specific patch.
     */
    async getMatchCountForPatch(patch) {
        const row = await this.get(
            "SELECT COUNT(*) as count FROM matches WHERE patch = ?",
            [patch]
        );
        return row ? row.count : 0;
    }

    /**
     * Get a list of distinct patches with their match counts, sorted newest first.
     */
    async getDistinctPatches() {
        return await this.all(
            "SELECT patch, COUNT(*) as count FROM matches WHERE patch IS NOT NULL GROUP BY patch ORDER BY patch DESC"
        );
    }

    /**
     * Delete all matches and timelines NOT in the keepPatches list.
     * Returns the number of deleted matches.
     */
    async purgeOldPatches(keepPatches) {
        if (!keepPatches || keepPatches.length === 0) return 0;

        const placeholders = keepPatches.map(() => "?").join(",");
        
        // Get IDs to delete for timeline cleanup
        const toDelete = await this.all(
            `SELECT matchId FROM matches WHERE patch NOT IN (${placeholders}) OR patch IS NULL`,
            keepPatches
        );

        if (toDelete.length === 0) return 0;

        // Delete timelines first (foreign-key-like cleanup)
        const deleteIds = toDelete.map(r => r.matchId);
        const chunkSize = 500;

        for (let i = 0; i < deleteIds.length; i += chunkSize) {
            const chunk = deleteIds.slice(i, i + chunkSize);
            const ph = chunk.map(() => "?").join(",");
            await this.run(`DELETE FROM timelines WHERE matchId IN (${ph})`, chunk);
        }

        // Delete matches
        await this.run(
            `DELETE FROM matches WHERE patch NOT IN (${placeholders}) OR patch IS NULL`,
            keepPatches
        );

        return toDelete.length;
    }

    /**
     * Reclaim disk space after deleting data.
     */
    async vacuum() {
        Logger.info("Running VACUUM to reclaim disk space...");
        await this.run("VACUUM");
        Logger.success("VACUUM complete.");
    }

    close() {
        if (this.db) this.db.close();
    }
}

// Export a singleton
module.exports = new Database();
