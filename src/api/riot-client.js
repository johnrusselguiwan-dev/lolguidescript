/**
 * Riot API client — rate-limited, auto-retrying HTTP wrapper for the
 * League of Legends ranked data endpoints.
 *
 * Uses the native `fetch` API (Node 18+). A per-cycle budget prevents
 * exceeding Riot's rate limits, and exponential back-off handles 429s.
 */

const { API } = require("../../config/constants");
const Logger = require("../utils/logger");
const sleep = require("../utils/sleep");

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
        this.used = 0;
        this.lastCallTime = 0;
    }

    /**
     * Core fetch with rate-limit pacing, retry, and budget enforcement.
     * @param {string} url — full API URL
     * @returns {Promise<any>} parsed JSON response
     */
    async fetch(url) {
        if (this.used >= API.MAX_REQUESTS_PER_CYCLE) {
            throw new Error("BUDGET_EXHAUSTED");
        }

        const elapsed = Date.now() - this.lastCallTime;
        if (elapsed < API.SAFE_DELAY_MS) {
            await sleep(API.SAFE_DELAY_MS - elapsed);
        }

        this.lastCallTime = Date.now();
        this.used++;

        // Log the actual API request
        const isMatch = url.includes("/matches/");
        const label = isMatch ? url.split("/").pop() : url;
        Logger.request(this.used, `Fetching ${label}`);

        for (let i = 0; i < API.RETRY_ATTEMPTS; i++) {
            try {
                const res = await fetch(url, {
                    headers: { "X-Riot-Token": this.apiKey },
                });

                if (res.status === 429) {
                    const wait = (Number(res.headers.get("Retry-After")) || 5) * 1000;
                    Logger.warn(`API Rate Limit. Resting ${wait}ms...`);
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

    async getPlayers(rankDef, page) {
        if (rankDef.isApex) {
            const apexMap = {
                MASTER: "masterleagues",
                GRANDMASTER: "grandmasterleagues",
                CHALLENGER: "challengerleagues",
            };
            const data = await this.fetch(
                `https://${API.PLATFORM}.api.riotgames.com/lol/league/v4/${apexMap[rankDef.tier]}/by-queue/${API.QUEUE}`
            );
            return data?.entries
                ? data.entries.slice(0, require("../../config/constants").CRAWLER.PLAYERS_PER_PAGE)
                : [];
        }

        const data = await this.fetch(
            `https://${API.PLATFORM}.api.riotgames.com/lol/league/v4/entries/${API.QUEUE}/${rankDef.tier}/${rankDef.division}?page=${page}`
        );
        return Array.isArray(data)
            ? data.slice(0, require("../../config/constants").CRAWLER.PLAYERS_PER_PAGE)
            : [];
    }

    async getMatchIds(puuid, offset = 0) {
        const count = require("../../config/constants").CRAWLER.MATCHES_PER_PLAYER;
        return await this.fetch(
            `https://${API.MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${offset}&count=${count}`
        );
    }

    async getSummonerBySummonerId(summonerId) {
        return await this.fetch(
            `https://${API.PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/${summonerId}`
        );
    }

    async getMatchDetail(id) {
        return await this.fetch(
            `https://${API.MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/${id}`
        );
    }

    async getMatchTimeline(id) {
        return await this.fetch(
            `https://${API.MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/${id}/timeline`
        );
    }
}

module.exports = RiotClient;
