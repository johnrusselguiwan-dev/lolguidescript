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
        const total = this.processChunk(stats, 0, matches, timelines, assets);
        return this.finalize(stats, total, assets);
    }

    static initStats() {
        return {};
    }

    static processChunk(stats, currentTotal, matches, timelines, assets) {
        let total = currentTotal;
        for (const m of matches) {
            if (!m?.info?.queueId || !API.QUEUE_IDS.includes(m.info.queueId)) continue;
            total++;

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
                    };
                }

                const s = stats[hero];
                s.games++;
                if (p.win) s.wins++;
                s.kda += (p.kills + p.assists) / Math.max(1, p.deaths);

                // Lane tracking
                if (p.teamPosition && p.teamPosition !== "INVALID" && p.teamPosition !== "") {
                    s.lanes[p.teamPosition] = (s.lanes[p.teamPosition] || 0) + 1;
                }

                // Counters & synergies
                m.info.participants.forEach((other) => {
                    if (other.participantId === p.participantId) return;
                    let otherHero = assets.champMap[other.championId] || other.championName;

                    const map = other.teamId === p.teamId ? s.synergies : s.counters;
                    if (!map[otherHero]) map[otherHero] = { games: 0, wins: 0 };
                    map[otherHero].games++;
                    if (p.win) map[otherHero].wins++;
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

                [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].forEach((id) => {
                    let normalizedId = id ? String(id) : null;
                    if (normalizedId && BOOT_DOWNGRADE_MAP[normalizedId]) {
                        normalizedId = BOOT_DOWNGRADE_MAP[normalizedId];
                    }
                    if (normalizedId && assets.itemData[normalizedId] && this.isCompletedItem(assets.itemData[normalizedId])) {
                        s.items[normalizedId] = (s.items[normalizedId] || 0) + 1;
                    }
                });

                // Summoner spells
                const combo = [assets.spellMap[p.summoner1Id], assets.spellMap[p.summoner2Id]]
                    .sort()
                    .join(" + ");
                s.spells[combo] = (s.spells[combo] || 0) + 1;

                // Runes
                const runeStr = this.parseRunes(p.perks, assets);
                if (runeStr) s.runes[runeStr] = (s.runes[runeStr] || 0) + 1;

                // Skill order
                const tl = timelines[m.metadata.matchId];
                if (tl) {
                    const seq = this.parseSkills(tl, p.participantId);
                    if (seq) s.skills[seq] = (s.skills[seq] || 0) + 1;
                }
            }

            // Ban tracking
            (m.info.teams || []).forEach((t) => {
                (t.bans || []).forEach((ban) => {
                    const n = assets.champMap[ban.championId];
                    if (n && stats[n]) stats[n].bans++;
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

    static parseSkills(timeline, pid) {
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
        const getTop = (obj) =>
            Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

        // Resolve DDragon key (e.g. "MonkeyKing") to display name (e.g. "Wukong")
        const resolveName = (ddKey) => assets.champData[ddKey]?.name || ddKey;

        return Object.entries(stats)
            .map(([hero, s]) => {
                const winRate = (s.wins / s.games) * 100;
                const pickRate = totalGames ? (s.games / totalGames) * 100 : 0;
                const banRate = totalGames ? (s.bans / totalGames) * 100 : 0;
                const score =
                    (winRate * 0.45 +
                        pickRate * 0.25 +
                        banRate * 0.15 +
                        Math.min(s.kda / s.games / 5, 1) * 0.15) *
                    (1 - Math.exp(-s.games / 3));

                const sortInteractions = (dict) =>
                    Object.entries(dict)
                        .filter((m) => m[1].games >= 2)
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
                const lanesArray = Object.entries(s.lanes)
                    .sort((a, b) => b[1] - a[1])
                    .map((l) => LANE_LABELS[l[0]] || l[0]);

                const rawItems = Object.entries(s.items).sort((a, b) => b[1] - a[1]);
                
                // Separate boots and legendary items
                const isBoots = (itemId) => Object.values(assets.itemData[itemId]?.tags || {}).includes("Boots");
                const allBoots = rawItems.filter(i => isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
                const nonBoots = rawItems.filter(i => !isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
                
                const bootsName = allBoots[0] || null;

                let nonBootsIdx = 0;
                let bootsIdx = 1;

                const makeBuild = () => {
                    const items = nonBoots.slice(nonBootsIdx, nonBootsIdx + 5);
                    nonBootsIdx += 5;
                    
                    const spareItems = [];
                    // Allow at most 1 spare boots item per build
                    if (bootsIdx < allBoots.length) {
                        spareItems.push(allBoots[bootsIdx]);
                        bootsIdx++;
                    }
                    // Fill the rest with legendary items
                    if (nonBootsIdx < nonBoots.length) {
                        spareItems.push(nonBoots[nonBootsIdx]);
                        nonBootsIdx++;
                    }
                    if (spareItems.length < 2 && nonBootsIdx < nonBoots.length) {
                        spareItems.push(nonBoots[nonBootsIdx]);
                        nonBootsIdx++;
                    }
                    return { boots: bootsName, items, spareItems };
                };

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
                    lanes: lanesArray,
                    builds: [makeBuild(), makeBuild(), makeBuild()],
                    loadout: {
                        spells: getTop(s.spells),
                        runes: getTop(s.runes),
                        skills: this.parseSkillSequence(getTop(s.skills)),
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
                };
            })
            .sort((a, b) => b.score - a.score);
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
