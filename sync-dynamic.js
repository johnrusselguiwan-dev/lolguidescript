const axios = require("axios");
const { db } = require("./config/firebase");

const fetchDynamicData = async () => {
    return {
        "Aatrox": { winRate: "51.0%", pickRate: "6.2%", banRate: "3.1%", tier: "S" },
        "Ahri": { winRate: "49.5%", pickRate: "8.2%", banRate: "1.0%", tier: "A" }
    };
};

async function updateDynamicDataSafely(dynamicDataMap) {
    const CHUNK_SIZE = 200; 
    const championIds = Object.keys(dynamicDataMap);
    
    for (let i = 0; i < championIds.length; i += CHUNK_SIZE) {
        const batch = db.batch();
        const chunk = championIds.slice(i, i + CHUNK_SIZE);
        
        chunk.forEach((id) => {
            const data = dynamicDataMap[id];
            const detailRef = db.collection("champion_details").doc(id);
            
            batch.update(detailRef, {
                winRate: data.winRate,
                pickRate: data.pickRate,
                banRate: data.banRate,
                tier: data.tier || "Unranked"
            });
        });
        
        await batch.commit();
        console.log(`✅ Uploaded dynamic batch chunk ${Math.floor(i / CHUNK_SIZE) + 1}`);
    }
}

async function runDynamicSync() {
    try {
        console.log("🚀 Fetching dynamic data...");
        const dynamicData = await fetchDynamicData();
        
        console.log("🚀 Updating Firestore documents...");
        await updateDynamicDataSafely(dynamicData);
        
        console.log(`🎉 Dynamic sync completed!`);
        process.exit(0);
    } catch (e) {
        console.error(`❌ Dynamic sync failed! Error:`, e.stack);
        process.exit(1);
    }
}

runDynamicSync();
