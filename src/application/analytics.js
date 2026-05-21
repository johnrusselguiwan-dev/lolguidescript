/**
 * Analytics engine — processes raw match + timeline data into per-champion
 * statistics: win/pick/ban rates, builds, runes, skill orders, counters,
 * synergies, and a composite tier score.
 *
 * All methods are static — no instance state required.
 */

const { API } = require("../../config/constants");

class AnalyticsEngine {
    /**
     * Main entry point. Analyses an array of match objects against their
     * timelines and asset lookup maps.
     *
     * @param {Array}  matches   — Riot match-v5 response objects
     * @param {Object} timelines — { matchId: timelineObject }
     * @param {Object} assets    — lookup maps from AssetManager.getAssets()
     * @returns {Array} sorted champion stat objects (highest score first)
     */
    static analyze(matches, timelines, assets) {
        const stats = this.initStats();
        // Fallback for direct analyze calls without patch context
        const total = this.processChunk(stats, 0, matches, timelines, assets, null);
        return this.finalize(stats, total, assets);
    }

    static initStats() {
        return { _meta: { weightedGames: 0 } };
    }

    static processChunk(stats, currentTotal, matches, timelines, assets, activePatch) {
        let total = currentTotal;
        for (const m of matches) {
            if (!m?.info?.queueId || !API.QUEUE_IDS.includes(m.info.queueId)) continue;
            total++;

            const matchPatch = m.info.gameVersion ? m.info.gameVersion.split(".").slice(0, 2).join(".") : null;
            // If activePatch is provided and it matches, give full 1.0 weight, else 0.5 (or if doing generic all-patch, 1.0)
            const weight = (!activePatch || matchPatch === activePatch) ? 1.0 : 0.5;

            stats._meta.weightedGames += weight;

            for (const p of m.info.participants) {
                let hero = assets.champMap[p.championId] || p.championName;
                if (!hero) continue;

                if (!stats[hero]) {
                    stats[hero] = {
                        id: p.championId,
                        games: 0,
                        wins: 0,
                        bans: 0,
                        kda: 0,
                        items: {},
                        runes: {},
                        spells: {},
                        skills: {},
                        counters: {},
                        synergies: {},
                        lanes: {},
                        laneStats: {},
                        scaling: {
                            "15": { games: 0, wins: 0, count: 0 },
                            "20": { games: 0, wins: 0, count: 0 },
                            "25": { games: 0, wins: 0, count: 0 },
                            "30": { games: 0, wins: 0, count: 0 },
                            "35": { games: 0, wins: 0, count: 0 },
                            "40": { games: 0, wins: 0, count: 0 }
                        },
                    };
                }

                const s = stats[hero];
                s.games += weight;
                if (p.win) s.wins += weight;
                s.kda += ((p.kills + p.assists) / Math.max(1, p.deaths)) * weight;

                // Lane tracking
                if (p.teamPosition && p.teamPosition !== "INVALID" && p.teamPosition !== "") {
                    s.lanes[p.teamPosition] = (s.lanes[p.teamPosition] || 0) + weight;
                }

                // Scaling tracking (All ranked queues)
                const durationInSecs = m.info.gameDuration;
                let bucket = 40;
                if (durationInSecs < 1050) bucket = 15;
                else if (durationInSecs < 1350) bucket = 20;
                else if (durationInSecs < 1650) bucket = 25;
                else if (durationInSecs < 1950) bucket = 30;
                else if (durationInSecs < 2250) bucket = 35;

                s.scaling[bucket].games += weight;
                s.scaling[bucket].count += 1;
                if (p.win) s.scaling[bucket].wins += weight;

                // Counters & synergies
                m.info.participants.forEach((other) => {
                    if (other.participantId === p.participantId) return;
                    let otherHero = assets.champMap[other.championId] || other.championName;

                    const map = other.teamId === p.teamId ? s.synergies : s.counters;
                    if (!map[otherHero]) map[otherHero] = { games: 0, wins: 0 };
                    map[otherHero].games += weight;
                    if (p.win) map[otherHero].wins += weight;
                });

                // Build items (completed only)
                const BOOT_DOWNGRADE_MAP = {
                    "3013": "3010", // Synchronized Souls -> Symbiotic Soles
                    "3170": "3009", // Swiftmarch -> Boots of Swiftness
                    "3171": "3158", // Crimson Lucidity -> Ionian Boots of Lucidity
                    "3172": "3006", // Gunmetal Greaves -> Berserker's Greaves
                    "3173": "3111", // Chainlaced Crushers -> Mercury's Treads
                    "3174": "3047", // Armored Advance -> Plated Steelcaps
                    "3175": "3020"  // Spellslinger's Shoes -> Sorcerer's Shoes
                };

                const lane = (p.teamPosition && p.teamPosition !== "INVALID" && p.teamPosition !== "") ? p.teamPosition : "UNKNOWN";
                if (!s.laneStats[lane]) s.laneStats[lane] = { items: {}, games: 0 };
                s.laneStats[lane].games += weight;

                [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].forEach((id) => {
                    let normalizedId = id ? String(id) : null;
                    if (normalizedId && BOOT_DOWNGRADE_MAP[normalizedId]) {
                        normalizedId = BOOT_DOWNGRADE_MAP[normalizedId];
                    }
                    if (normalizedId && assets.itemData[normalizedId] && this.isCompletedItem(assets.itemData[normalizedId])) {
                        s.items[normalizedId] = (s.items[normalizedId] || 0) + weight;
                        s.laneStats[lane].items[normalizedId] = (s.laneStats[lane].items[normalizedId] || 0) + weight;
                    }
                });

                // Summoner spells
                const combo = [assets.spellMap[p.summoner1Id], assets.spellMap[p.summoner2Id]]
                    .sort()
                    .join(" + ");
                s.spells[combo] = (s.spells[combo] || 0) + weight;

                // Runes
                const runeStr = this.parseRunes(p.perks, assets);
                if (runeStr) s.runes[runeStr] = (s.runes[runeStr] || 0) + weight;

                // Skill order
                const tl = timelines[m.metadata.matchId];
                if (tl) {
                    const seq = this.parseSkills(tl, p.participantId, p.championId);
                    if (seq) s.skills[seq] = (s.skills[seq] || 0) + weight;
                }
            }

            // Ban tracking
            (m.info.teams || []).forEach((t) => {
                (t.bans || []).forEach((ban) => {
                    const n = assets.champMap[ban.championId];
                    if (n && stats[n]) stats[n].bans += weight;
                });
            });
        }
        return total;
    }

    static finalize(stats, totalRanked, assets) {
        return this.format(stats, totalRanked, assets);
    }


    // ── Helpers ─────────────────────────────────────────────────────────

    static isCompletedItem(item) {
        if (!item || !item.gold) return false;
        if (item.gold.total < 800) return false;
        if ((item.name || "").toLowerCase().includes("potion")) return false;
        
        // Exclude items that build into something else, EXCEPT for Tier 2 Boots
        // which now build into Tier 3 Boots but are the actual completed boots.
        const isBoots = item.tags && item.tags.includes("Boots");
        if (item.into && item.into.length > 0 && !isBoots) return false;
        
        return true;
    }

    static parseSkills(timeline, pid, championId) {
        if (championId === 523) return null; // Aphelios doesn't level skills normally
        const s = [];
        const m = { 1: "Q", 2: "W", 3: "E", 4: "R" };
        timeline.info.frames.forEach((f) =>
            f.events.forEach((e) => {
                if (e.type === "SKILL_LEVEL_UP" && e.participantId === pid) {
                    s.push(m[e.skillSlot] || "?");
                }
            })
        );
        return s.length > 0 ? s.slice(0, 18).join("->") : null;
    }

    static parseRunes(perks, assets) {
        if (!perks?.styles || !perks?.statPerks) return null;
        const p = perks.styles.find((s) => s.description === "primaryStyle");
        const sub = perks.styles.find((s) => s.description === "subStyle");
        if (!p || !sub) return null;

        const pRunes = p.selections.map((r) => assets.perkMap[r.perk] || r.perk).join(", ");
        const sRunes = sub.selections.map((r) => assets.perkMap[r.perk] || r.perk).join(", ");

        const shardMap = {
            5001: "Health Scaling",
            5002: "Armor",
            5003: "Magic Resist",
            5005: "Attack Speed",
            5007: "Ability Haste",
            5008: "Adaptive Force",
            5010: "Movement Speed",
            5011: "Flat Health",
            5013: "Tenacity",
        };

        const shards = [
            shardMap[perks.statPerks.offense] || perks.statPerks.offense,
            shardMap[perks.statPerks.flex] || perks.statPerks.flex,
            shardMap[perks.statPerks.defense] || perks.statPerks.defense,
        ].join(", ");

        return `${assets.styleMap[p.style]} (${pRunes}) | ${assets.styleMap[sub.style]} (${sRunes}) | Shards: [${shards}]`;
    }

    static format(stats, totalGames, assets) {
        const weightedTotalGames = stats._meta?.weightedGames || totalGames;
        delete stats._meta;

        const getTop = (obj) =>
            Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

        // Resolve DDragon key (e.g. "MonkeyKing") to display name (e.g. "Wukong")
        const resolveName = (ddKey) => assets.champData[ddKey]?.name || ddKey;

        return Object.entries(stats)
            .map(([hero, s]) => {
                const winRate = s.games ? (s.wins / s.games) * 100 : 0;
                const pickRate = weightedTotalGames ? (s.games / weightedTotalGames) * 100 : 0;
                const banRate = weightedTotalGames ? (s.bans / weightedTotalGames) * 100 : 0;
                const score =
                    (winRate * 0.45 +
                        pickRate * 0.25 +
                        banRate * 0.15 +
                        Math.min(s.kda / Math.max(s.games, 1) / 5, 1) * 0.15) *
                    (1 - Math.exp(-s.games / 3));

                const sortInteractions = (dict) =>
                    Object.entries(dict)
                        .filter((m) => m[1].games >= 20) // Raised from 2 to 20 to filter out 100% statistical flukes
                        .sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games);

                const counters = sortInteractions(s.counters);
                const syn = sortInteractions(s.synergies);

                const LANE_LABELS = {
                    TOP: "Top Lane",
                    JUNGLE: "Jungle",
                    MIDDLE: "Mid Lane",
                    BOTTOM: "Bottom Lane",
                    UTILITY: "Support",
                };
                const lanesKeys = Object.entries(s.lanes)
                    .sort((a, b) => b[1] - a[1])
                    .map((l) => l[0]);
                const lanesArray = lanesKeys.map(l => LANE_LABELS[l] || l);
                
                const primaryLane = lanesKeys[0] || "UNKNOWN";
                
                let secondaryLane = null;
                if (lanesKeys.length > 1) {
                    const secondaryLaneCount = s.lanes[lanesKeys[1]];
                    if (secondaryLaneCount / Math.max(s.games, 1) > 0.10) {
                        secondaryLane = lanesKeys[1];
                    }
                }

                const createBuildFromItems = (itemDict, variation = 0) => {
                    const rawItems = Object.entries(itemDict || {}).sort((a, b) => b[1] - a[1]);
                    const isBoots = (itemId) => Object.values(assets.itemData[itemId]?.tags || {}).includes("Boots");
                    const allBoots = rawItems.filter(i => isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
                    const nonBoots = rawItems.filter(i => !isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
                    
                    let bootsName = allBoots[0] || null;
                    let items = [];
                    let spareItems = [];

                    if (variation === 0) {
                        items = nonBoots.slice(0, 5);
                        spareItems = nonBoots.slice(5, 7);
                        if (allBoots[1]) spareItems.push(allBoots[1]);
                    } else if (variation === 1) {
                        bootsName = allBoots[1] || allBoots[0] || null;
                        items = [nonBoots[0], nonBoots[1], nonBoots[2], nonBoots[5] || nonBoots[3], nonBoots[6] || nonBoots[4]].filter(Boolean);
                        spareItems = nonBoots.filter(i => !items.includes(i)).slice(0, 2);
                        if (allBoots[0] && allBoots[0] !== bootsName) spareItems.push(allBoots[0]);
                    } else {
                        bootsName = allBoots[0] || null;
                        items = [nonBoots[0], nonBoots[3], nonBoots[4], nonBoots[7] || nonBoots[5], nonBoots[8] || nonBoots[6]].filter(Boolean);
                        spareItems = nonBoots.filter(i => !items.includes(i)).slice(0, 2);
                        if (allBoots[1]) spareItems.push(allBoots[1]);
                    }

                    while (items.length < 5 && spareItems.length > 0) {
                        items.push(spareItems.shift());
                    }

                    return { boots: bootsName, items, spareItems };
                };

                const build1 = createBuildFromItems(s.laneStats[primaryLane]?.items || s.items, 0);
                const build2 = secondaryLane 
                    ? createBuildFromItems(s.laneStats[secondaryLane]?.items, 0)
                    : createBuildFromItems(s.laneStats[primaryLane]?.items || s.items, 1);
                const build3 = secondaryLane
                    ? createBuildFromItems(s.laneStats[primaryLane]?.items || s.items, 1)
                    : createBuildFromItems(s.laneStats[primaryLane]?.items || s.items, 2);

                const cKey = String(s.id); // Get the numerical key like "266" for Aatrox
                const playstyle = (assets.playstyles && assets.playstyles[cKey]) ? assets.playstyles[cKey] : {};

                return {
                    id: hero,
                    championId: s.id,
                    name: resolveName(hero),
                    championName: hero,
                    championDisplayName: resolveName(hero),
                    score: +score.toFixed(4),
                    winRate: +winRate.toFixed(2),
                    pickRate: +pickRate.toFixed(2),
                    banRate: +banRate.toFixed(2),
                    games: s.games,
                    playstyleDamage: playstyle.damage !== undefined ? playstyle.damage : 2,
                    playstyleDurability: playstyle.durability !== undefined ? playstyle.durability : 2,
                    playstyleCrowdControl: playstyle.crowdControl !== undefined ? playstyle.crowdControl : 1,
                    playstyleMobility: playstyle.mobility !== undefined ? playstyle.mobility : 1,
                    playstyleUtility: playstyle.utility !== undefined ? playstyle.utility : 1,
                    lanes: lanesArray,
                    builds: [build1, build2, build3],
                    loadout: {
                        spells: getTop(s.spells),
                        runes: getTop(s.runes),
                        skills: this.parseSkillSequence(this.getConsensusSkillSequence(s.skills)),
                    },
                    drafting: {
                        strongAgainst: Object.fromEntries(
                            counters
                                .filter((m) => m[1].wins / m[1].games >= 0.5)
                                .map((m) => [m[0], +((m[1].wins / m[1].games) * 100).toFixed(1)])
                        ),
                        weakAgainst: Object.fromEntries(
                            [...counters]
                                .reverse()
                                .filter((m) => m[1].wins / m[1].games < 0.5)
                                .map((m) => [m[0], +(((m[1].games - m[1].wins) / m[1].games) * 100).toFixed(1)])
                        ),
                        synergizesWith: Object.fromEntries(
                            syn
                                .filter((m) => m[1].wins / m[1].games >= 0.5)
                                .map((m) => [m[0], +((m[1].wins / m[1].games) * 100).toFixed(1)])
                        ),
                    },
                    scalingData: Object.entries(s.scaling)
                        .filter(([_, data]) => data.count >= 5) // Reduced from 100 to 5 to show data on smaller crawls
                        .map(([minutes, data]) => ({
                            minute: parseInt(minutes, 10),
                            winRate: +((data.wins / data.games) * 100).toFixed(1)
                        }))
                };
            })
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Builds a consensus skill sequence by finding the most frequent skill chosen at each level.
     * This prevents truncated skill sequences caused by games ending at different levels.
     */
    static getConsensusSkillSequence(skillsMap) {
        let levelCounts = Array.from({ length: 18 }, () => ({ Q: 0, W: 0, E: 0, R: 0 }));
        let totalGamesAtLevel = Array.from({ length: 18 }, () => 0);
        
        for (const [seqStr, weight] of Object.entries(skillsMap)) {
            if (!seqStr || seqStr === "N/A") continue;
            const skills = seqStr.split('->');
            for (let i = 0; i < skills.length; i++) {
                if (i >= 18) break;
                const sk = skills[i];
                if (levelCounts[i][sk] !== undefined) {
                    levelCounts[i][sk] += weight;
                    totalGamesAtLevel[i] += weight;
                }
            }
        }
        
        const consensus = [];
        for (let i = 0; i < 18; i++) {
            if (totalGamesAtLevel[i] === 0) break;
            
            let maxSkill = '?';
            let maxWeight = -1;
            for (const [sk, weight] of Object.entries(levelCounts[i])) {
                if (weight > maxWeight) {
                    maxWeight = weight;
                    maxSkill = sk;
                }
            }
            consensus.push(maxSkill);
        }
        
        return consensus.length > 0 ? consensus.join('->') : "N/A";
    }

    /**
     * Converts a skill string like "Q->E->W->Q->Q->R->..." into
     * a level-to-index map: { "1": 0, "2": 2, "3": 1, ... }
     * where Q=0, W=1, E=2, R=3
     */
    static parseSkillSequence(skillStr) {
        if (!skillStr || skillStr === "N/A") return {};
        const indexMap = { "Q": 0, "W": 1, "E": 2, "R": 3 };
        const sequence = {};
        skillStr.split("->").forEach((skill, i) => {
            sequence[String(i + 1)] = indexMap[skill] ?? -1;
        });
        return sequence;
    }
}

module.exports = AnalyticsEngine;
