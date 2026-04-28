const Database = require("./sqlite-client");
const { db, admin } = require("../../../config/firebase"); // Assuming admin is exported for FieldValue
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
                const matchIds = Array.from(this.pendingSync);
                const batch = db.batch();
                
                // Group match IDs by their last character (0-9) to shard the arrays
                // This keeps array sizes reasonable while drastically reducing document read/writes
                const shards = {};
                for (const matchId of matchIds) {
                    const shardKey = matchId.slice(-1); 
                    if (!shards[shardKey]) shards[shardKey] = [];
                    shards[shardKey].push(matchId);
                }

                for (const [key, ids] of Object.entries(shards)) {
                    const shardRef = db.collection(COLLECTION).doc(DOC_ID).collection("seen_matches").doc(`shard_${key}`);
                    // ArrayUnion max is technically high, but if chunks ever get huge we could further shard
                    // For typical 400 IDs, this is totally fine and merges smoothly.
                    batch.set(shardRef, {
                        matches: admin.firestore.FieldValue.arrayUnion(...ids),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }

                // Update root timestamp
                batch.set(db.collection(COLLECTION).doc(DOC_ID), {
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                
                await batch.commit();
                this.pendingSync.clear();
            } catch (e) {
                Logger.warn("Cloud registry write sync failed: " + e.message);
            }
        }

        // 2. Fetch the latest from cloud
        try {
            const snapshot = await db.collection(COLLECTION).doc(DOC_ID).collection("seen_matches").get();
            const ids = new Set();
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.matches && Array.isArray(data.matches)) {
                    data.matches.forEach(id => ids.add(id));
                }
            });
            this.cachedSeen = ids;
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
