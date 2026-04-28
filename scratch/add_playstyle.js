/**
 * Fetches playstyleInfo from CommunityDragon for every champion
 * and writes it into champion_metadata.json.
 *
 * CDragon endpoint: /v1/champions/{id}.json
 * Fields extracted: playstyleInfo { damage, durability, crowdControl, mobility, utility }
 */

const fs = require("fs");
const path = require("path");

const META_PATH = path.join(__dirname, "../assets/champion_metadata.json");
const CDRAGON_BASE = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions";

const CONCURRENCY = 10;
const DELAY_MS = 200;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchPlaystyle(championId) {
    const url = `${CDRAGON_BASE}/${championId}.json`;
    const res = await fetch(url);
    if (!res.ok) {
        console.warn(`  WARN: ${championId} returned ${res.status}`);
        return null;
    }
    const data = await res.json();
    return data.playstyleInfo || null;
}

async function main() {
    const raw = JSON.parse(fs.readFileSync(META_PATH, "utf-8"));
    console.log(`Loaded ${raw.length} champions from metadata.`);

    const results = new Map();
    const ids = raw.map((c) => c.id);

    // Process in chunks
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const chunk = ids.slice(i, i + CONCURRENCY);
        const promises = chunk.map(async (id) => {
            const ps = await fetchPlaystyle(id);
            results.set(id, ps);
        });
        await Promise.all(promises);
        const done = Math.min(i + CONCURRENCY, ids.length);
        process.stdout.write(`\r  Fetched ${done}/${ids.length}`);
        if (i + CONCURRENCY < ids.length) await sleep(DELAY_MS);
    }

    console.log("\nMerging playstyle data into metadata...");

    let missing = [];
    const updated = raw.map((champ) => {
        const ps = results.get(champ.id);
        if (!ps) {
            missing.push(champ.name);
            return {
                ...champ,
                playstyle: { damage: 2, durability: 2, crowdControl: 1, mobility: 1, utility: 1 }
            };
        }
        return {
            ...champ,
            playstyle: {
                damage: ps.damage,
                durability: ps.durability,
                crowdControl: ps.crowdControl,
                mobility: ps.mobility,
                utility: ps.utility
            }
        };
    });

    if (missing.length > 0) {
        console.log("Champions with no CDragon data (defaults applied):", missing);
    }

    fs.writeFileSync(META_PATH, JSON.stringify(updated, null, 2) + "\n", "utf-8");
    console.log(`Updated ${updated.length} champions with playstyle data.`);
}

main().catch(console.error);
