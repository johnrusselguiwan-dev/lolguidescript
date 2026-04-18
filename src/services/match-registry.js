const Database = require("./database");
const { db, admin } = require("../../config/firebase"); // Assuming admin is exported for FieldValue
const Logger = require("../utils/logger");

const COLLECTION = "system_metadata";
const DOC_ID = "crawler_state";
const FIELD = "seenMatches";

class MatchRegistry {
    static cachedSeen = null;
    static lastSync = 0;

    /**
     * Internal helper to sync cache with cloud
     */
    static async syncCache() {
        const now = Date.now();
        // Only sync from cloud every 2 minutes or if never synced
        if (this.cachedSeen && (now - this.lastSync < 120000)) return;

        try {
            const doc = await db.collection(COLLECTION).doc(DOC_ID).get();
            if (doc.exists) {
                this.cachedSeen = new Set(doc.data()[FIELD] || []);
            } else {
                this.cachedSeen = new Set();
            }
            this.lastSync = now;
        } catch (e) {
            Logger.warn("Failed to sync cloud seen matches: " + e.message);
            if (!this.cachedSeen) this.cachedSeen = new Set();
        }
    }

    /**
     * Checks if a match has already been seen (locally or globally).
     */
    static async isSeen(matchId) {
        // 1. Check local SQLite database (Most efficient)
        await Database.connect();
        const localSeen = await Database.isSeen(matchId);
        if (localSeen) return true;

        // 2. Check Session Cache (Syncs with Cloud periodically)
        await this.syncCache();
        return this.cachedSeen.has(matchId);
    }

    /**
     * Mark IDs as seen in the Cloud (Firestore).
     */
    static async markSeen(matchIds) {
        if (!matchIds || matchIds.length === 0) return;

        // 1. Update Session Cache immediately
        if (!this.cachedSeen) this.cachedSeen = new Set();
        matchIds.forEach(id => this.cachedSeen.add(id));

        // 2. Update Cloud
        try {
            const ref = db.collection(COLLECTION).doc(DOC_ID);
            
            // Firebase limits array size in doc (1MB), but arrayUnion is efficient
            // Firestore.FieldValue.arrayUnion is usually accessed via admin.firestore
            const FieldValue = admin.firestore.FieldValue;
            
            // Firestore batch update or single set with merge
            await ref.set({
                [FIELD]: FieldValue.arrayUnion(...matchIds),
                updatedAt: new Date().toISOString()
            }, { merge: true });

        } catch (e) {
            Logger.warn("Cloud registry sync failed: " + e.message);
        }
    }
}

module.exports = MatchRegistry;
