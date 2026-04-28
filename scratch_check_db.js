const Database = require("./src/services/database");
const { RANK_HIERARCHY } = require("./config/constants");

async function check() {
    await Database.connect();
    const patches = await Database.getDistinctPatches();
    console.log("Patches in DB:");
    console.table(patches);

    let total = 0;
    for (const rank of RANK_HIERARCHY) {
        const count = await Database.getMatchCountForRank(rank.tier, rank.division);
        total += count;
    }
    console.log("Total matches in DB:", total);
    process.exit(0);
}

check();
