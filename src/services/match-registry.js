/**
 * Match Registry — uses Firebase Firestore to coordinate seen match IDs
 * across multiple crawler instances (laptops). Prevents duplicate fetches
 * by using arrayUnion for atomic, conflict-free additions.
 *
 * Storage: system_metadata/crawler_state → { seenMatches: [...] }
 */

const { db, admin } = require("../../config/firebase");
const Logger = require("../utils/logger");

const DOC_REF = db.collection("system_metadata").doc("crawler_state");

class MatchRegistry {
    /**
     * Download all seen match IDs from Firebase.
     * @returns {Promise<Set<string>>}
     */
    static async loadSeen() {
        try {
            const doc = await DOC_REF.get();
            if (doc.exists && doc.data().seenMatches) {
                const ids = doc.data().seenMatches;
                Logger.info(`Loaded ${ids.length} seen match IDs from Firebase`);
                return new Set(ids);
            }
        } catch (e) {
            Logger.warn("Could not load seen matches from Firebase: " + e.message);
        }
        return new Set();
    }

    /**
     * Batch-add new match IDs to Firebase using arrayUnion.
     * Safe for concurrent writers — Firestore merges automatically.
     * @param {string[]} matchIds — array of new match IDs to mark as seen
     */
    static async markSeen(matchIds) {
        if (!matchIds || matchIds.length === 0) return;
        try {
            await DOC_REF.set(
                { seenMatches: admin.firestore.FieldValue.arrayUnion(...matchIds) },
                { merge: true }
            );
        } catch (e) {
            Logger.warn("Could not sync seen matches to Firebase: " + e.message);
        }
    }
}

module.exports = MatchRegistry;
