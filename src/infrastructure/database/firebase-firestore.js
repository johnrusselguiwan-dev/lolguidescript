const Database = require("./sqlite-client");
const Logger = require("../utils/logger");

/**
 * MatchRegistry — Deduplication layer for crawled matches.
 *
 * Strategy: Region-based work splitting across multiple laptops means
 * match IDs never collide (they're prefixed by platform, e.g. PH2_, NA1_).
 * All dedup is handled locally via SQLite's `INSERT OR IGNORE` on the
 * matchId PRIMARY KEY.
 *
 * The old Firestore cloud sync has been removed to save Firebase read quota.
 */
class MatchRegistry {
    /**
     * Checks if a match has already been seen (local SQLite only).
     */
    static async isSeen(matchId) {
        await Database.connect();
        return Database.isSeen(matchId);
    }

    /**
     * Mark IDs as seen — no-op since matches are already deduplicated
     * via SQLite PRIMARY KEY constraint in sqlite-client.saveMatch().
     */
    static async markSeen(matchIds) {
        // No-op — dedup handled by INSERT OR IGNORE in sqlite-client.js
        return;
    }
}

module.exports = MatchRegistry;
