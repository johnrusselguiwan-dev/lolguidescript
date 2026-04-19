const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("data/system/crawler.db");

db.all("SELECT data FROM matches", (err, rows) => {
    if (err) { console.error(err); db.close(); return; }
    
    const patchCounts = {};
    for (const row of rows) {
        try {
            const match = JSON.parse(row.data);
            const version = match.info.gameVersion;
            const patch = version.split(".").slice(0, 2).join(".");
            patchCounts[patch] = (patchCounts[patch] || 0) + 1;
        } catch(e) {}
    }
    
    console.log("\n=== FULL Patch Distribution ===");
    const sorted = Object.entries(patchCounts).sort((a, b) => b[1] - a[1]);
    for (const [patch, count] of sorted) {
        const pct = ((count / rows.length) * 100).toFixed(1);
        console.log(`  Patch ${patch.padEnd(6)}: ${String(count).padStart(5)} matches (${pct}%)`);
    }
    console.log(`\n  Total: ${rows.length} matches\n`);
    
    // Check how many are current patch (16.8)
    const current = patchCounts["16.8"] || 0;
    console.log(`  Current patch (16.8): ${current} matches (${((current/rows.length)*100).toFixed(1)}%)`);
    console.log(`  Old patches: ${rows.length - current} matches (${(((rows.length-current)/rows.length)*100).toFixed(1)}%)`);
    console.log();
    
    db.close();
});
