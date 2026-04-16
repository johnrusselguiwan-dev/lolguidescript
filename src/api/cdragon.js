/**
 * Community Dragon API client
 */

const axios = require("axios");

const BASE_URL = "https://raw.communitydragon.org";

const cdragon = {
    /** Returns summoner spells using the specific 13.24 version for richer descriptions */
    getSpells: async () => {
        const res = await axios.get(`${BASE_URL}/13.24/plugins/rcp-be-lol-game-data/global/default/v1/summoner-spells.json`);
        return res.data;
    }
};

module.exports = { cdragon, BASE_URL };
