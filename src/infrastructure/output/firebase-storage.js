/**
 * Firebase output handler — all Firestore upload logic lives here.
 */

const { db, admin } = require("../../../config/firebase");
const Logger = require("../utils/logger");
const { validateDataset, validateTierData, assertSameIds } = require("../../domain/validation/validate");

const COLLECTIONS = {
    STAGING: "staging_data",
    PRODUCTION: "data",
};

const DEFAULT_COLLECTION = COLLECTIONS.STAGING;

function resolveCollection(targetCollection) {
    if (targetCollection && typeof targetCollection === "object" && !Array.isArray(targetCollection)) {
        targetCollection = targetCollection.targetCollection || targetCollection.collection;
    }
    if (typeof targetCollection === "string") {
        const trimmed = targetCollection.trim();
        if (trimmed === "data" || trimmed === COLLECTIONS.PRODUCTION) {
            return COLLECTIONS.PRODUCTION;
        }
        if (trimmed === "staging_data" || trimmed === COLLECTIONS.STAGING) {
            return COLLECTIONS.STAGING;
        }
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return DEFAULT_COLLECTION;
}

// Maps each upload type to the Remote Config version fields it should bump
const RC_FIELD_MAP = {
    champions: ["champion_list_version", "champion_detail_version"],
    items: ["item_list_version"],
    runes: ["rune_list_version"],
    spells: ["spell_list_version"],
    tierData: ["champion_rating_version", "draft_master_version"],
};

async function uploadChampions(championData, patchVersion, targetCollection = DEFAULT_COLLECTION) {
    if (!Array.isArray(championData) || championData.length === 0) {
        throw new Error("champions: expected a non-empty array");
    }
    const collectionName = resolveCollection(targetCollection);
    const listEntries = championData.map((item) => item.listEntry);
    const detailEntries = championData.map((item) => item.detailEntry);

    validateDataset("champion_list", listEntries);
    validateDataset("champion_details", detailEntries);
    assertSameIds(listEntries, detailEntries, "champions");
    const batch = db.batch();

    batch.set(db.collection(collectionName).doc("champion_list"), {
        json: JSON.stringify(listEntries),
    });

    batch.set(db.collection(collectionName).doc("champion_details"), {
        json: JSON.stringify(detailEntries),
    });

    batch.set(db.collection("system_metadata").doc("patch_info"), {
        latestPatch: patchVersion,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    Logger.success(`Champions uploaded to Firebase [${collectionName}]`);
    return { rcFields: RC_FIELD_MAP.champions, patch: patchVersion, targetCollection: collectionName };
}

async function uploadItems(items, patchVersion, targetCollection = DEFAULT_COLLECTION) {
    validateDataset("item_list", items);
    const collectionName = resolveCollection(targetCollection);
    const batch = db.batch();

    batch.set(db.collection(collectionName).doc("item_list"), {
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
    Logger.success(`${items.length} items uploaded to Firebase [${collectionName}]`);
    return { rcFields: RC_FIELD_MAP.items, patch: patchVersion, targetCollection: collectionName };
}

async function uploadRunes(runeTrees, patchVersion, targetCollection = DEFAULT_COLLECTION) {
    validateDataset("rune_trees", runeTrees);
    const collectionName = resolveCollection(targetCollection);
    const batch = db.batch();

    batch.set(db.collection(collectionName).doc("rune_trees"), {
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
    Logger.success(`${runeTrees.length} rune trees uploaded to Firebase [${collectionName}]`);
    return { rcFields: RC_FIELD_MAP.runes, patch: patchVersion, targetCollection: collectionName };
}

async function uploadSpells(spells, patchVersion, targetCollection = DEFAULT_COLLECTION) {
    validateDataset("summoner_spells", spells);
    const collectionName = resolveCollection(targetCollection);
    const batch = db.batch();

    batch.set(db.collection(collectionName).doc("summoner_spells"), {
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
    Logger.success(`${spells.length} summoner spells uploaded to Firebase [${collectionName}]`);
    return { rcFields: RC_FIELD_MAP.spells, patch: patchVersion, targetCollection: collectionName };
}

/**
 * Upload champion tier data to Firebase.
 * @param {Array} meta - Champion meta data
 * @param {Array} rating - Champion rating data
 * @param {Array} drafting - Champion drafting/matchup data
 * @param {Array} scaling - Champion scaling/power spike data
 * @param {string|object|null} regionOrOptions - Region filter (e.g. "SEA", "Asia", null = global) or options object
 * @param {string} [maybeTargetCollection] - Target Firestore collection ("staging_data" or "data"). Default: "staging_data".
 */
async function uploadTierData(meta, rating, drafting, scaling, regionOrOptions = null, maybeTargetCollection = DEFAULT_COLLECTION) {
    let region = null;
    let targetCollection = DEFAULT_COLLECTION;

    if (regionOrOptions && typeof regionOrOptions === "object" && !Array.isArray(regionOrOptions)) {
        region = regionOrOptions.region || null;
        targetCollection = regionOrOptions.targetCollection || regionOrOptions.collection || DEFAULT_COLLECTION;
    } else {
        region = regionOrOptions || null;
        targetCollection = maybeTargetCollection;
    }

    validateTierData(meta, rating, drafting, scaling, region);
    const collectionName = resolveCollection(targetCollection);

    // Extract patch info from the data (if available)
    const sampleEntry = (meta && meta.length > 0) ? meta[0] : null;
    const dataPatch = sampleEntry?.patch || "unknown";
    const isFallback = sampleEntry?.isFallback || false;

    // Region suffix for document names (e.g. "_sea", "_asia", or "" for global)
    const isRegionFiltered = region && region !== "all";
    const suffix = isRegionFiltered ? `_${region.toLowerCase()}` : "";
    const regionLabel = isRegionFiltered ? region : "Global";

    const batch = db.batch();

    batch.set(db.collection(collectionName).doc(`champion_meta${suffix}`), {
        json: JSON.stringify(meta),
    });

    batch.set(db.collection(collectionName).doc(`champion_rating${suffix}`), {
        json: JSON.stringify(rating),
    });

    batch.set(db.collection(collectionName).doc(`champion_drafting${suffix}`), {
        json: JSON.stringify(drafting),
    });

    if (scaling && Object.keys(scaling).length > 0) {
        batch.set(db.collection(collectionName).doc(`champion_scaling${suffix}`), {
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
    Logger.success(`Champion data uploaded to Firebase [${regionLabel}] (${collectionName}) (Patch: ${dataPatch}${isFallback ? " [FALLBACK]" : ""})`);
    return { rcFields: RC_FIELD_MAP.tierData, patch: dataPatch, region: regionLabel, targetCollection: collectionName };
}

module.exports = {
    uploadChampions,
    uploadItems,
    uploadRunes,
    uploadSpells,
    uploadTierData,
    RC_FIELD_MAP,
    COLLECTIONS,
    DEFAULT_COLLECTION,
    resolveCollection,
};
