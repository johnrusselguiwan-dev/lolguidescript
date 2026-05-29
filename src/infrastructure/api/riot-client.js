/**
 * Riot API client — rate-limited, auto-retrying HTTP wrapper for the
 * League of Legends ranked data endpoints.
 *
 * Uses the native `fetch` API (Node 18+). A sliding-window rate limiter
 * gates every request BEFORE it is sent, ensuring Riot's limits are
 * never exceeded. Emergency 429 back-off is kept as a safety net.
 */

const { API, CRAWLER, getAllPlatforms } = require("../../../config/constants");
const Logger = require("../utils/logger");
const sleep = require("../utils/sleep");

// ── Sliding Window Rate Limiter ────────────────────────────────────────────
// Tracks request timestamps in two sliding windows matching Riot's dev-key
// limits (20 req/1s and 100 req/2min). Blocks BEFORE sending if a window
// is near capacity. This prevents 429s entirely under normal operation.

class SlidingWindowLimiter {
    constructor() {
        // Riot Development Key limits:
        //   - 20 requests per 1 second
        //   - 100 requests per 2 minutes (120 seconds)
        this.windows = [
            { maxRequests: 20, intervalMs: 1000, safeMax: 18, timestamps: [], label: "1s" },
            { maxRequests: 100, intervalMs: 120000, safeMax: 90, timestamps: [], label: "2min" },
        ];
    }

    /**
     * Block until a request slot is available in ALL windows.
     * Call this BEFORE every API request.
     */
    async waitForSlot() {
        while (true) {
            const now = Date.now();
            let allClear = true;
            let longestWait = 0;
            let blockingWindow = null;

            for (const w of this.windows) {
                // Purge timestamps outside the window
                w.timestamps = w.timestamps.filter(t => now - t < w.intervalMs);

                if (w.timestamps.length >= w.safeMax) {
                    allClear = false;
                    // Calculate how long until the oldest request expires from this window
                    const oldest = w.timestamps[0];
                    const waitMs = (oldest + w.intervalMs) - now + 100; // +100ms buffer
                    if (waitMs > longestWait) {
                        longestWait = waitMs;
                        blockingWindow = w;
                    }
                }
            }

            if (allClear) {
                // Record this request in all windows
                const ts = Date.now();
                for (const w of this.windows) {
                    w.timestamps.push(ts);
                }
                return;
            }

            // Wait for the blocking window to free up
            const waitSec = (longestWait / 1000).toFixed(1);
            Logger.info(`⏱ Rate limiter: ${blockingWindow.timestamps.length}/${blockingWindow.safeMax} in ${blockingWindow.label} window. Waiting ${waitSec}s...`);
            await sleep(Math.max(longestWait, 500));
        }
    }

    /**
     * Get current usage stats for logging/debugging.
     */
    getUsage() {
        const now = Date.now();
        return this.windows.map(w => {
            const active = w.timestamps.filter(t => now - t < w.intervalMs).length;
            return `${active}/${w.safeMax} (${w.label})`;
        }).join(" | ");
    }
}

class RiotClient {
    constructor(apiKey) {
        if (!apiKey) {
            Logger.error("Missing RIOT_API_KEY in .env");
            Logger.info("  ➜ Get a key at https://developer.riotgames.com/");
            Logger.info("  ➜ Add it to your .env file: RIOT_API_KEY=\"RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\"");
            Logger.info("  ➜ Note: Development keys expire every 24 hours.");
            process.exit(1);
        }
        this.apiKey = apiKey;
        this.limiter = new SlidingWindowLimiter();
        this.requestCount = 0; // lifetime counter for logging only
    }

    /**
     * Core fetch with sliding-window rate limiting, retry, and error handling.
     * @param {string} url — full API URL
     * @returns {Promise<any>} parsed JSON response
     */
    async fetch(url) {
        // Wait for a slot in all rate-limit windows BEFORE sending
        await this.limiter.waitForSlot();

        this.requestCount++;

        // Log the actual API request
        const isMatch = url.includes("/matches/");
        const label = isMatch ? url.split("/").pop() : url;
        Logger.request(this.requestCount, `Fetching ${label}`);

        for (let i = 0; i < API.RETRY_ATTEMPTS; i++) {
            try {
                const res = await fetch(url, {
                    headers: { "X-Riot-Token": this.apiKey },
                });

                if (res.status === 429) {
                    // Emergency fallback — should never happen with the sliding window,
                    // but kept as a safety net.
                    const wait = (Number(res.headers.get("Retry-After")) || 10) * 1000;
                    Logger.warn(`⚠ Emergency 429! Riot says wait ${wait}ms. This should not happen — check limiter config.`);
                    await sleep(wait);
                    continue;
                }
                if (res.status === 401) {
                    const body = await res.text().catch(() => "");
                    Logger.error("─────────────────────────────────────────────");
                    if (body.includes("Unknown apikey")) {
                        Logger.error("API Key is INVALID or has EXPIRED (401)");
                        Logger.info("  ➜ Riot development API keys expire every 24 hours.");
                        Logger.info("  ➜ Regenerate a new key at https://developer.riotgames.com/");
                    } else if (body.includes("Unauthorized")) {
                        Logger.error("API Key is UNAUTHORIZED (401)");
                        Logger.info("  ➜ Your key may not have access to this endpoint.");
                        Logger.info("  ➜ Check your app permissions at https://developer.riotgames.com/");
                    } else {
                        Logger.error(`API Key rejected (401): ${body}`);
                        Logger.info("  ➜ Try regenerating your key at https://developer.riotgames.com/");
                    }
                    Logger.info("  ➜ Update your .env file with the new RIOT_API_KEY value.");
                    Logger.error("─────────────────────────────────────────────");
                    throw new Error("API_KEY_INVALID");
                }
                if (res.status === 403) {
                    Logger.error("─────────────────────────────────────────────");
                    Logger.error("API Key BLACKLISTED or FORBIDDEN (403)");
                    Logger.info("  ➜ This usually means your key has been revoked.");
                    Logger.info("  ➜ Regenerate a new key at https://developer.riotgames.com/");
                    Logger.info("  ➜ If this persists, check your app status on the developer portal.");
                    Logger.error("─────────────────────────────────────────────");
                    throw new Error("BLACKLISTED");
                }
                if (!res.ok) {
                    let errorBody = await res.text().catch(() => "Unknown error");
                    
                    // Cleanup HTML error pages (e.g. Cloudflare 5xx)
                    if (errorBody.includes("<!DOCTYPE") || errorBody.includes("<html")) {
                        errorBody = `[HTML Error Page] ${res.statusText || ""}`;
                    }

                    // Truncate overly long error messages
                    if (errorBody.length > 200) {
                        errorBody = errorBody.substring(0, 200) + "...";
                    }

                    throw new Error(`HTTP ${res.status}: ${errorBody}`);
                }

                return await res.json();
            } catch (err) {
                if (err.message === "API_KEY_INVALID" || err.message === "BLACKLISTED") throw err;
                if (i === API.RETRY_ATTEMPTS - 1) throw err;
                Logger.warn(`Fetch error for ${url}: ${err.message}. Retrying...`);
                await sleep(2000);
            }
        }
    }

    // ── Endpoint helpers ────────────────────────────────────────────────

    /**
     * Get ranked players for a specific rank from a specific platform and queue.
     * @param {Object} rankDef — { tier, division, isApex }
     * @param {number} page — page number for paginated results
     * @param {string} platform — platform routing value (e.g. "sg2", "kr", "na1")
     * @param {string} queueName — queue name (e.g. "RANKED_SOLO_5x5", "RANKED_FLEX_SR")
     */
    async getPlayers(rankDef, page, platform, queueName = API.QUEUES[0].name) {
        if (rankDef.isApex) {
            const apexMap = {
                MASTER: "masterleagues",
                GRANDMASTER: "grandmasterleagues",
                CHALLENGER: "challengerleagues",
            };
            const data = await this.fetch(
                `https://${platform}.api.riotgames.com/lol/league/v4/${apexMap[rankDef.tier]}/by-queue/${queueName}`
            );
            return data?.entries
                ? data.entries.slice(0, CRAWLER.PLAYERS_PER_PAGE)
                : [];
        }

        const data = await this.fetch(
            `https://${platform}.api.riotgames.com/lol/league/v4/entries/${queueName}/${rankDef.tier}/${rankDef.division}?page=${page}`
        );
        return Array.isArray(data)
            ? data.slice(0, CRAWLER.PLAYERS_PER_PAGE)
            : [];
    }

    /**
     * Get match IDs for a player.
     * @param {string} puuid — player's PUUID
     * @param {string} matchRegion — regional routing (e.g. "sea", "asia", "americas", "europe")
     * @param {Object} options — { start, count, startTime, endTime, queue }
     */
    async getMatchIds(puuid, matchRegion, options = {}) {
        const {
            start = 0,
            count = CRAWLER.MATCHES_PER_PLAYER,
            startTime,
            endTime,
            queue
        } = options;

        let url = `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
        if (queue) url += `&queue=${queue}`;
        if (startTime) url += `&startTime=${Math.floor(startTime / 1000)}`;
        if (endTime) url += `&endTime=${Math.floor(endTime / 1000)}`;

        return await this.fetch(url);
    }

    /**
     * @param {string} summonerId
     * @param {string} platform — platform routing (e.g. "sg2", "kr", "na1")
     */
    async getSummonerBySummonerId(summonerId, platform) {
        return await this.fetch(
            `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/${summonerId}`
        );
    }

    /**
     * @param {string} id — match ID
     * @param {string} matchRegion — regional routing (e.g. "sea", "asia", "americas", "europe")
     */
    async getMatchDetail(id, matchRegion) {
        return await this.fetch(
            `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/${id}`
        );
    }

    /**
     * @param {string} id — match ID
     * @param {string} matchRegion — regional routing (e.g. "sea", "asia", "americas", "europe")
     */
    async getMatchTimeline(id, matchRegion) {
        return await this.fetch(
            `https://${matchRegion}.api.riotgames.com/lol/match/v5/matches/${id}/timeline`
        );
    }
}

module.exports = RiotClient;
