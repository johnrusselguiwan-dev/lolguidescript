/**
 * Firebase output handler — all Firestore upload logic lives here.
 */

const { db, admin } = require("../../../config/firebase");
const Logger = require("../utils/logger");

// Maps each upload type to the Remote Config version fields it should bump
const RC_FIELD_MAP = {
    champions: ["champion_list_version", "champion_detail_version"],
    items: ["item_list_version"],
    runes: ["rune_list_version"],
    spells: ["spell_list_version"],
    tierData: ["champion_rating_version", "draft_master_version"],
};

async function uploadChampions(championData, patchVersion) {
    const listEntries = championData.map((item) => item.listEntry);
    const detailEntries = championData.map((item) => item.detailEntry);

    const batch = db.batch();

    batch.set(db.collection("data").doc("champion_list"), {
        json: JSON.stringify(listEntries),
    });

    batch.set(db.collection("data").doc("champion_details"), {
        json: JSON.stringify(detailEntries),
    });

    batch.set(db.collection("system_metadata").doc("patch_info"), {
        latestPatch: patchVersion,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    Logger.success("Champions uploaded to Firebase");
    return { rcFields: RC_FIELD_MAP.champions, patch: patchVersion };
}

async function uploadItems(items, patchVersion) {
    const batch = db.batch();

    batch.set(db.collection("data").doc("item_list"), {
        json: JSON.stringify(items),
    });

    batch.set(
        db.collection("system_metadata").doc("patch_info"),
        {
            latestPatch: patchVersion,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    await batch.commit();
    Logger.success(`${items.length} items uploaded to Firebase`);
    return { rcFields: RC_FIELD_MAP.items, patch: patchVersion };
}

async function uploadRunes(runeTrees, patchVersion) {
    const batch = db.batch();

    batch.set(db.collection("data").doc("rune_trees"), {
        json: JSON.stringify(runeTrees),
    });

    batch.set(
        db.collection("system_metadata").doc("patch_info"),
        {
            latestPatch: patchVersion,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    await batch.commit();
    Logger.success(`${runeTrees.length} rune trees uploaded to Firebase`);
    return { rcFields: RC_FIELD_MAP.runes, patch: patchVersion };
}

async function uploadSpells(spells, patchVersion) {
    const batch = db.batch();

    batch.set(db.collection("data").doc("summoner_spells"), {
        json: JSON.stringify(spells),
    });

    batch.set(
        db.collection("system_metadata").doc("patch_info"),
        {
            latestPatch: patchVersion,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    await batch.commit();
    Logger.success(`${spells.length} summoner spells uploaded to Firebase`);
    return { rcFields: RC_FIELD_MAP.spells, patch: patchVersion };
}

/**
 * Upload champion tier data to Firebase.
 * @param {Array} meta - Champion meta data
 * @param {Array} rating - Champion rating data
 * @param {Array} drafting - Champion drafting/matchup data
 * @param {Array} scaling - Champion scaling/power spike data
 * @param {string|null} region - Region filter (e.g. "SEA", "Asia"). null = global.
 */
async function uploadTierData(meta, rating, drafting, scaling, region = null) {
    // Extract patch info from the data (if available)
    const sampleEntry = (meta && meta.length > 0) ? meta[0] : null;
    const dataPatch = sampleEntry?.patch || "unknown";
    const isFallback = sampleEntry?.isFallback || false;

    // Region suffix for document names (e.g. "_sea", "_asia", or "" for global)
    const isRegionFiltered = region && region !== "all";
    const suffix = isRegionFiltered ? `_${region.toLowerCase()}` : "";
    const regionLabel = isRegionFiltered ? region : "Global";

    const batch = db.batch();

    batch.set(db.collection("data").doc(`champion_meta${suffix}`), {
        json: JSON.stringify(meta),
    });

    batch.set(db.collection("data").doc(`champion_rating${suffix}`), {
        json: JSON.stringify(rating),
    });

    batch.set(db.collection("data").doc(`champion_drafting${suffix}`), {
        json: JSON.stringify(drafting),
    });

    if (scaling && Object.keys(scaling).length > 0) {
        batch.set(db.collection("data").doc(`champion_scaling${suffix}`), {
            json: JSON.stringify(scaling),
        });
    }

    batch.set(
        db.collection("system_metadata").doc("patch_info"),
        {
            dataPatch,
            isFallback,
            [`lastUpdated${suffix}`]: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    await batch.commit();
    Logger.success(`Champion data uploaded to Firebase [${regionLabel}] (Patch: ${dataPatch}${isFallback ? " [FALLBACK]" : ""})`);
    return { rcFields: RC_FIELD_MAP.tierData, patch: dataPatch, region: regionLabel };
}

module.exports = { uploadChampions, uploadItems, uploadRunes, uploadSpells, uploadTierData, RC_FIELD_MAP };
