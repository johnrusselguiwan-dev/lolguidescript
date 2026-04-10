const admin = require("firebase-admin");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const serviceAccount = require("../league-of-legends-guide-202602-firebase-adminsdk-fbsvc-7f51437389.json");

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const BASE_URL = "https://ddragon.leagueoflegends.com/cdn";
const LANGUAGE = "en_US";

function parseChampionText(htmlContent) {
    if (!htmlContent) return "";
    let intermediate = htmlContent.replace(/<br\s*\/?>/gi, "\n").replace(/<li>/gi, "\n• ");
    const $ = cheerio.load(intermediate, null, false);
    const tagsToKeep = ['physicaldamage', 'magicdamage', 'truedamage', 'scalead', 'scaleap', 'healing', 'shield', 'mana'];
    $('*').each((i, el) => {
        if (!tagsToKeep.includes(el.name.toLowerCase())) $(el).replaceWith($(el).contents());
    });
    return $.html().trim();
}

async function runMasterSync() {
    try {
        console.log("🚀 Building Unified App Documents...");

        const localMetaFile = JSON.parse(fs.readFileSync("../assets/champion_metadata.json", "utf-8"));
        const metaMap = {};
        localMetaFile.forEach(item => { metaMap[item.id] = item; });

        const versionRes = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json");
        const version = versionRes.data[0];

        const listRes = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion.json`);
        const championKeys = Object.keys(listRes.data.data);

        let finalChampionList = [];
        let finalChampionDetails = {};

        for (const id of championKeys) {
            process.stdout.write(`Fetching ${id}... `);
            const detailRes = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion/${id}.json`);
            const raw = detailRes.data.data[id];
            const meta = metaMap[raw.key] || { lanes: ["Unknown"], region: "Runeterra" };

            // 1. Prepare data for champion_list (Filtering focused)
            const listEntry = {
                id: raw.id,
                name: raw.name,
                image: `${BASE_URL}/${version}/img/champion/${raw.image.full}`,
                lane: meta.lanes,   // Used for your filter system
                region: meta.region, // Used for your filter system
                role: raw.tags,
                tag: raw.tags[0] || ""
            };
            finalChampionList.push(listEntry);

            // 2. Prepare data for champion_details (Full content)
            finalChampionDetails[raw.id] = {
                ...listEntry,
                title: raw.title,
                background: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${raw.id}_0.jpg`,
                basicStats: {
                    hp: raw.stats.hp,
                    mana: raw.stats.mp,
                    physicalAttack: raw.stats.attackdamage,
                    armor: raw.stats.armor,
                    movementSpeed: raw.stats.movespeed
                },
                skills: [
                    {
                        slot: "Passive",
                        name: raw.passive.name,
                        icon: `${BASE_URL}/${version}/img/passive/${raw.passive.image.full}`,
                        desc: parseChampionText(raw.passive.description)
                    },
                    ...raw.spells.map((s, i) => ({
                        slot: `Skill ${i + 1}`,
                        name: s.name,
                        icon: `${BASE_URL}/${version}/img/spell/${s.image.full}`,
                        desc: parseChampionText(s.description)
                    }))
                ],
                lore: parseChampionText(raw.lore)
            };
            console.log("✅");
        }

        console.log("\n⬆️ Uploading to Firestore...");

        // Store the full array in champion_list
        await db.collection("data").doc("champion_list").set({
            json: JSON.stringify(finalChampionList)
        });

        // Store the map in champion_details
        await db.collection("data").doc("champion_details").set({
            json: JSON.stringify(finalChampionDetails)
        });

        console.log("🎉 Successfully updated data/champion_list and data/champion_details!");
        process.exit(0);
    } catch (error) {
        console.error("\n❌ ERROR:", error.message);
        process.exit(1);
    }
}

runMasterSync();