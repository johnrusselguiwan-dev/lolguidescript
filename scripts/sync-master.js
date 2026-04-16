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
const { fetchAndProcessSpells } = require("../src/services/spells");
const { uploadChampions, uploadItems, uploadRunes, uploadSpells } = require("../src/output/firebase");
const { exportChampions, exportItems, exportRunes, exportSpells } = require("../src/output/local-export");
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
        let dataChoice = "5";

        if (!isAuto) {
            showDataMenu();
            dataChoice = (await askQuestion("Enter choice (1-5): ")).trim();
        } else {
            printAutoMode();
        }

        // ── Phase 1: Fetch & process ─────────────────────────────────────
        printPhase(1, "Fetching & Processing Data");

        let championData = null;
        let items = null;
        let runeTrees = null;
        let spells = null;

        if (dataChoice === "1" || dataChoice === "5") {
            championData = await fetchAndProcessChampions(globalVersion);
        }
        if (dataChoice === "2" || dataChoice === "5") {
            items = await fetchAndProcessItems(globalVersion);
        }
        if (dataChoice === "3" || dataChoice === "5") {
            runeTrees = await fetchAndProcessRunes(globalVersion);
        }
        if (dataChoice === "4" || dataChoice === "5") {
            spells = await fetchAndProcessSpells();
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
            if (spells) exportSpells(spells, globalVersion);
        } else {
            printPhase(2, "Uploading to Firebase");

            if (championData) await uploadChampions(championData, globalVersion);
            if (items) await uploadItems(items, globalVersion);
            if (runeTrees) await uploadRunes(runeTrees, globalVersion);
            if (spells) await uploadSpells(spells, globalVersion);
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
