const Database = require("./database");
const { db, admin } = require("../../config/firebase"); // Assuming admin is exported for FieldValue
const Logger = require("../utils/logger");

const COLLECTION = "system_metadata";
const DOC_ID = "crawler_state";
const FIELD = "seenMatches";

class MatchRegistry {
    static cachedSeen = null;
    static lastSync = 0;
    static pendingSync = new Set();
    static SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

    /**
     * Internal helper to sync cache with cloud
     */
    static async syncCache() {
        const now = Date.now();
        // Only sync from cloud every 5 minutes or if never synced
        if (this.cachedSeen && (now - this.lastSync < this.SYNC_INTERVAL)) return;

        // 1. Push any pending writes to the cloud first
        if (this.pendingSync.size > 0) {
            try {
                const ref = db.collection(COLLECTION).doc(DOC_ID);
                const FieldValue = admin.firestore.FieldValue;
                const matchIds = Array.from(this.pendingSync);
                
                await ref.set({
                    [FIELD]: FieldValue.arrayUnion(...matchIds),
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                
                this.pendingSync.clear();
            } catch (e) {
                Logger.warn("Cloud registry write sync failed: " + e.message);
            }
        }

        // 2. Fetch the latest from cloud
        try {
            const doc = await db.collection(COLLECTION).doc(DOC_ID).get();
            if (doc.exists) {
                this.cachedSeen = new Set(doc.data()[FIELD] || []);
            } else {
                this.cachedSeen = new Set();
            }
            this.lastSync = now;
        } catch (e) {
            Logger.warn("Failed to read cloud seen matches: " + e.message);
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
        return this.cachedSeen.has(matchId) || this.pendingSync.has(matchId);
    }

    /**
     * Mark IDs as seen in the Cloud (Firestore).
     * We batch these and upload them during the next syncCache() call to save writes.
     */
    static async markSeen(matchIds) {
        if (!matchIds || matchIds.length === 0) return;

        if (!this.cachedSeen) this.cachedSeen = new Set();
        
        matchIds.forEach(id => {
            this.cachedSeen.add(id);
            this.pendingSync.add(id);
        });
    }
}

module.exports = MatchRegistry;
