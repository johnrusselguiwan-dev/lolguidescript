/**
 * Local export handler — writes processed data to JSON files in exports/.
 */

const fs = require("fs");
const path = require("path");
const { printSuccess } = require("../utils/cli");

const EXPORTS_BASE = path.join(__dirname, "../../exports");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getPatchDir(version) {
    const patchDir = path.join(EXPORTS_BASE, version);
    ensureDir(patchDir);
    return patchDir;
}

function exportChampions(championData, version) {
    const patchDir = getPatchDir(version);
    const listEntries = championData.map((item) => item.listEntry);
    const detailEntries = championData.map((item) => item.detailEntry);

    fs.writeFileSync(
        path.join(patchDir, "champions_list.json"),
        JSON.stringify(listEntries, null, 2)
    );
    fs.writeFileSync(
        path.join(patchDir, "champions_details.json"),
        JSON.stringify(detailEntries, null, 2)
    );
    printSuccess(`Champions exported to exports/${version}/`);
}

function exportItems(items, version) {
    const patchDir = getPatchDir(version);
    fs.writeFileSync(
        path.join(patchDir, "items.json"),
        JSON.stringify(items, null, 2)
    );
    printSuccess(`${items.length} items exported to exports/${version}/`);
}

function exportRunes(runeTrees, version) {
    const patchDir = getPatchDir(version);
    fs.writeFileSync(
        path.join(patchDir, "runes.json"),
        JSON.stringify(runeTrees, null, 2)
    );
    printSuccess(`${runeTrees.length} rune trees exported to exports/${version}/`);
}

function exportSpells(spells, version) {
    const patchDir = getPatchDir(version);
    fs.writeFileSync(
        path.join(patchDir, "spells.json"),
        JSON.stringify(spells, null, 2)
    );
    printSuccess(`${spells.length} summoner spells exported to exports/${version}/`);
}

module.exports = { exportChampions, exportItems, exportRunes, exportSpells };
