const admin = require("firebase-admin");

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
        console.error("❌ Error: Invalid FIREBASE_SERVICE_ACCOUNT environment variable. Must be valid JSON.");
        process.exit(1);
    }
} else {
    try {
        serviceAccount = require("../league-of-legends-guide-202602-firebase-adminsdk-fbsvc-7f51437389.json");
    } catch (e) {
        console.error("❌ Error: Firebase Service Account file not found locally and FIREBASE_SERVICE_ACCOUNT env var is missing.");
        process.exit(1);
    }
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

module.exports = { db, admin };
