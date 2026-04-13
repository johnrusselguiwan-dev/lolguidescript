const axios = require("axios");
const fs = require("fs");
const readline = require("readline");

const { buildDetailEntry } = require("./mappers/details");
const { buildListEntry } = require("./mappers/list");
const { db, admin } = require("./config/firebase");

const BASE_URL = "https://ddragon.leagueoflegends.com/cdn";
const LANGUAGE = "en_US";

const api = {
    getVersion: async () => {
        const res = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json");
        return res.data[0];
    },
    getChampionList: async (version) => {
        const res = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion.json`);
        return res.data.data;
    },
    getChampionDetail: async (version, id) => {
        const res = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion/${id}.json`);
        return res.data.data[id];
    }
};

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

function loadLocalMetadata() {
    const localMetaFile = JSON.parse(fs.readFileSync("./assets/champion_metadata.json", "utf-8"));
    const metaMap = {};
    localMetaFile.forEach(item => { metaMap[item.id] = item; });
    return metaMap;
}

async function uploadToFirebaseSafe(finalizedData, patchVersion) {
    const listEntries = finalizedData.map(item => item.listEntry);
    const detailEntries = finalizedData.map(item => item.detailEntry);

    const batch = db.batch();

    batch.set(db.collection("data").doc("champion_list"), {
        json: JSON.stringify(listEntries)
    });

    batch.set(db.collection("data").doc("champion_details"), {
        json: JSON.stringify(detailEntries)
    });

    batch.set(db.collection("system_metadata").doc("patch_info"), {
        latestPatch: patchVersion,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
    console.log(`✅ Uploaded merged JSON data safely to Firebase`);
}

async function runMasterSync() {
    let globalVersion = "Unknown";
    try {
        console.log("🚀 Phase 1: Fetching and Validating Data...");

        const metaMap = loadLocalMetadata();

        globalVersion = await api.getVersion();
        console.log(`📦 Target Patch Version: ${globalVersion}`);

        const listData = await api.getChampionList(globalVersion);
        const championKeys = Object.keys(listData);

        const finalizedData = [];

        const FETCH_CHUNK_SIZE = 20;
        for (let i = 0; i < championKeys.length; i += FETCH_CHUNK_SIZE) {
            const chunkKeys = championKeys.slice(i, i + FETCH_CHUNK_SIZE);
            process.stdout.write(`Processing champions ${i + 1}-${i + chunkKeys.length}... `);

            const chunkPromises = chunkKeys.map(async (id) => {
                const raw = await api.getChampionDetail(globalVersion, id);
                const meta = metaMap[raw.key] || { lanes: ["Unknown"], region: "Runeterra" };

                const detailEntry = buildDetailEntry(raw, meta, globalVersion);
                const listEntry = buildListEntry(detailEntry);

                detailEntry.patchVersion = globalVersion;
                listEntry.patchVersion = globalVersion;

                return { id, listEntry, detailEntry };
            });

            const chunkResults = await Promise.all(chunkPromises);
            finalizedData.push(...chunkResults);
            console.log(`Done`);
        }

        console.log(`✅ All ${finalizedData.length} champions successfully validated!`);

        const answer = await askQuestion("\nDo you want to (1) Upload to Firebase or (2) Export to local JSON? Enter 1 or 2: ");

        if (answer.trim() === '2') {
            console.log("🚀 Phase 2: Exporting to local JSON...");

            const listEntries = finalizedData.map(item => item.listEntry);
            const detailEntries = finalizedData.map(item => item.detailEntry);

            fs.writeFileSync(`./exports/export_list_patch_${globalVersion}.json`, JSON.stringify(listEntries, null, 2));
            fs.writeFileSync(`./exports/export_details_patch_${globalVersion}.json`, JSON.stringify(detailEntries, null, 2));

            console.log(`🎉 Export completed: export_list_patch_${globalVersion}.json and export_details_patch_${globalVersion}.json`);
        } else {
            console.log("🚀 Phase 2: Uploading safely to Firebase via Batch...");
            await uploadToFirebaseSafe(finalizedData, globalVersion);
            console.log(`🎉 All good! Safe sync completed for patch ${globalVersion}.`);
        }

        process.exit(0);
    } catch (e) {
        console.error(`❌ Sync failed for patch ${globalVersion}. Firebase unmodified! Error:`, e.stack);
        process.exit(1);
    }
}

runMasterSync();