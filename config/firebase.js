const admin = require("firebase-admin");
const serviceAccount = require("../league-of-legends-guide-202602-firebase-adminsdk-fbsvc-7f51437389.json");

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

module.exports = { db, admin };
