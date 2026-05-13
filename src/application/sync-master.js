/**
 * Master Sync Script — orchestrates fetching, processing, and outputting
 * League of Legends data from Riot's Data Dragon API.
 *
 * Usage:
 *   node scripts/sync-master.js          # Interactive mode
 *   node scripts/sync-master.js --auto   # Auto-sync all data to Firebase
 */

const { api } = require("../infrastructure/api/ddragon");
const { fetchAndProcessChampions } = require("./champions");
const { fetchAndProcessItems } = require("./items");
const { fetchAndProcessRunes } = require("./runes");
const { fetchAndProcessSpells } = require("./spells");
const { uploadChampions, uploadItems, uploadRunes, uploadSpells } = require("../infrastructure/output/firebase-storage");
const { previewIncrements, incrementVersionFields } = require("../infrastructure/output/remote-config");
const { exportChampions, exportItems, exportRunes, exportSpells } = require("../infrastructure/output/local-export");
const {
    c,
    askQuestion,
    printHeader,
    showDataMenu,
    showDestMenu,
    printComplete,
    printError,
    showEnvMenu,
    printPhase,
    printAutoMode
} = require("../presentation/cli-utils");

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
            if (!isAuto) {
                console.log();
                const confirm = (await askQuestion(`\x1b[33m⚠ WARNING: You are about to DIRECTLY UPLOAD static data to Firebase. This overwrites production data.\x1b[0m\n    Are you sure you want to proceed? (y/N): `)).trim().toLowerCase();
                if (confirm !== "y" && confirm !== "yes") {
                    console.log("\n  \x1b[36mℹ Operation cancelled.\x1b[0m\n");
                    process.exit(0);
                }
            }

            printPhase(2, "Uploading to Firebase");

            const allRcFields = [];
            let uploadPatch = globalVersion;

            if (championData) {
                const result = await uploadChampions(championData, globalVersion);
                if (result?.rcFields) allRcFields.push(...result.rcFields);
                if (result?.patch) uploadPatch = result.patch;
            }
            if (items) {
                const result = await uploadItems(items, globalVersion);
                if (result?.rcFields) allRcFields.push(...result.rcFields);
            }
            if (runeTrees) {
                const result = await uploadRunes(runeTrees, globalVersion);
                if (result?.rcFields) allRcFields.push(...result.rcFields);
            }
            if (spells) {
                const result = await uploadSpells(spells, globalVersion);
                if (result?.rcFields) allRcFields.push(...result.rcFields);
            }

            // Bump Remote Config versions
            if (allRcFields.length > 0) {
                const uniqueFields = [...new Set(allRcFields)];
                const rcOptions = uploadPatch ? { latestPatch: uploadPatch } : {};

                if (isAuto) {
                    // Auto-mode: bump without prompting
                    await incrementVersionFields(uniqueFields, rcOptions);
                } else {
                    // Interactive: show preview and ask
                    const preview = await previewIncrements(uniqueFields, rcOptions);
                    if (preview) {
                        showEnvMenu();
                        const envChoice = (await askQuestion("Enter choice (1-4, Default=1): ")).trim();
                        
                        let environment = "ALL";
                        if (envChoice === "2") environment = "PROD";
                        else if (envChoice === "3") environment = "Staging";
                        else if (envChoice === "4") environment = "Debug";

                        rcOptions.environment = environment;

                        const bumpAns = (await askQuestion(`Bump versions for ${c.yellow}${environment}${c.reset}? (y/N): `)).trim().toLowerCase();
                        if (bumpAns === "y" || bumpAns === "yes") {
                            await incrementVersionFields(uniqueFields, rcOptions);
                        } else {
                            console.log(`  ${c.dim}ℹ Skipped Remote Config version bump.${c.reset}`);
                        }
                    }
                }
            }
        }

        printComplete(globalVersion);
        process.exit(0);
    } catch (e) {
        printError(`Sync failed for patch ${globalVersion}`);
        console.error(e.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    runMasterSync();
}

module.exports = { runMasterSync };
