/**
 * Loads local champion metadata (lanes, regions, prices, playstyle) from the assets directory.
 */

const fs = require("fs");
const path = require("path");

const META_PATH = path.join(__dirname, "../../../assets/champion_metadata.json");

function loadLocalMetadata() {
    const raw = JSON.parse(fs.readFileSync(META_PATH, "utf-8"));
    const metaMap = {};
    raw.forEach((item) => {
        metaMap[item.id] = item;
    });
    return metaMap;
}

module.exports = { loadLocalMetadata };
