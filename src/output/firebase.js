/**
 * Firebase output handler — all Firestore upload logic lives here.
 */

const { db, admin } = require("../../config/firebase");
const { printSuccess } = require("../utils/cli");

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
    printSuccess("Champions uploaded to Firebase");
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
    printSuccess(`${items.length} items uploaded to Firebase`);
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
    printSuccess(`${runeTrees.length} rune trees uploaded to Firebase`);
}

module.exports = { uploadChampions, uploadItems, uploadRunes };
