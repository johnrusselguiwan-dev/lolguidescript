require("dotenv").config();
const readline = require("readline");
const path = require("path");
const { 
    CRAWLER, 
    RANK_HIERARCHY, 
    STORAGE 
} = require("../config/constants");
const RiotClient = require("../src/api/riot-client");
const AssetManager = require("../src/services/asset-manager");
const AnalyticsEngine = require("../src/services/analytics");
const GlobalAggregator = require("../src/services/aggregator");
const MatchRegistry = require("../src/services/match-registry");
const ImportManager = require("../src/services/import-manager");
const Database = require("../src/services/database");
const { uploadTierData } = require("../src/output/firebase");
const { readJson, writeJson } = require("../src/utils/io");
const Logger = require("../src/utils/logger");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

class Crawler {
    constructor() {
        this.client = new RiotClient(process.env.RIOT_API_KEY);
        this.isPaused = false;
        this.isRestarting = false;
        
        // Session tracking for ETA
        this.sessionStartTime = null;
        this.matchesFetchedInSession = 0;
        this.totalTargetInSession = 0;

        this.shortcutsEnabled = false;
        this.setupKeyboardListener();
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

    async start() {
        const choice = await this.askChoice();
        
        // Ensure Database is connected
        await Database.connect();

        let rankStart = 0;
        let rankEnd = RANK_HIERARCHY.length;

        if (choice === "1") {
            const config = await this.askSoloConfig();
            rankStart = config.startIndex;
            rankEnd = config.endIndex;

            const startText = RANK_HIERARCHY[rankStart].tier + (RANK_HIERARCHY[rankStart].division ? " " + RANK_HIERARCHY[rankStart].division : "");
            const endText = RANK_HIERARCHY[rankEnd - 1].tier + (RANK_HIERARCHY[rankEnd - 1].division ? " " + RANK_HIERARCHY[rankEnd - 1].division : "");
            
            if (!(await this.askConfirmation(`You are about to start a Solo Crawl from ${startText} to ${endText}.`))) {
                Logger.info("Operation cancelled.");
                process.exit(0);
            }
        } else if (choice === "2") {
            const config = await this.askTeamConfig();
            rankStart = config.startIndex;
            rankEnd = config.endIndex;
        } else if (choice === "3") {
            if (!(await this.askConfirmation("You are about to merge and aggregate all local data. This updates champions_meta.json and rates_summary.json locally."))) {
                Logger.info("Operation cancelled.");
                process.exit(0);
            }
            await GlobalAggregator.mergeAll(true); // true = auto import from bin
            process.exit(0);
        } else if (choice === "4") {
            if (!(await this.askConfirmation("You are about to scan local output files and UPLOAD them to Firebase. This overwrites cloud data."))) {
                Logger.info("Operation cancelled.");
                process.exit(0);
            }
            
            Logger.info("Reading local data for upload...");
            const meta = await readJson(STORAGE.CHAMPION_META);
            const rating = await readJson(STORAGE.CHAMPION_RATING);
            const drafting = await readJson(STORAGE.CHAMPION_DRAFTING);

            if (!meta || !rating || !drafting) {
                Logger.error("Failed to load local data. Run Choice [3] first.");
                process.exit(1);
            }

            await uploadTierData(meta, rating, drafting);
            process.exit(0);
        } else if (choice === "5") {
            await ImportManager.runImport();
            process.exit(0);
        }

        await this.run(rankStart, rankEnd);
    }

    async run(rankStart, rankEnd) {
        Logger.info(`Initializing crawl session (Ranks ${rankStart} to ${rankEnd-1})...`);
        
        this.enableShortcuts();
        Logger.info("Keyboard shortcuts active: [P] Pause, [R] Restart, [Q] Quit");
        
        this.sessionStartTime = Date.now();
        this.matchesFetchedInSession = 0;
        this.totalTargetInSession = (rankEnd - rankStart) * CRAWLER.TARGET_MATCHES_PER_RANK;

        let state = await readJson(STORAGE.CRAWL_STATE, { 
            rankIndex: rankStart, 
            currentMatches: 0 
        });

        if (state.rankIndex < rankStart || state.rankIndex >= rankEnd) {
            state.rankIndex = rankStart;
            state.currentMatches = 0;
        }

        // ── Crawl loop ──────────────────────────────────────────────────
        const totalRanksForThisWorker = rankEnd - rankStart;

        while (state.rankIndex < rankEnd) {
            if (this.isRestarting) {
                state = { rankIndex: rankStart, currentMatches: 0 };
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
                Logger.success(`Target hit for ${rankStr}! Transitioning to next rank.`);
                state.rankIndex++;
                state.currentMatches = 0;
                state.initialStoreSize = undefined;
                await writeJson(STORAGE.CRAWL_STATE, state);
                await GlobalAggregator.mergeAll(false); // don't auto-import during loop
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

            const percent = (state.currentMatches / CRAWLER.TARGET_MATCHES_PER_RANK) * 100;
            const bar = this.getProgressBar(percent);

            Logger.info(
                `[CRAWLING ${rankStr}] Matches: ${state.currentMatches}/${CRAWLER.TARGET_MATCHES_PER_RANK} | ${bar} ${percent.toFixed(1)}% | ETA: ${etaStr}`
            );
            
            const targetLength = state.initialStoreSize + CRAWLER.TARGET_MATCHES_PER_RANK;
            const { newMatchIds, shouldSkipRank } = await this.runCycle(rankDef, rankDir, targetLength);

            // Sync new matches to Firebase cloud registry
            if (newMatchIds.length > 0) {
                await MatchRegistry.markSeen(newMatchIds);
            }

            if (shouldSkipRank) {
                Logger.warn(`Rank ${rankStr} seems depleted. Skipping to next rank.`);
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
                Logger.success(`Added ${added} new match(es). Total: ${finalCount}`);
            }

            await writeJson(STORAGE.CRAWL_STATE, state);

            Logger.info(`Resting for ${CRAWLER.PAUSE_MS_BETWEEN_CYCLES / 1000}s... (Press P to pause, R to restart, Q to quit)`);
            await this.interruptibleSleep(CRAWLER.PAUSE_MS_BETWEEN_CYCLES);
        }

        await GlobalAggregator.mergeAll(true);
        this.disableShortcuts();
        Logger.success("Crawl Complete!");
    }

    async runCycle(rankDef, rankDir, targetLength) {
        this.client.used = 0;
        const pStatePath = path.join(rankDir, "pageState.json");
        const pState = await readJson(pStatePath, { page: 1, stuckCounter: 0, emptyPageCounter: 0 });

        const newMatchIds = [];
        let shouldSkipRank = false;

        try {
            const players = await this.client.getPlayers(rankDef, pState.page);

            if (!players || players.length === 0) {
                pState.emptyPageCounter++;
                if (pState.emptyPageCounter > CRAWLER.MAX_EMPTY_PAGES_BEFORE_SKIP) {
                    pState.page = 1;
                    pState.emptyPageCounter = 0;
                } else {
                    pState.page++;
                }
                await writeJson(pStatePath, pState);
                return { newMatchIds, shouldSkipRank };
            }

            pState.emptyPageCounter = 0;

            for (const player of players) {
                if (this.isPaused || this.isRestarting) break;
                
                const matches = await this.client.getMatchIds(player.puuid);
                for (const mid of matches) {
                    if (this.isPaused || this.isRestarting) break;

                    const seenLocallyOrCloud = await MatchRegistry.isSeen(mid);
                    if (seenLocallyOrCloud) continue;

                    const detail = await this.client.getMatchDetail(mid);
                    if (!detail) continue;

                    // Skip non-SoloQ matches
                    if (detail.info.queueId !== 420) continue;

                    const timeline = await this.client.getMatchTimeline(mid);
                    if (!timeline) continue;

                    // SAVE TO SQL
                    detail.tier = rankDef.tier;
                    detail.division = rankDef.division;
                    const saved = await Database.saveMatch(detail, timeline, true); // STRIPPING enabled

                    if (saved) {
                        newMatchIds.push(mid);
                        const currentTotal = await Database.getMatchCountForRank(rankDef.tier, rankDef.division);
                        if (currentTotal >= targetLength) break;
                    }
                }
                const currentTotal = await Database.getMatchCountForRank(rankDef.tier, rankDef.division);
                if (currentTotal >= targetLength) break;
            }

            // Always increment page at the end of a cycle to keep data fresh
            pState.page++;

            if (newMatchIds.length === 0) {
                pState.stuckCounter++;
                // Skip after 3 fruitless cycles (more aggressive than original 5)
                if (pState.stuckCounter >= 3) shouldSkipRank = true;
            } else {
                pState.stuckCounter = 0;
            }

            // Safety cap: Skip rank if we reach Page 50 and it's still not hit target
            if (pState.page > 50) shouldSkipRank = true;

            await writeJson(pStatePath, pState);

        } catch (e) {
            Logger.error("Cycle failed: " + e.message);
        }

        return { newMatchIds, shouldSkipRank };
    }

    async askChoice() {
        while (true) {
            const ans = await new Promise((resolve) => {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                console.log("\n╔════════════════════════════════════════════════╗");
                console.log("║       LoL Guide  ·  Data Crawler              ║");
                console.log("╚════════════════════════════════════════════════╝");
                console.log("\n  What would you like to do?\n");
                console.log("    [1]  🔄 Solo Crawl        (all ranks, single machine)");
                console.log("    [2]  👥 Team Crawl        (split ranks across laptops)");
                console.log("    [3]  📦 Merge & Aggregate (Local Only)");
                console.log("    [4]  📊 Upload Results    (Push local JSONs to Cloud)");
                console.log("    [5]  📥 Import from Bin   (Merge matches from other machines)");
                console.log();
                rl.question("  ▸ Enter choice (1-5): ", (a) => { rl.close(); resolve(a.trim()); });
            });

            if (["1","2","3","4","5"].includes(ans)) return ans;
            Logger.warn("Invalid choice. Please enter 1, 2, 3, 4, or 5.");
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
                tiers.forEach((t, i) => console.log(`  [${i+1}] ${t}`));
                const tIdxStr = await this.askQuestion("Select Tier: ");
                const tIdx = parseInt(tIdxStr);
                if (!isNaN(tIdx) && tIdx >= 1 && tIdx <= tiers.length) {
                    const tier = tiers[tIdx-1];
                    const filtered = RANK_HIERARCHY.filter(r => r.tier === tier);
                    return { startIndex: RANK_HIERARCHY.indexOf(filtered[0]), endIndex: RANK_HIERARCHY.indexOf(filtered[filtered.length-1]) + 1 };
                }
            } else if (scope === "3") {
                RANK_HIERARCHY.forEach((r, i) => console.log(`  [${i+1}] ${r.tier} ${r.division}`));
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
            if (this.isPaused) { await sleep(500); continue; }
            await sleep(500);
        }
    }
}

if (require.main === module) {
    new Crawler().start().catch((err) => Logger.error("Fatal Error: " + err.stack));
}

module.exports = Crawler;
