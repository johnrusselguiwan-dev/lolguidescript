/**
 * Autonomous Tier Crawler — crawls the Riot API ranked ladder,
 * collects match data per rank, and runs analytics.
 *
 * Usage:
 *   node scripts/crawl.js              # Interactive menu
 *   npm run crawl                      # Same, via npm
 *
 * Runtime controls (while crawling):
 *   [P] / [Space] — Pause / Resume
 *   [R]           — Restart from Iron IV
 *   [Q] / Ctrl+C  — Quit safely
 */

require("dotenv/config");

const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");
const { stdin: input } = require("process");

const { API, CRAWLER, STORAGE, RANK_HIERARCHY } = require("../config/constants");
const RiotClient = require("../src/api/riot-client");
const AssetManager = require("../src/services/asset-manager");
const AnalyticsEngine = require("../src/services/analytics");
const GlobalAggregator = require("../src/services/aggregator");
const MatchRegistry = require("../src/services/match-registry");
const { uploadTierData } = require("../src/output/firebase");
const { readJson, writeJson } = require("../src/utils/io");
const Logger = require("../src/utils/logger");
const sleep = require("../src/utils/sleep");

// ─────────────────────────────────────────────────────────────────────────────

class Crawler {
    constructor() {
        this.client = new RiotClient(process.env.RIOT_API_KEY);
        this.isPaused = false;
        this.isRestarting = false;
        this.isQuitting = false;
    }

    // ── CLI key bindings ────────────────────────────────────────────────

    setupCLI() {
        readline.emitKeypressEvents(input);
        if (input.isTTY) input.setRawMode(true);
        input.resume(); // Re-activate stdin after readline paused it

        input.on("keypress", (_str, key) => {
            if (!key) return;
            if ((key.ctrl && key.name === "c") || key.name === "q") {
                Logger.info("\nSafely exiting... Bye!");
                this.isQuitting = true;
                process.exit();
            }
            if (key.name === "p" || key.name === "space") {
                this.isPaused = !this.isPaused;
                if (this.isPaused) Logger.info("\n⏸  PAUSED. Press 'p' to continue.");
                else Logger.info("\n▶  RESUMED.");
            }
            if (key.name === "r") {
                Logger.warn("\n⚠ RESTARTING LADDER FROM SCRATCH...");
                this.isRestarting = true;
                this.isPaused = false;
            }
        });

        console.log("\n====================================");
        console.log("🎮 AUTONOMOUS CRAWLER CONTROLS 🎮");
        console.log("   [P] - Pause / Resume");
        console.log("   [R] - Restart from Iron IV");
        console.log("   [Q] - Quit Script");
        console.log("====================================\n");
    }

    /**
     * Interruptible sleep — checks for state changes (pause/restart/quit)
     * every 500ms so hotkeys remain responsive during long waits.
     */
    async interruptibleSleep(ms) {
        const tick = 500;
        let remaining = ms;
        while (remaining > 0) {
            if (this.isQuitting || this.isRestarting) return;
            if (this.isPaused) {
                await sleep(tick);
                continue; // don't decrement while paused
            }
            await sleep(Math.min(tick, remaining));
            remaining -= tick;
        }
    }

    // ── Progress bar ────────────────────────────────────────────────────

    getProgressBar(percent, length = 20) {
        const p = Math.max(0, Math.min(100, percent));
        const filled = Math.round((length * p) / 100);
        const empty = length - filled;
        return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
    }

    // ── Interactive menu ────────────────────────────────────────────────

    async showMainMenu() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            console.log("\n╔════════════════════════════════════════════════╗");
            console.log("║       LoL Guide  ·  Data Crawler              ║");
            console.log("╚════════════════════════════════════════════════╝");
            console.log();
            console.log("  What would you like to do?");
            console.log();
            console.log("    [1]  🔄 Solo Crawl        (all ranks, single machine)");
            console.log("    [2]  👥 Team Crawl        (split ranks across laptops)");
            console.log("    [3]  📦 Merge & Upload    (combine data + push to Firebase)");
            console.log("    [4]  📊 Upload Only       (push existing data to Firebase)");
            console.log();
            rl.question("  ▸ Enter choice (1-4): ", (ans) => {
                rl.close();
                resolve(ans.trim());
            });
        });
    }

    async askTeamConfig() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

        console.log();
        const totalStr = await ask("  How many laptops are working together?\n  ▸ Enter total laptops (e.g. 3): ");
        const workerStr = await ask("\n  Which laptop is this one?\n  ▸ Enter this laptop's number (1-" + totalStr + "): ");
        rl.close();

        const total = parseInt(totalStr, 10);
        const worker = parseInt(workerStr, 10);

        if (isNaN(total) || isNaN(worker) || total < 1 || worker < 1 || worker > total) {
            Logger.error("Invalid input. Please enter valid numbers.");
            process.exit(1);
        }

        // Calculate rank slice for this worker
        const perWorker = Math.ceil(RANK_HIERARCHY.length / total);
        const startIndex = (worker - 1) * perWorker;
        const endIndex = Math.min(worker * perWorker, RANK_HIERARCHY.length);

        const startRank = RANK_HIERARCHY[startIndex];
        const endRank = RANK_HIERARCHY[endIndex - 1];

        console.log();
        Logger.success(`This laptop will crawl: ${startRank.tier} ${startRank.division} → ${endRank.tier} ${endRank.division} (${endIndex - startIndex} ranks)`);
        console.log();

        return { startIndex, endIndex };
    }

    async askConfirmation(warningText) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            console.log();
            Logger.warn(`⚠ ${warningText}`);
            rl.question("  ▸ Are you sure you want to proceed? (y/N): ", (ans) => {
                rl.close();
                const confirm = ans.trim().toLowerCase();
                resolve(confirm === "y" || confirm === "yes");
            });
        });
    }

    // ── Main entry ──────────────────────────────────────────────────────

    async start() {
        const choice = await this.showMainMenu();

        if (choice === "1") {
            if (!(await this.askConfirmation("You are about to start a Solo Crawl on a single machine."))) {
                Logger.info("Operation cancelled.");
                process.exit(0);
            }
        } else if (choice === "3") {
            if (!(await this.askConfirmation("You are about to merge and DIRECTLY UPLOAD data to Firebase. This overwrites production data."))) {
                Logger.info("Operation cancelled.");
                process.exit(0);
            }
        } else if (choice === "4") {
            if (!(await this.askConfirmation("You are about to DIRECTLY UPLOAD existing data to Firebase. This overwrites production data."))) {
                Logger.info("Operation cancelled.");
                process.exit(0);
            }
        }

        // ── Option 3: Merge & Upload ────────────────────────────────────
        if (choice === "3") {
            Logger.info("Merging all rank data and uploading to Firebase...");
            await GlobalAggregator.mergeAll();

            const meta = await readJson(STORAGE.CHAMPION_META, []);
            const rating = await readJson(STORAGE.CHAMPION_RATING, []);
            const drafting = await readJson(STORAGE.CHAMPION_DRAFTING, []);

            if (meta.length > 0) {
                await uploadTierData(meta, rating, drafting);
                Logger.success("All data merged and uploaded to Firebase!");
            } else {
                Logger.warn("No data to upload. Run a crawl first.");
            }
            process.exit(0);
        }

        // ── Option 4: Upload Only ───────────────────────────────────────
        if (choice === "4") {
            Logger.info("Uploading existing data to Firebase...");
            const meta = await readJson(STORAGE.CHAMPION_META, []);
            const rating = await readJson(STORAGE.CHAMPION_RATING, []);
            const drafting = await readJson(STORAGE.CHAMPION_DRAFTING, []);

            if (meta.length > 0) {
                await uploadTierData(meta, rating, drafting);
                Logger.success("Data uploaded to Firebase!");
            } else {
                Logger.warn("No data found. Run a crawl and merge first.");
            }
            process.exit(0);
        }

        // ── Option 2: Team Crawl ────────────────────────────────────────
        let rankStart = 0;
        let rankEnd = RANK_HIERARCHY.length;

        if (choice === "2") {
            const config = await this.askTeamConfig();
            rankStart = config.startIndex;
            rankEnd = config.endIndex;
        }

        // ── Option 1 & 2: Start crawling ────────────────────────────────
        this.setupCLI();

        await fs.mkdir(STORAGE.ROOT, { recursive: true });
        let state = await readJson(STORAGE.CRAWL_STATE, { rankIndex: rankStart, currentMatches: 0 });

        // If resuming, clamp state to our assigned range
        if (state.rankIndex < rankStart) {
            state.rankIndex = rankStart;
            state.currentMatches = 0;
            state.initialStoreSize = undefined;
        }

        // Load seen matches from Firebase (shared across laptops)
        Logger.info("Syncing seen matches from Firebase...");
        const globalSeen = await MatchRegistry.loadSeen();
        // Also merge local seen matches
        const localSeen = await readJson(STORAGE.GLOBAL_SEEN, []);
        localSeen.forEach((id) => globalSeen.add(id));

        // ── Crawl loop ──────────────────────────────────────────────────
        const totalRanksForThisWorker = rankEnd - rankStart;

        while (state.rankIndex < rankEnd) {
            if (this.isRestarting) {
                state = { rankIndex: rankStart, currentMatches: 0, initialStoreSize: undefined };
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

            const localStore = await readJson(path.join(rankDir, "matchStore.json"), []);
            const localTL = await readJson(path.join(rankDir, "timelines.json"), {});

            if (state.initialStoreSize === undefined) {
                state.initialStoreSize = localStore.length;
                state.currentMatches = 0;
            } else {
                state.currentMatches = Math.max(0, localStore.length - state.initialStoreSize);
            }

            if (state.currentMatches >= CRAWLER.TARGET_MATCHES_PER_RANK) {
                Logger.success(`Target hit for ${rankStr}! Transitioning to next rank.`);
                state.rankIndex++;
                state.currentMatches = 0;
                state.initialStoreSize = undefined;
                await writeJson(STORAGE.CRAWL_STATE, state);
                await GlobalAggregator.mergeAll();
                continue;
            }

            // ETA calculation
            const totalTargetMatches = totalRanksForThisWorker * CRAWLER.TARGET_MATCHES_PER_RANK;
            const ranksCompleted = state.rankIndex - rankStart;
            const totalCompleted =
                ranksCompleted * CRAWLER.TARGET_MATCHES_PER_RANK + state.currentMatches;
            const matchesRemaining = totalTargetMatches - totalCompleted;
            const etaSeconds = matchesRemaining * 9.5;
            const etaHours = Math.floor(etaSeconds / 3600);
            const etaMinutes = Math.floor((etaSeconds % 3600) / 60);

            const percent = (totalCompleted / totalTargetMatches) * 100;
            const bar = this.getProgressBar(percent);

            Logger.info(
                `[CRAWLING ${rankStr}] Matches: ${state.currentMatches}/${CRAWLER.TARGET_MATCHES_PER_RANK} | ${bar} ${percent.toFixed(1)}% | ETA: ~${etaHours}h ${etaMinutes}m`
            );
            
            const targetLength = state.initialStoreSize + CRAWLER.TARGET_MATCHES_PER_RANK;
            const newMatchIds = await this.runCycle(rankDef, rankDir, localStore, localTL, globalSeen, targetLength);

            // Sync new matches to Firebase
            if (newMatchIds.length > 0) {
                await MatchRegistry.markSeen(newMatchIds);
            }

            // Check progress
            const updatedStore = await readJson(path.join(rankDir, "matchStore.json"), []);
            const newMatches = newMatchIds.length;
            if (newMatches === 0) {
                Logger.warn(`No new matches added this cycle. Current: ${updatedStore.length}`);
            } else if (newMatches > 0) {
                Logger.success(`Added ${newMatches} new match(es). Total: ${updatedStore.length}`);
            }

            await writeJson(STORAGE.CRAWL_STATE, state);
            await writeJson(STORAGE.GLOBAL_SEEN, [...globalSeen]);

            Logger.info(`Resting for ${CRAWLER.PAUSE_MS_BETWEEN_CYCLES / 1000}s... (Press P to pause, Q to quit)`);
            await this.interruptibleSleep(CRAWLER.PAUSE_MS_BETWEEN_CYCLES);
        }

        // Final aggregation
        await GlobalAggregator.mergeAll();
        Logger.success("Crawl Complete!");
    }

    // ── Single crawl cycle ──────────────────────────────────────────────

    async runCycle(rankDef, rankDir, localStore, localTL, globalSeen, targetLength) {
        const pStatePath = path.join(rankDir, "pageState.json");
        const pState = await readJson(pStatePath, { page: 1, offset: 0, stuckCounter: 0 });
        if (pState.stuckCounter === undefined) pState.stuckCounter = 0;

        this.client.used = 0;

        const queue = [];
        let matchesAddedThisCycle = 0;
        const newMatchIds = [];

        try {
            const players = await this.client.getPlayers(rankDef, pState.page);

            if (players.length === 0) {
                Logger.warn(`No players found on page ${pState.page}, advancing page...`);
                pState.page++;
                pState.offset = 0;
                pState.stuckCounter = 0;
            } else {
                for (const p of players) {
                    if (this.client.used >= API.MAX_REQUESTS_PER_CYCLE) break;

                    let puuid = p.puuid;
                    if (!puuid && p.summonerId && this.client.used < API.MAX_REQUESTS_PER_CYCLE) {
                        const sDetails = await this.client.getSummonerBySummonerId(p.summonerId);
                        puuid = sDetails?.puuid;
                    }

                    if (puuid) {
                        const ids = await this.client.getMatchIds(puuid, pState.offset);
                        ids.forEach((id) => {
                            if (!globalSeen.has(id)) queue.push(id);
                        });
                    }
                }
            }
        } catch (e) {
            if (e.message === "BLACKLISTED" || e.message === "API_KEY_INVALID") {
                const reason = e.message === "API_KEY_INVALID"
                    ? "API Key is invalid/expired"
                    : "API Key blacklisted";
                Logger.error(`FALLBACK: ${reason}. Pausing crawler — update your .env and press 'P' to resume.`);
                this.isPaused = true;
                return newMatchIds;
            }
            Logger.warn("Match discovery halted: " + e.message);
            await this.interruptibleSleep(5000);
        }

        if (this.isPaused) return newMatchIds;

        // Fetch matches from queue
        for (const id of queue) {
            if (this.client.used >= API.MAX_REQUESTS_PER_CYCLE - 1) break;
            if (localStore.length >= targetLength) break;

            try {
                Logger.log(`[REQ ${this.client.used + 1}] Fetching ${id}`);
                const detail = await this.client.getMatchDetail(id);
                const timeline = await this.client.getTimeline(id);

                localStore.push(detail);
                localTL[id] = timeline;
                globalSeen.add(id);
                newMatchIds.push(id);
                matchesAddedThisCycle++;
            } catch (e) {
                if (e.message === "BLACKLISTED" || e.message === "API_KEY_INVALID") {
                    const reason = e.message === "API_KEY_INVALID"
                        ? "API Key is invalid/expired"
                        : "API Key blacklisted";
                    Logger.error(`FALLBACK: ${reason}. Pausing. Progress is safely stored.`);
                    this.isPaused = true;
                    break;
                }
                Logger.error(`Skip Match ${id}`, e);
            }
        }

        // Advance page state
        if (matchesAddedThisCycle === 0) {
            pState.stuckCounter++;
            if (pState.stuckCounter >= 2) {
                Logger.warn(`Stuck for ${pState.stuckCounter} cycles. Advancing to next page...`);
                pState.page++;
                pState.offset = 0;
                pState.stuckCounter = 0;
            }
        } else {
            pState.stuckCounter = 0;
            pState.offset += CRAWLER.MATCHES_PER_PLAYER;
            if (pState.offset >= 20) {
                pState.offset = 0;
                pState.page++;
            }
        }

        await writeJson(pStatePath, pState);
        await writeJson(path.join(rankDir, "matchStore.json"), localStore);
        await writeJson(path.join(rankDir, "timelines.json"), localTL);

        const assets = await AssetManager.getAssets();
        const ranking = AnalyticsEngine.analyze(localStore, localTL, assets);
        await writeJson(path.join(rankDir, "ranking.json"), ranking);

        return newMatchIds;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
if (require.main === module) {
    new Crawler().start().catch((err) => Logger.error("Fatal Error", err));
}

module.exports = Crawler;

