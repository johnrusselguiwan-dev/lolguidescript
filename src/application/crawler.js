require("dotenv").config();
const readline = require("readline");
const path = require("path");
const {
    API,
    CRAWLER,
    RANK_HIERARCHY,
    STORAGE,
    DDRAGON,
    getAllPlatforms,
    getRegionPlatforms
} = require("../../config/constants");
const RiotClient = require("../infrastructure/api/riot-client");
const AssetManager = require("./asset-manager");
const AnalyticsEngine = require("./analytics");
const GlobalAggregator = require("./aggregator");
const MatchRegistry = require("../infrastructure/database/firebase-firestore");
const ImportManager = require("./import-manager");
const Database = require("../infrastructure/database/sqlite-client");
const { uploadTierData } = require("../infrastructure/output/firebase-storage");
const { readJson, writeJson } = require("../infrastructure/utils/io");
const Logger = require("../infrastructure/utils/logger");
const sleep = require("../infrastructure/utils/sleep");
const { api: ddragonApi } = require("../infrastructure/api/ddragon");

class Crawler {
    constructor() {
        this.client = new RiotClient(process.env.RIOT_API_KEY);
        this.isPaused = false;
        this.isRestarting = false;
        this.isStopped = false;
        this.etaStr = "N/A";

        // Session tracking for ETA
        this.sessionStartTime = null;
        this.matchesFetchedInSession = 0;
        this.totalTargetInSession = 0;

        // Current patch (fetched at start)
        this.currentPatch = null;

        // Region selection — null means "all regions"
        this.selectedRegion = null;

        this.shortcutsEnabled = false;
        this.setupKeyboardListener();
    }

    stop() {
        this.isStopped = true;
        Logger.info("Crawler graceful stop requested...");
    }

    /**
     * Get the platform list based on selected region.
     * Returns [{ platform, matchRegion, regionName }]
     */
    getActivePlatforms() {
        if (this.selectedRegion && this.selectedRegion !== "all") {
            return getRegionPlatforms(this.selectedRegion);
        }
        return getAllPlatforms();
    }

    setupKeyboardListener() {
        if (process.stdin.isTTY) {
            readline.emitKeypressEvents(process.stdin);
            process.stdin.on("keypress", (str, key) => {
                if (!this.shortcutsEnabled) return;

                if (key.ctrl && key.name === "c") process.exit();
                if (key.name === "p") {
                    this.isPaused = !this.isPaused;
                    Logger.info(this.isPaused ? "Crawl PAUSED. Press 'P' to resume." : "Crawl RESUMED.");
                }
                if (key.name === "r") {
                    Logger.warn("Restarting crawl session...");
                    this.isRestarting = true;
                }
                if (key.name === "q") {
                    Logger.info("Safely exiting... Bye!");
                    process.exit(0);
                }
            });
        }
    }

    enableShortcuts() {
        this.shortcutsEnabled = true;
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume(); // Ensure stream is flowing
        }
    }

    disableShortcuts() {
        this.shortcutsEnabled = false;
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    }

    /**
     * Interactive CLI start — prompts user for crawl mode, region, and rank range.
     */
    async start() {
        await Database.connect();

        let rankStart = 0;
        let rankEnd = RANK_HIERARCHY.length;

        const mode = await this.askQuestion("Crawling Mode: [1] Solo (Full or partial ladder) or [2] Team Worker? ");

        if (mode === "1") {
            const config = await this.askSoloConfig();
            rankStart = config.startIndex;
            rankEnd = config.endIndex;
        } else if (mode === "2") {
            const config = await this.askTeamConfig();
            rankStart = config.startIndex;
            rankEnd = config.endIndex;
        } else {
            Logger.warn("Invalid choice.");
            return;
        }

        // Region selection
        await this.askRegionConfig();

        // Patch filter selection
        const patchMode = await this.askQuestion("Patch Filter: [1] Strict (Current Patch Only) or [2] Lenient (Allow Previous Patch)? ");
        const strictPatch = patchMode !== "2";

        const startText = RANK_HIERARCHY[rankStart].tier + (RANK_HIERARCHY[rankStart].division ? " " + RANK_HIERARCHY[rankStart].division : "");
        const endText = RANK_HIERARCHY[rankEnd - 1].tier + (RANK_HIERARCHY[rankEnd - 1].division ? " " + RANK_HIERARCHY[rankEnd - 1].division : "");
        const platforms = this.getActivePlatforms();
        const regionLabel = this.selectedRegion && this.selectedRegion !== "all"
            ? this.selectedRegion
            : "All Regions (Global)";

        if (!(await this.askConfirmation(
            `You are about to start a Crawl from ${startText} to ${endText}.\n` +
            `  Region: ${regionLabel}\n` +
            `  Patch Filter: ${strictPatch ? "Strict (Current Only)" : "Lenient (Current + Previous)"}\n` +
            `  Platforms: ${platforms.map(p => p.platform).join(", ")} | Queues: ${API.QUEUES.map(q => q.name).join(", ")}`
        ))) {
            Logger.info("Operation cancelled.");
            return;
        }

        await this.run(rankStart, rankEnd, strictPatch);
    }

    /**
     * Non-interactive start from the Hextech Dashboard API.
     * @param {number} rankStart — starting rank index in RANK_HIERARCHY
     * @param {number} rankEnd — ending rank index (exclusive)
     * @param {string} regionFilter — region name or "all"
     * @param {boolean} strictPatch — if true, only fetch current patch
     */
    async startFromWeb(rankStart, rankEnd, regionFilter = "all", strictPatch = true) {
        await Database.connect();
        this.selectedRegion = regionFilter;
        await this.run(rankStart, rankEnd, strictPatch);
    }

    async run(rankStart, rankEnd, strictPatch = true) {
        this.strictPatch = strictPatch;
        const platforms = this.getActivePlatforms();
        const regionLabel = this.selectedRegion && this.selectedRegion !== "all"
            ? this.selectedRegion
            : "All Regions (Global)";

        Logger.info(`Initializing crawl session (Ranks ${rankStart} to ${rankEnd - 1})...`);
        Logger.info(`Region: ${regionLabel} | Platforms: ${platforms.map(p => p.platform).join(", ")} | Queues: ${API.QUEUES.map(q => q.name).join(", ")}`);

        // Fetch current and previous patches for filtering
        try {
            const realm = await ddragonApi.getRealm(DDRAGON.REALM_URL);
            this.currentPatch = realm.v.split(".").slice(0, 2).join("."); // e.g. "16.8"
            
            const recentPatches = await ddragonApi.getRecentPatches();
            // The previous patch is the first one in the list that isn't the current patch
            this.previousPatch = recentPatches.find(p => p !== this.currentPatch) || null;
            
            Logger.info(`Current Match Patch: ${this.currentPatch} | Previous: ${this.previousPatch || 'Unknown'} | Strict Mode: ${this.strictPatch ? 'ON' : 'OFF'}`);
        } catch (e) {
            Logger.warn("Failed to fetch patch versions. Patch filtering disabled.");
            this.currentPatch = null;
            this.previousPatch = null;
        }

        // Check if patch changed since last crawl — reset state if so
        const stateDefaults = {
            rankIndex: rankStart,
            currentMatches: 0,
            lastPatch: null
        };
        const state = { ...stateDefaults, ...(await readJson(STORAGE.CRAWL_STATE, stateDefaults)) };

        if (state.lastPatch && this.currentPatch && state.lastPatch !== this.currentPatch) {
            Logger.warn(`Patch changed! ${state.lastPatch} → ${this.currentPatch}. Resetting crawl state.`);
            state.rankIndex = rankStart;
            state.currentMatches = 0;
            state.initialStoreSize = undefined;
            state.lastPatch = this.currentPatch;
            await writeJson(STORAGE.CRAWL_STATE, state);
        } else {
            state.lastPatch = this.currentPatch;
        }

        this.enableShortcuts();
        Logger.info("Keyboard shortcuts active: [P] Pause, [R] Restart, [Q] Quit");

        this.sessionStartTime = Date.now();
        this.matchesFetchedInSession = 0;
        this.totalTargetInSession = (rankEnd - rankStart) * CRAWLER.TARGET_MATCHES_PER_RANK;

        if (state.rankIndex < rankStart || state.rankIndex >= rankEnd) {
            state.rankIndex = rankStart;
            state.currentMatches = 0;
        }

        // ── Crawl loop ──────────────────────────────────────────────────
        while (state.rankIndex < rankEnd && !this.isStopped) {
            if (this.isRestarting) {
                state.rankIndex = rankStart;
                state.currentMatches = 0;
                state.initialStoreSize = undefined;
                await writeJson(STORAGE.CRAWL_STATE, state);
                this.isRestarting = false;
            }

            if (this.isPaused) {
                await sleep(1000);
                continue;
            }

            const rankDef = RANK_HIERARCHY[state.rankIndex];
            const rankStr = `${rankDef.tier} ${rankDef.division}`;
            const rankDir = path.join(STORAGE.ROOT, rankDef.tier, rankDef.division);

            // Get current progress from Database
            const currentCount = await Database.getMatchCountForRank(rankDef.tier, rankDef.division);

            if (state.initialStoreSize === undefined) {
                state.initialStoreSize = currentCount;
                state.currentMatches = 0;
            } else {
                state.currentMatches = Math.max(0, currentCount - state.initialStoreSize);
            }

            if (state.currentMatches >= CRAWLER.TARGET_MATCHES_PER_RANK) {
                Logger.success(`Target hit for ${rankStr}! Transitioning to next rank. (Aggregation deferred to end)`);
                state.rankIndex++;
                state.currentMatches = 0;
                state.initialStoreSize = undefined;
                await writeJson(STORAGE.CRAWL_STATE, state);
                continue;
            }

            // ETA calculation
            const matchesDoneInSession = ((state.rankIndex - rankStart) * CRAWLER.TARGET_MATCHES_PER_RANK) + state.currentMatches;
            const matchesRemainingInSession = Math.max(0, this.totalTargetInSession - matchesDoneInSession);

            let etaStr = "N/A";
            if (this.matchesFetchedInSession > 0) {
                const timeElapsed = Date.now() - this.sessionStartTime;
                const msPerMatch = timeElapsed / this.matchesFetchedInSession;
                const etaMs = matchesRemainingInSession * msPerMatch;

                const etaHours = Math.floor(etaMs / 3600000);
                const etaMins = Math.floor((etaMs % 3600000) / 60000);
                etaStr = `~${etaHours}h ${etaMins}m`;
            }
            this.etaStr = etaStr;

            const percent = (state.currentMatches / CRAWLER.TARGET_MATCHES_PER_RANK) * 100;
            const bar = this.getProgressBar(percent);

            Logger.info(
                `[CRAWLING ${rankStr}] Matches: ${state.currentMatches}/${CRAWLER.TARGET_MATCHES_PER_RANK} | ${bar} ${percent.toFixed(1)}% | ETA: ${etaStr}`
            );

            const targetLength = state.initialStoreSize + CRAWLER.TARGET_MATCHES_PER_RANK;

            const result = await this.runCycle(rankDef, rankDir, targetLength);
            const { newMatchIds, shouldSkipRank } = result;

            // Match dedup is handled locally via SQLite INSERT OR IGNORE.
            // Region-based work splitting ensures zero cross-worker overlap.

            if (shouldSkipRank) {
                Logger.warn(`Rank ${rankStr} seems depleted across all platforms. Skipping to next rank.`);
                state.rankIndex++;
                state.currentMatches = 0;
                state.initialStoreSize = undefined;
                await writeJson(STORAGE.CRAWL_STATE, state);
                continue;
            }

            const finalCount = await Database.getMatchCountForRank(rankDef.tier, rankDef.division);
            const added = finalCount - currentCount;
            if (added === 0) {
                Logger.warn(`No new matches added this cycle. Current total: ${finalCount}`);
            } else {
                this.matchesFetchedInSession += added;
                Logger.success(`Successfully fetched ${added} new match(es) for ${rankStr}. Total: ${finalCount}`);
            }

            await writeJson(STORAGE.CRAWL_STATE, state);

            Logger.info(`Resting for ${CRAWLER.PAUSE_MS_BETWEEN_CYCLES / 1000}s...`);
            await this.interruptibleSleep(CRAWLER.PAUSE_MS_BETWEEN_CYCLES);
        }

        await GlobalAggregator.mergeAll(true);
        this.disableShortcuts();
        Logger.success("Crawl Complete!");
    }

    /**
     * Run a single crawl cycle — iterates through platforms and queues
     * to discover players and fetch their ranked matches.
     */
    async runCycle(rankDef, rankDir, targetLength) {
        const pStatePath = path.join(rankDir, "pageState.json");
        const pStateDefaults = {
            page: 1,
            stuckCounter: 0,
            emptyPageCounter: 0,
            platformIndex: 0,
            queueIndex: 0
        };
        const pState = { ...pStateDefaults, ...(await readJson(pStatePath, pStateDefaults)) };

        const newMatchIds = [];
        let shouldSkipRank = false;
        let anyPlayersFound = false;

        // Build the active platform list based on selected region
        const allPlatforms = this.getActivePlatforms();

        try {
            // Pick current platform and queue from rotation
            const platformEntry = allPlatforms[pState.platformIndex % allPlatforms.length];
            const { platform, matchRegion, regionName } = platformEntry;
            const queue = API.QUEUES[pState.queueIndex % API.QUEUES.length];

            Logger.info(`  [${platform.toUpperCase()}] [${regionName}] [${queue.name}] Page ${pState.page}`);

            const players = await this.client.getPlayers(rankDef, pState.page, platform, queue.name);

            if (!players || players.length === 0) {
                pState.emptyPageCounter++;
                if (pState.emptyPageCounter > CRAWLER.MAX_EMPTY_PAGES_BEFORE_SKIP) {
                    // Rotate to next platform/queue combo before giving up
                    pState.queueIndex++;
                    if (pState.queueIndex % API.QUEUES.length === 0) {
                        pState.platformIndex++;
                    }
                    pState.page = 1;
                    pState.emptyPageCounter = 0;

                    // If we've cycled through all combos, skip the rank
                    const totalCombos = allPlatforms.length * API.QUEUES.length;
                    const currentCombo = (pState.platformIndex % allPlatforms.length) * API.QUEUES.length
                        + (pState.queueIndex % API.QUEUES.length);
                    if (pState.platformIndex >= allPlatforms.length) {
                        pState.platformIndex = 0;
                        pState.queueIndex = 0;
                    }
                } else {
                    pState.page++;
                }
                await writeJson(pStatePath, pState);
                return { newMatchIds, shouldSkipRank };
            }

            pState.emptyPageCounter = 0;
            anyPlayersFound = true;

            for (const player of players) {
                if (this.isPaused || this.isRestarting || this.isStopped) break;
                const fourteenDaysAgoMs = Date.now() - (14 * 24 * 60 * 60 * 1000);
                const matches = await this.client.getMatchIds(player.puuid, matchRegion, { startTime: fourteenDaysAgoMs });
                for (const mid of matches) {
                    if (this.isPaused || this.isRestarting || this.isStopped) break;

                    const seenLocallyOrCloud = await MatchRegistry.isSeen(mid);
                    if (seenLocallyOrCloud) continue;

                    const detail = await this.client.getMatchDetail(mid, matchRegion);
                    if (!detail) continue;

                    if (this.currentPatch) {
                        const matchPatch = detail.info.gameVersion.split(".").slice(0, 2).join(".");
                        const isCurrent = matchPatch === this.currentPatch;
                        const isPrevious = matchPatch === this.previousPatch;
                        
                        if (this.strictPatch && !isCurrent) {
                            Logger.info(`  ➜ Match ${mid} is from old patch ${matchPatch}. (Strict mode: ON) Stopping fetch for this player.`);
                            break;
                        } else if (!this.strictPatch && !isCurrent && !isPrevious) {
                            Logger.info(`  ➜ Match ${mid} is from obsolete patch ${matchPatch}. (Allowed: ${this.currentPatch}, ${this.previousPatch}). Stopping fetch for this player.`);
                            break;
                        }
                    }

                    if (!API.QUEUE_IDS.includes(detail.info.queueId)) continue;

                    const timeline = await this.client.getMatchTimeline(mid, matchRegion);
                    if (!timeline) continue;

                    // SAVE TO SQL
                    detail.tier = rankDef.tier;
                    detail.division = rankDef.division;
                    const saved = await Database.saveMatch(detail, timeline, true, regionName);

                    if (saved) {
                        newMatchIds.push(mid);
                        const currentTotal = await Database.getMatchCountForRank(rankDef.tier, rankDef.division);
                        if (currentTotal >= targetLength) break;
                    }
                }
                const currentTotal = await Database.getMatchCountForRank(rankDef.tier, rankDef.division);
                if (currentTotal >= targetLength) break;
            }

            pState.page++;

            if (pState.page % 3 === 0) {
                pState.queueIndex++;
                if (pState.queueIndex % API.QUEUES.length === 0) {
                    pState.platformIndex++;
                    if (pState.platformIndex >= allPlatforms.length) {
                        pState.platformIndex = 0;
                    }
                }
            }

            if (newMatchIds.length === 0) {
                pState.stuckCounter++;
                if (pState.stuckCounter >= 3) shouldSkipRank = true;
            } else {
                pState.stuckCounter = 0;
            }

            if (pState.page > 50) {
                pState.page = 1;
                pState.queueIndex++;
                if (pState.queueIndex % API.QUEUES.length === 0) {
                    pState.platformIndex++;
                    if (pState.platformIndex >= allPlatforms.length) {
                        shouldSkipRank = true;
                        pState.platformIndex = 0;
                        pState.queueIndex = 0;
                    }
                }
            }

            await writeJson(pStatePath, pState);

        } catch (e) {
            Logger.error("Cycle failed: " + e.message);
        }

        return { newMatchIds, shouldSkipRank };
    }

    /**
     * Prompt user to select which region(s) to crawl.
     */
    async askRegionConfig() {
        console.log("\n  --- Region Selection ---");
        console.log("  [0] All Regions (Global)");
        API.REGIONS.forEach((r, i) => {
            console.log(`  [${i + 1}] ${r.name} (${r.platforms.join(", ")})`);
        });

        const choice = await this.askQuestion("Select region (0 for all): ");
        const idx = parseInt(choice);

        if (idx === 0 || isNaN(idx)) {
            this.selectedRegion = "all";
            Logger.info("Region: All Regions (Global)");
        } else if (idx >= 1 && idx <= API.REGIONS.length) {
            this.selectedRegion = API.REGIONS[idx - 1].name;
            Logger.info(`Region: ${this.selectedRegion}`);
        } else {
            Logger.warn("Invalid region. Defaulting to All Regions.");
            this.selectedRegion = "all";
        }
    }

    async askSoloConfig() {
        while (true) {
            const scope = await new Promise((resolve) => {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                console.log("\n  --- Solo Crawl Configuration ---");
                console.log("  [1] Full Ladder (Iron to Challenger)");
                console.log("  [2] Specific Tier (e.g. Bronze only)");
                console.log("  [3] Specific Division (e.g. Platinum I only)");
                rl.question("\n  ▸ Select scope: ", (s) => { rl.close(); resolve(s.trim()); });
            });

            if (scope === "1") return { startIndex: 0, endIndex: RANK_HIERARCHY.length };

            if (scope === "2") {
                const tiers = [...new Set(RANK_HIERARCHY.map(r => r.tier))];
                tiers.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
                const tIdxStr = await this.askQuestion("Select Tier: ");
                const tIdx = parseInt(tIdxStr);
                if (!isNaN(tIdx) && tIdx >= 1 && tIdx <= tiers.length) {
                    const tier = tiers[tIdx - 1];
                    const filtered = RANK_HIERARCHY.filter(r => r.tier === tier);
                    return { startIndex: RANK_HIERARCHY.indexOf(filtered[0]), endIndex: RANK_HIERARCHY.indexOf(filtered[filtered.length - 1]) + 1 };
                }
            } else if (scope === "3") {
                RANK_HIERARCHY.forEach((r, i) => console.log(`  [${i + 1}] ${r.tier} ${r.division}`));
                const rIdxStr = await this.askQuestion("Select Rank: ");
                const rIdx = parseInt(rIdxStr);
                if (!isNaN(rIdx) && rIdx >= 1 && rIdx <= RANK_HIERARCHY.length) {
                    const idx = rIdx - 1;
                    return { startIndex: idx, endIndex: idx + 1 };
                }
            }
            Logger.warn("Invalid selection. Please try again.");
        }
    }

    async askTeamConfig() {
        const total = await this.askQuestion("Total laptops in the team? ");
        const id = await this.askQuestion("Worker ID for this machine (1, 2, ...)? ");
        const count = parseInt(total);
        const worker = parseInt(id) - 1;
        const perWorker = Math.ceil(RANK_HIERARCHY.length / count);
        return { startIndex: worker * perWorker, endIndex: Math.min((worker + 1) * perWorker, RANK_HIERARCHY.length) };
    }

    askQuestion(q) {
        return new Promise((res) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question(`  ▸ ${q}`, (ans) => { rl.close(); res(ans.trim()); });
        });
    }

    async askConfirmation(q) {
        const ans = await this.askQuestion(`${q}\n  ▸ Are you sure? (y/N): `);
        return ans.toLowerCase() === "y";
    }

    getProgressBar(percent) {
        const size = 20;
        const filled = Math.round((size * percent) / 100);
        return "[" + "█".repeat(filled) + "░".repeat(size - filled) + "]";
    }

    async interruptibleSleep(ms) {
        const start = Date.now();
        while (Date.now() - start < ms) {
            if (this.isStopped) break;
            if (this.isPaused) { await sleep(500); continue; }
            await sleep(500);
        }
    }
}

if (require.main === module) {
    new Crawler().start().catch((err) => Logger.error("Fatal Error: " + err.stack));
}

module.exports = Crawler;
