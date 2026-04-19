/**
 * Verification script — tests the database migration, patch column,
 * and new query methods.
 */
const Database = require("../src/services/database");
const { API } = require("../config/constants");

async function verify() {
    console.log("\n=== Verification: Patch Transition System ===\n");

    // 1. Connect (triggers migration)
    console.log("[1] Connecting to DB (triggers WAL + migration)...");
    await Database.connect();
    console.log("    ✓ Connected\n");

    // 2. Check patch column
    console.log("[2] Checking patch column...");
    const columns = await Database.all("PRAGMA table_info(matches)");
    const hasPatch = columns.some(c => c.name === "patch");
    console.log(`    Patch column exists: ${hasPatch ? "✓ YES" : "✗ NO"}\n`);

    // 3. Check WAL mode
    console.log("[3] Checking journal mode...");
    const journalRow = await Database.get("PRAGMA journal_mode");
    console.log(`    Journal mode: ${journalRow.journal_mode}\n`);

    // 4. Patch distribution
    console.log("[4] Patch distribution...");
    const patches = await Database.getDistinctPatches();
    for (const p of patches) {
        console.log(`    Patch ${p.patch}: ${p.count} matches`);
    }

    // 5. Total matches
    const totalRow = await Database.get("SELECT COUNT(*) as count FROM matches");
    console.log(`\n    Total matches: ${totalRow.count}`);

    // 6. Check backfill completeness
    const nullPatch = await Database.get("SELECT COUNT(*) as count FROM matches WHERE patch IS NULL");
    console.log(`    Matches with NULL patch: ${nullPatch.count}`);

    // 7. Test new methods
    console.log("\n[5] Testing new query methods...");
    
    const currentPatchCount = await Database.getMatchCountForPatch("16.8");
    console.log(`    getMatchCountForPatch("16.8"): ${currentPatchCount}`);

    // 8. Config check
    console.log("\n[6] Config check...");
    console.log(`    Platforms: ${API.PLATFORMS.join(", ")}`);
    console.log(`    Queues: ${API.QUEUES.map(q => `${q.name} (${q.id})`).join(", ")}`);
    console.log(`    Queue IDs: ${API.QUEUE_IDS.join(", ")}`);

    console.log("\n=== Verification Complete ===\n");
    
    Database.close();
}

verify().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});
