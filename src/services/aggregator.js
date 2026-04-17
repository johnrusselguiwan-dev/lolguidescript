/**
 * Global aggregator — merges match data from all rank directories,
 * runs the analytics engine, and writes the combined summaries.
 */

const path = require("path");
const { STORAGE, RANK_HIERARCHY } = require("../../config/constants");
const { readJson, writeJson } = require("../utils/io");
const Logger = require("../utils/logger");
const AnalyticsEngine = require("./analytics");
const AssetManager = require("./asset-manager");

class GlobalAggregator {
    static async mergeAll() {
        Logger.info("Running Global Aggregation...");
        const stats = AnalyticsEngine.initStats();
        let totalRanked = 0;
        const assets = await AssetManager.getAssets();

        for (const rank of RANK_HIERARCHY) {
            const rankDir = path.join(STORAGE.ROOT, rank.tier, rank.division);
            const store = await readJson(path.join(rankDir, "matchStore.json"), []);
            const tl = await readJson(path.join(rankDir, "timelines.json"), {});

            if (store.length > 0) {
                totalRanked = AnalyticsEngine.processChunk(stats, totalRanked, store, tl, assets);
            }
        }

        if (totalRanked > 0) {
            const globalRanking = AnalyticsEngine.finalize(stats, totalRanked, assets);

            // CHAMPION_META — full champion data with trimmed drafting (top 10)
            const metaData = globalRanking.map((ch) => ({
                ...ch,
                drafting: {
                    strongAgainst: (ch.drafting.strongAgainst || []).slice(0, 10),
                    weakAgainst: (ch.drafting.weakAgainst || []).slice(0, 10),
                    synergizesWith: (ch.drafting.synergizesWith || []).slice(0, 10),
                },
            }));
            await writeJson(STORAGE.CHAMPION_META, metaData);

            // CHAMPION_RATING — slim rates for tier list / ranking screens
            const ratingData = globalRanking.map((ch) => {
                const champBase = assets.champData[ch.championName];
                return {
                    id: ch.championId,
                    name: champBase ? champBase.name : ch.championName,
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
            await writeJson(STORAGE.CHAMPION_RATING, ratingData);

            // CHAMPION_DRAFTING — full untrimmed matchup data for draft master
            const draftData = globalRanking.map((ch) => ({
                id: ch.championId,
                name: ch.championName,
                drafting: ch.drafting,
            }));
            await writeJson(STORAGE.CHAMPION_DRAFTING, draftData);

            Logger.success(
                `Champion data updated! Total unique matches analyzed: ${totalRanked}`
            );
        }
    }
}

module.exports = GlobalAggregator;
