import { parseChampionText } from "./parser.js";

const admin = require("firebase-admin");
const axios = require("axios");
const cheerio = require("cheerio");
const serviceAccount = require("../league-of-legends-guide-202602-firebase-adminsdk-fbsvc-7f51437389.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const BASE_URL = "https://ddragon.leagueoflegends.com/cdn";
const LANGUAGE = "en_US";


async function runManualSync() {
    try {
        console.log("🚀 Fetching latest version...");
        const versionRes = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json");
        const version = versionRes.data[0];

        console.log(`📡 Version: ${version}. Fetching champion list...`);
        const listRes = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion.json`);
        const championKeys = Object.keys(listRes.data.data);

        for (const id of championKeys) {
            process.stdout.write(`Processing ${id}... `);
            const detailRes = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion/${id}.json`);
            const rawData = detailRes.data.data[id];

            const cleanedData = {
                id: rawData.id,
                name: rawData.name,
                title: rawData.title,
                lore: parseChampionText(rawData.lore),
                tags: rawData.tags,
                stats: rawData.stats,
                image: rawData.image,
                passive: {
                    name: rawData.passive.name,
                    description: parseChampionText(rawData.passive.description)
                },
                spells: rawData.spells.map(spell => ({
                    id: spell.id,
                    name: spell.name,
                    description: parseChampionText(spell.description)
                })),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            };

            await db.collection("champions").doc(id).set(cleanedData);
            console.log("✅");
        }
        console.log("🎉 DONE! Firestore is updated.");
        process.exit();
    } catch (error) {
        console.error("❌ Sync Failed:", error);
    }
}

runManualSync();