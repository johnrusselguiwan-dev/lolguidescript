/**
 * Database Service — Wrapper for SQLite3 database operations.
 * Handles match storage, timelines, and deduplication.
 */

const sqlite3 = require("sqlite3").verbose();
const { STORAGE } = require("../../config/constants");
const Logger = require("../utils/logger");

class Database {
    constructor() {
        this.db = null;
    }

    /**
     * Connect to the SQLite database and initialize schema.
     */
    async connect() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(STORAGE.DATABASE, (err) => {
                if (err) {
                    Logger.error("Failed to connect to SQLite: " + err.message);
                    return reject(err);
                }
                this.initSchema().then(resolve).catch(reject);
            });
        });
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

    /**
     * Save a match and its timeline.
     * deduplicates automatically.
     */
    async saveMatch(matchDetail, timeline, stripTimeline = true) {
        const matchId = matchDetail.metadata.matchId;
        const tier = matchDetail.tier || "UNKNOWN";
        const division = matchDetail.division || "UNKNOWN";
        const ts = matchDetail.info.gameCreation;

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
                "INSERT OR IGNORE INTO matches (matchId, tier, division, timestamp, data) VALUES (?, ?, ?, ?, ?)",
                [matchId, tier, division, ts, JSON.stringify(matchDetail)]
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
     * Get all matches for a specific rank.
     */
    async getMatchesForRank(tier, division) {
        const rows = await this.all(
            "SELECT data FROM matches WHERE tier = ? AND division = ?",
            [tier, division]
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

    close() {
        if (this.db) this.db.close();
    }
}

// Export a singleton
module.exports = new Database();
