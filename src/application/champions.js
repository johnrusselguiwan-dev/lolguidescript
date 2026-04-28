/**
 * Champion data service — fetches, processes, and validates all champion data.
 */

const { api } = require("../infrastructure/api/ddragon");
const { buildDetailEntry } = require("../domain/mappers/champion-details");
const { buildListEntry } = require("../domain/mappers/champion-list");
const { loadLocalMetadata } = require("../infrastructure/utils/metadata");
const { readJson } = require("../infrastructure/utils/io");
const { ProgressBar } = require("../presentation/cli-utils");
const { STORAGE } = require("../../config/constants");
const Logger = require("../infrastructure/utils/logger");

const FETCH_CHUNK_SIZE = 20;

async function fetchAndProcessChampions(version) {
    const metaMap = loadLocalMetadata();
    const listData = await api.getChampionList(version);
    const championKeys = Object.keys(listData);

    const progress = new ProgressBar("Champions", championKeys.length);
    const finalizedData = [];

    for (let i = 0; i < championKeys.length; i += FETCH_CHUNK_SIZE) {
        const chunkKeys = championKeys.slice(i, i + FETCH_CHUNK_SIZE);

        const chunkPromises = chunkKeys.map(async (id) => {
            const raw = await api.getChampionDetail(version, id);
            const meta = metaMap[raw.key] || { lanes: ["Unknown"], region: "Runeterra" };

            const detailEntry = buildDetailEntry(raw, meta, version);
            const listEntry = buildListEntry(detailEntry);

            detailEntry.patchVersion = version;
            listEntry.patchVersion = version;

            return { id, listEntry, detailEntry };
        });

        const chunkResults = await Promise.all(chunkPromises);
        finalizedData.push(...chunkResults);
        progress.update(Math.min(i + FETCH_CHUNK_SIZE, championKeys.length));
    }

    progress.complete(`${finalizedData.length} champions ready`);
    return finalizedData;
}

module.exports = { fetchAndProcessChampions };

