/**
 * Global aggregator — merges match data from SQLite,
 * runs the analytics engine, and writes the combined summaries.
 * 
 * Patch-aware: detects current patch, uses fallback if insufficient data,
 * auto-purges old patches once the new patch has enough data.
 * 
 * Now includes INTEGRATED IMPORT — optionally merges the 'Bin' before starting.
 */

const Database = require("../infrastructure/database/sqlite-client");
const ImportManager = require("./import-manager");
const AnalyticsEngine = require("./analytics");
const AssetManager = require("./asset-manager");
const { api } = require("../infrastructure/api/ddragon");
const { STORAGE, RANK_HIERARCHY, CRAWLER, DDRAGON } = require("../../config/constants");
const { writeJson } = require("../infrastructure/utils/io");
const Logger = require("../infrastructure/utils/logger");

class GlobalAggregator {
    /**
     * Fetch the current patch version from DDragon realm.
     * @returns {string|null} e.g. "16.8"
     */
    static async getCurrentPatch() {
        try {
            const realm = await api.getRealm(DDRAGON.REALM_URL);
            return realm.v.split(".").slice(0, 2).join(".");
        } catch (e) {
            Logger.warn("Failed to fetch current patch: " + e.message);
            return null;
        }
    }

    /**
     * Determine which patch to use for aggregation.
     * Returns { patch, isFallback }.
     * 
     * Logic:
     *   1. If current patch has >= MIN_MATCHES_FOR_NEW_PATCH → use it
     *   2. Otherwise, fall back to the most recent patch with the most data
     */
    static async determinePatch(currentPatch) {
        const patches = await Database.getDistinctPatches();

        if (!patches || patches.length === 0) {
            return { patch: currentPatch, isFallback: false };
        }

        // Check if current patch has enough data
        if (currentPatch) {
            const currentEntry = patches.find(p => p.patch === currentPatch);
            const currentCount = currentEntry ? currentEntry.count : 0;

            if (currentCount >= CRAWLER.MIN_MATCHES_FOR_NEW_PATCH) {
                Logger.success(`Current patch ${currentPatch} has ${currentCount} matches (≥${CRAWLER.MIN_MATCHES_FOR_NEW_PATCH}). Using current patch.`);
                return { patch: currentPatch, isFallback: false };
            }

            Logger.warn(`Current patch ${currentPatch} has only ${currentCount} matches (need ${CRAWLER.MIN_MATCHES_FOR_NEW_PATCH}). Looking for fallback...`);
        }

        // Fall back to the patch with the most data
        const bestPatch = patches.sort((a, b) => b.count - a.count)[0];
        Logger.info(`Using fallback patch ${bestPatch.patch} (${bestPatch.count} matches).`);
        return { patch: bestPatch.patch, isFallback: true };
    }

    /**
     * Main entry point for aggregation.
     * 
     * @param {boolean} autoImport - If true, syncs data from 'data/import/' first.
     */
    static async mergeAll(autoImport = true) {
        // 1. Integrated Import from Bin (Smart Merge)
        if (autoImport) {
            await ImportManager.runImport();
        }

        Logger.info("Running Global Aggregation from SQLite database...");

        // 2. Connect to DB
        await Database.connect();

        // 3. Determine which patch to aggregate
        const currentPatch = await this.getCurrentPatch();
        const { patch: activePatch, isFallback } = await this.determinePatch(currentPatch);

        if (!activePatch) {
            Logger.warn("No patch version available. Aggregating all data.");
        }

        Logger.info(`Aggregating data for patch: ${activePatch || "ALL"}${isFallback ? " (FALLBACK)" : ""}`);

        const stats = AnalyticsEngine.initStats();
        let totalRanked = 0;
        const assets = await AssetManager.getAssets();

        // 4. Process each rank from the Database (no patch filtering)
        for (const rank of RANK_HIERARCHY) {
            // We fetch ALL matches available in the DB for this rank.
            // The DB itself (auto-purge) limits this to the last 2 patches.
            const matches = await Database.getMatchesForRank(rank.tier, rank.division);

            if (matches.length > 0) {
                Logger.info(`Processing ${rank.tier} ${rank.division} (${matches.length} matches)...`);

                // Fetch timelines for these specific matches (only Skill events remain)
                const matchIds = matches.map(m => m.metadata.matchId);
                const timelines = await Database.getTimelinesForMatches(matchIds);

                totalRanked = AnalyticsEngine.processChunk(stats, totalRanked, matches, timelines, assets, activePatch);
            }
        }

        // 5. Finalize Summaries
        if (totalRanked > 0) {
            const globalRanking = AnalyticsEngine.finalize(stats, totalRanked, assets);

            // CHAMPION_META — full data (with patch info)
            const metaData = globalRanking.map((ch) => {
                const slimCh = { ...ch };
                
                // Remove redundant fields that are now handled by champion_rating and champion_drafting
                delete slimCh.winRate;
                delete slimCh.pickRate;
                delete slimCh.banRate;
                delete slimCh.drafting;

                return {
                    ...slimCh,
                    patch: activePatch ? `${activePatch} (+Fallback)` : "ALL",
                    isFallback,
                };
            });
            await writeJson(STORAGE.CHAMPION_META, metaData, true); // true = minify

            // CHAMPION_RATING — slim rates
            const ratingData = globalRanking.map((ch) => {
                return {
                    id: ch.id,
                    championId: ch.championId,
                    name: ch.name,
                    score: ch.score, // Identical to meta's score
                    winRate: `${ch.winRate.toFixed(2)}%`,
                    pickRate: `${ch.pickRate.toFixed(2)}%`,
                    banRate: `${ch.banRate.toFixed(2)}%`,
                    icon: ch.id && assets.champData[ch.id]
                        ? `https://ddragon.leagueoflegends.com/cdn/${assets.ddragonVersion}/img/champion/${assets.champData[ch.id].image.full}`
                        : "",
                    lane: ch.lanes && ch.lanes.length > 0 ? ch.lanes : ["Unknown"],
                    role: assets.champData[ch.id] ? assets.champData[ch.id].tags : ["Unknown"],
                    patch: activePatch ? `${activePatch} (+Fallback)` : "ALL",
                    isFallback,
                };
            });
            await writeJson(STORAGE.CHAMPION_RATING, ratingData, true);
            await writeJson(STORAGE.RATES_SUMMARY, ratingData, true);

            // CHAMPION_DRAFTING — matchups
            const draftData = globalRanking.map((ch) => ({
                id: ch.id,
                championId: ch.championId,
                name: ch.name,
                drafting: ch.drafting,
            }));
            await writeJson(STORAGE.CHAMPION_DRAFTING, draftData, true);

            // CHAMPION_SCALING — power spikes
            const scalingData = globalRanking.map((ch) => ({
                id: ch.id,
                championName: ch.name,
                scalingData: ch.scalingData,
            }));
            await writeJson(STORAGE.CHAMPION_SCALING, scalingData, true);

            Logger.success(
                `Champion data updated! Patch: ${activePatch}${isFallback ? " (fallback)" : ""} | Total matches analyzed: ${totalRanked}`
            );

            // 6. Auto-purge old patches if we're using current patch (not fallback)
            if (!isFallback && currentPatch) {
                const patches = await Database.getDistinctPatches();
                const patchNames = patches.map(p => p.patch);

                // Keep current patch + at most 1 previous
                const keepPatches = [currentPatch];
                const olderPatches = patchNames
                    .filter(p => p !== currentPatch)
                    .sort()
                    .reverse();

                if (olderPatches.length > 0 && CRAWLER.ALLOWED_PATCHES > 1) {
                    keepPatches.push(olderPatches[0]); // Keep 1 fallback
                }

                const toRemove = patchNames.filter(p => !keepPatches.includes(p));
                if (toRemove.length > 0) {
                    Logger.info(`Auto-purging old patches: ${toRemove.join(", ")}...`);
                    const deleted = await Database.purgeOldPatches(keepPatches);
                    Logger.success(`Purged ${deleted} old matches.`);
                    await Database.vacuum();
                }
            }
        } else {
            Logger.warn("No data found in database to aggregate.");
        }
    }
}

module.exports = GlobalAggregator;
