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
    },

    /** Returns the full community dragon champion detail (useful for playstyleInfo) */
    getChampionDetail: async (id) => {
        try {
            const res = await axios.get(`${BASE_URL}/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/${id}.json`);
            return res.data;
        } catch (error) {
            console.error(`[CDragon API Error] Failed to fetch champion ${id}:`, error.message);
            return null;
        }
    }
};

module.exports = { cdragon, BASE_URL };
