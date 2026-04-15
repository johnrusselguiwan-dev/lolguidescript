/**
 * Master Sync Script — orchestrates fetching, processing, and outputting
 * League of Legends data from Riot's Data Dragon API.
 *
 * Usage:
 *   node scripts/sync-master.js          # Interactive mode
 *   node scripts/sync-master.js --auto   # Auto-sync all data to Firebase
 */

const { api } = require("../src/api/ddragon");
const { fetchAndProcessChampions } = require("../src/services/champions");
const { fetchAndProcessItems } = require("../src/services/items");
const { fetchAndProcessRunes } = require("../src/services/runes");
const { uploadChampions, uploadItems, uploadRunes } = require("../src/output/firebase");
const { exportChampions, exportItems, exportRunes } = require("../src/output/local-export");
const {
    askQuestion,
    printHeader,
    showDataMenu,
    showDestMenu,
    printPhase,
    printAutoMode,
    printComplete,
    printError,
} = require("../src/utils/cli");

// ─────────────────────────────────────────────────────────────────────────────

async function runMasterSync() {
    let globalVersion = "Unknown";

    try {
        // ── Fetch version ────────────────────────────────────────────────
        globalVersion = await api.getVersion();
        printHeader(globalVersion);

        const isAuto = process.argv.includes("--auto") || process.env.AUTO_SYNC === "true";

        // ── Select data ──────────────────────────────────────────────────
        let dataChoice = "4";

        if (!isAuto) {
            showDataMenu();
            dataChoice = (await askQuestion("Enter choice (1-4): ")).trim();
        } else {
            printAutoMode();
        }

        // ── Phase 1: Fetch & process ─────────────────────────────────────
        printPhase(1, "Fetching & Processing Data");

        let championData = null;
        let items = null;
        let runeTrees = null;

        if (dataChoice === "1" || dataChoice === "4") {
            championData = await fetchAndProcessChampions(globalVersion);
        }
        if (dataChoice === "2" || dataChoice === "4") {
            items = await fetchAndProcessItems(globalVersion);
        }
        if (dataChoice === "3" || dataChoice === "4") {
            runeTrees = await fetchAndProcessRunes(globalVersion);
        }

        // ── Select destination ───────────────────────────────────────────
        let destChoice = "1";

        if (!isAuto) {
            console.log();
            showDestMenu();
            destChoice = (await askQuestion("Enter choice (1-2): ")).trim();
        }

        // ── Phase 2: Output ──────────────────────────────────────────────
        if (destChoice === "2") {
            printPhase(2, "Exporting to Local JSON");

            if (championData) exportChampions(championData, globalVersion);
            if (items) exportItems(items, globalVersion);
            if (runeTrees) exportRunes(runeTrees, globalVersion);
        } else {
            printPhase(2, "Uploading to Firebase");

            if (championData) await uploadChampions(championData, globalVersion);
            if (items) await uploadItems(items, globalVersion);
            if (runeTrees) await uploadRunes(runeTrees, globalVersion);
        }

        printComplete(globalVersion);
        process.exit(0);
    } catch (e) {
        printError(`Sync failed for patch ${globalVersion}`);
        console.error(e.stack);
        process.exit(1);
    }
}

runMasterSync();
