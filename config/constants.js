/**
 * Crawler & application configuration constants.
 *
 * All magic numbers, paths, and rank definitions live here so they're
 * easy to find and tweak without digging through business-logic code.
 */

const path = require("path");

// ── API settings ────────────────────────────────────────────────────────────

const API = {
    PLATFORM: "sg2",
    MATCH_REGION: "sea",
    QUEUE: "RANKED_SOLO_5x5",
    MAX_REQUESTS_PER_CYCLE: 80,
    SAFE_DELAY_MS: 1500,
    RETRY_ATTEMPTS: 3,
};

// ── Crawler tuning ──────────────────────────────────────────────────────────

const CRAWLER = {
    TARGET_MATCHES_PER_RANK: 100,
    PLAYERS_PER_PAGE: 5,
    MATCHES_PER_PLAYER: 5,
    PAUSE_MS_BETWEEN_CYCLES: 30 * 1000,
    MAX_EMPTY_PAGES_BEFORE_SKIP: 5,
    HISTORICAL_DAYS_DEFAULT: 30,
    MAX_HISTORICAL_MATCHES_PER_PLAYER: 100,
    STRICT_PATCH_FILTER: true,
};

// ── Storage paths (relative to project root) ────────────────────────────────

const DATA_ROOT = path.join(__dirname, "..", "data");
const DATABASE_ROOT = path.join(DATA_ROOT, "database");
const OUTPUT_ROOT = path.join(DATA_ROOT, "outputs");
const SYSTEM_ROOT = path.join(DATA_ROOT, "system");
const IMPORT_ROOT = path.join(DATA_ROOT, "import");

const STORAGE = {
    ROOT: DATABASE_ROOT,
    ASSETS: path.join(DATA_ROOT, "assets"),
    IMPORT: IMPORT_ROOT,
    DATABASE: path.join(DATA_ROOT, "system", "crawler.db"),
    GLOBAL_SEEN: path.join(SYSTEM_ROOT, "seen_matches.json"),
    CHAMPION_META: path.join(OUTPUT_ROOT, "champions_meta.json"),
    CHAMPION_RATING: path.join(OUTPUT_ROOT, "champions_rating.json"),
    RATES_SUMMARY: path.join(OUTPUT_ROOT, "rates_summary.json"),
    CHAMPION_DRAFTING: path.join(OUTPUT_ROOT, "champions_drafting.json"),
    CRAWL_STATE: path.join(SYSTEM_ROOT, "crawler_state.json"),
    ITEMS_SUMMARY: path.join(OUTPUT_ROOT, "items_summary.json"),
    RUNES_SUMMARY: path.join(OUTPUT_ROOT, "runes_summary.json"),
};

// ── Data Dragon CDN ─────────────────────────────────────────────────────────

const DDRAGON = {
    REALM_URL: "https://ddragon.leagueoflegends.com/realms/sg.json",
    BASE_URL: "https://ddragon.leagueoflegends.com/cdn",
};

// ── Rank ladder (Iron IV → Challenger) ──────────────────────────────────────

const RANK_HIERARCHY = [
    { tier: "IRON", division: "IV" }, { tier: "IRON", division: "III" }, { tier: "IRON", division: "II" }, { tier: "IRON", division: "I" },
    { tier: "BRONZE", division: "IV" }, { tier: "BRONZE", division: "III" }, { tier: "BRONZE", division: "II" }, { tier: "BRONZE", division: "I" },
    { tier: "SILVER", division: "IV" }, { tier: "SILVER", division: "III" }, { tier: "SILVER", division: "II" }, { tier: "SILVER", division: "I" },
    { tier: "GOLD", division: "IV" }, { tier: "GOLD", division: "III" }, { tier: "GOLD", division: "II" }, { tier: "GOLD", division: "I" },
    { tier: "PLATINUM", division: "IV" }, { tier: "PLATINUM", division: "III" }, { tier: "PLATINUM", division: "II" }, { tier: "PLATINUM", division: "I" },
    { tier: "EMERALD", division: "IV" }, { tier: "EMERALD", division: "III" }, { tier: "EMERALD", division: "II" }, { tier: "EMERALD", division: "I" },
    { tier: "DIAMOND", division: "IV" }, { tier: "DIAMOND", division: "III" }, { tier: "DIAMOND", division: "II" }, { tier: "DIAMOND", division: "I" },
    { tier: "MASTER", division: "I", isApex: true },
    { tier: "GRANDMASTER", division: "I", isApex: true },
    { tier: "CHALLENGER", division: "I", isApex: true },
];

module.exports = { API, CRAWLER, STORAGE, DDRAGON, RANK_HIERARCHY };
