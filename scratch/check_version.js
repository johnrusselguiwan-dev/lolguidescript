const { api } = require("../src/api/ddragon");

async function testVersion() {
    try {
        const version = await api.getVersion();
        console.log("Latest version from Data Dragon:", version);
    } catch (error) {
        console.error("Error fetching version:", error.message);
    }
}

testVersion();
