/**
 * Local export handler — writes processed data to JSON files in exports/.
 */

const fs = require("fs");
const path = require("path");
const { printSuccess } = require("../utils/cli");

const EXPORTS_DIR = path.join(__dirname, "../../exports");

function ensureExportsDir() {
    if (!fs.existsSync(EXPORTS_DIR)) {
        fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }
}

function exportChampions(championData, version) {
    ensureExportsDir();
    const listEntries = championData.map((item) => item.listEntry);
    const detailEntries = championData.map((item) => item.detailEntry);

    fs.writeFileSync(
        path.join(EXPORTS_DIR, `export_list_patch_${version}.json`),
        JSON.stringify(listEntries, null, 2)
    );
    fs.writeFileSync(
        path.join(EXPORTS_DIR, `export_details_patch_${version}.json`),
        JSON.stringify(detailEntries, null, 2)
    );
    printSuccess("Champions exported to local JSON");
}

function exportItems(items, version) {
    ensureExportsDir();
    fs.writeFileSync(
        path.join(EXPORTS_DIR, `export_items_patch_${version}.json`),
        JSON.stringify(items, null, 2)
    );
    printSuccess(`${items.length} items exported to local JSON`);
}

function exportRunes(runeTrees, version) {
    ensureExportsDir();
    fs.writeFileSync(
        path.join(EXPORTS_DIR, `export_runes_patch_${version}.json`),
        JSON.stringify(runeTrees, null, 2)
    );
    printSuccess(`${runeTrees.length} rune trees exported to local JSON`);
}

function exportSpells(spells, version) {
    ensureExportsDir();
    fs.writeFileSync(
        path.join(EXPORTS_DIR, `export_spells_patch_${version}.json`),
        JSON.stringify(spells, null, 2)
    );
    printSuccess(`${spells.length} summoner spells exported to local JSON`);
}

module.exports = { exportChampions, exportItems, exportRunes, exportSpells };
