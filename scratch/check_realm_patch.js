const { DDRAGON } = require("../config/constants");

async function checkCurrentPatch() {
    try {
        const res = await fetch(DDRAGON.REALM_URL);
        const realm = await res.json();
        const currentPatch = realm.v.split(".").slice(0, 2).join(".");
        console.log("DDragon Realm Version:", realm.v);
        console.log("Calculated currentPatch:", currentPatch);
    } catch (error) {
        console.error("Error fetching realm:", error.message);
    }
}

checkCurrentPatch();
