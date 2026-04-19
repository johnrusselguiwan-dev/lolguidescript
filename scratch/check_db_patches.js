const Database = require("../src/services/database");

async function checkPatchDistribution() {
    try {
        await Database.connect();
        const rows = await Database.all("SELECT data FROM matches");
        
        const distribution = {};
        rows.forEach((row, index) => {
            try {
                const detail = JSON.parse(row.data);
                if (detail && detail.info && detail.info.gameVersion) {
                    const patch = detail.info.gameVersion.split(".").slice(0, 2).join(".");
                    distribution[patch] = (distribution[patch] || 0) + 1;
                } else {
                    if (index < 5) console.log("Missing gameVersion in row:", index, JSON.stringify(detail).substring(0, 100));
                }
            } catch (e) {
                if (index < 5) console.error("Parse error in row:", index, e.message);
            }
        });
        
        console.log("Match Patch Distribution:");
        console.table(distribution);
        
        Database.close();
    } catch (error) {
        console.error("Error checking patches:", error);
    }
}

checkPatchDistribution();
