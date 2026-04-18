/**
 * Database Peeker — Quick CLI tool to inspect the SQLite database.
 */

const Database = require("../src/services/database");
const Logger = require("../src/utils/logger");

async function peek() {
    await Database.connect();

    console.log("\n--- SQLite Database Overview ---");
    
    // 1. Total Matches
    const total = await Database.get("SELECT COUNT(*) as count FROM matches");
    const totalTL = await Database.get("SELECT COUNT(*) as count FROM timelines");
    console.log(`  Total Matches:   ${total.count}`);
    console.log(`  Total Timelines: ${totalTL.count}`);

    // 2. Rank Breakdown
    console.log("\n--- Breakdown by Rank ---");
    const ranks = await Database.all(
        "SELECT tier, division, COUNT(*) as count FROM matches GROUP BY tier, division ORDER BY timestamp DESC"
    );
    
    console.table(ranks.map(r => ({
        Rank: `${r.tier} ${r.division}`,
        Matches: r.count
    })));

    // 3. Newest Match Sample
    console.log("\n--- Latest Match Sample ---");
    const latest = await Database.get("SELECT matchId, tier, division, timestamp FROM matches ORDER BY timestamp DESC LIMIT 1");
    if (latest) {
        console.log(`  Match ID:  ${latest.matchId}`);
        console.log(`  Rank:      ${latest.tier} ${latest.division}`);
        console.log(`  Date:      ${new Date(latest.timestamp).toLocaleString()}`);
    }

    Database.close();
}

peek().catch(e => console.error(e));
