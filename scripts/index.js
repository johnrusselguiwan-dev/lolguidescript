const admin = require("firebase-admin");
const axios = require("axios");
const fs = require("fs");

const { buildDetailEntry } = require("./details");
const { buildListEntry } = require("./list");

const serviceAccount = require("../league-of-legends-guide-202602-firebase-adminsdk-fbsvc-7f51437389.json");

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const BASE_URL = "https://ddragon.leagueoflegends.com/cdn";
const LANGUAGE = "en_US";

async function runMasterSync() {
    try {
        console.log("🚀 Starting Entity-Matched Sync...");

        const localMetaFile = JSON.parse(fs.readFileSync("../assets/champion_metadata.json", "utf-8"));
        const metaMap = {};
        localMetaFile.forEach(item => { metaMap[item.id] = item; });

        const versionRes = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json");
        const version = versionRes.data[0];
        const listRes = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion.json`);
        const championKeys = Object.keys(listRes.data.data);

        for (const id of championKeys) {
            process.stdout.write(`Syncing ${id}... `);
            const detailRes = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion/${id}.json`);
            const raw = detailRes.data.data[id];
            const meta = metaMap[raw.key] || { lanes: ["Unknown"], region: "Runeterra" };

            const detailEntry = buildDetailEntry(raw, meta, version);
            const listEntry = buildListEntry(detailEntry);

            await db.collection("champion_list").doc(id).set(listEntry);
            await db.collection("champion_details").doc(id).set(detailEntry);

            console.log(`✅ (${detailEntry.skillNames.length} skills)`);
        }

        console.log("🎉 All good! Everything is synced.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Sync failed:", e.stack);
        process.exit(1);
    }
}

runMasterSync();