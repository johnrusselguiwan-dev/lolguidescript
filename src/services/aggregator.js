/**
 * Global aggregator — merges match data from SQLite,
 * runs the analytics engine, and writes the combined summaries.
 * 
 * Now includes INTEGRATED IMPORT — optionally merges the 'Bin' before starting.
 */

const Database = require("./database");
const ImportManager = require("./import-manager");
const AnalyticsEngine = require("./analytics");
const AssetManager = require("./asset-manager");
const { STORAGE, RANK_HIERARCHY } = require("../../config/constants");
const { writeJson } = require("../utils/io");
const Logger = require("../utils/logger");

class GlobalAggregator {
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

        const stats = AnalyticsEngine.initStats();
        let totalRanked = 0;
        const assets = await AssetManager.getAssets();

        // 3. Process each rank from the Database
        for (const rank of RANK_HIERARCHY) {
            const matches = await Database.getMatchesForRank(rank.tier, rank.division);
            
            if (matches.length > 0) {
                Logger.info(`Processing ${rank.tier} ${rank.division} (${matches.length} matches)...`);
                
                // Fetch timelines for these specific matches (only Skill events remain)
                const matchIds = matches.map(m => m.metadata.matchId);
                const timelines = await Database.getTimelinesForMatches(matchIds);

                totalRanked = AnalyticsEngine.processChunk(stats, totalRanked, matches, timelines, assets);
            }
        }

        // 4. Finalize Summaries
        if (totalRanked > 0) {
            const globalRanking = AnalyticsEngine.finalize(stats, totalRanked, assets);

            // CHAMPION_META — full data
            const metaData = globalRanking.map((ch) => ({
                ...ch,
                drafting: {
                    strongAgainst: (ch.drafting.strongAgainst || []).slice(0, 10),
                    weakAgainst: (ch.drafting.weakAgainst || []).slice(0, 10),
                    synergizesWith: (ch.drafting.synergizesWith || []).slice(0, 10),
                },
            }));
            await writeJson(STORAGE.CHAMPION_META, metaData, true); // true = minify

            // CHAMPION_RATING — slim rates
            const ratingData = globalRanking.map((ch) => {
                const champBase = assets.champData[ch.championName];
                return {
                    id: ch.championId,
                    name: champBase ? champBase.name : ch.championName,
                    score: ch.score, // Identical to meta's score
                    winRate: `${ch.winRate.toFixed(2)}%`,
                    pickRate: `${ch.pickRate.toFixed(2)}%`,
                    banRate: `${ch.banRate.toFixed(2)}%`,
                    icon: champBase
                        ? `https://ddragon.leagueoflegends.com/cdn/${assets.ddragonVersion}/img/champion/${champBase.image.full}`
                        : "",
                    lane: ch.lanes && ch.lanes.length > 0 ? ch.lanes : ["Unknown"],
                    role: champBase ? champBase.tags : ["Unknown"],
                };
            });
            await writeJson(STORAGE.CHAMPION_RATING, ratingData, true);
            await writeJson(STORAGE.RATES_SUMMARY, ratingData, true);

            // CHAMPION_DRAFTING — matchups
            const draftData = globalRanking.map((ch) => ({
                id: ch.championId,
                name: ch.championName,
                drafting: ch.drafting,
            }));
            await writeJson(STORAGE.CHAMPION_DRAFTING, draftData, true);

            Logger.success(
                `Champion data updated! Total unique matches analyzed: ${totalRanked}`
            );
        } else {
            Logger.warn("No data found in database to aggregate.");
        }
    }
}

module.exports = GlobalAggregator;
