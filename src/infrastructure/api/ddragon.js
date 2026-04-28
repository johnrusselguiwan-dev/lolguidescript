/**
 * Data Dragon API client — all HTTP calls to Riot's public CDN.
 *
 * Docs: https://developer.riotgames.com/docs/lol#data-dragon
 */

const axios = require("axios");

const BASE_URL = "https://ddragon.leagueoflegends.com/cdn";
const LANGUAGE = "en_US";

const api = {
    /** Returns the latest patch version string, e.g. "15.8.1" */
    getVersion: async () => {
        const res = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json");
        return res.data[0];
    },

    /** Returns the champion list object keyed by champion ID */
    getChampionList: async (version) => {
        const res = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion.json`);
        return res.data.data;
    },

    /** Returns the full champion detail for a single champion */
    getChampionDetail: async (version, id) => {
        const res = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/champion/${id}.json`);
        return res.data.data[id];
    },

    /** Returns the raw item data map (id → ItemDto) */
    getItemList: async (version) => {
        const res = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/item.json`);
        return res.data.data;
    },

    /** Returns the array of rune tree DTOs */
    getRuneTrees: async (version) => {
        const res = await axios.get(`${BASE_URL}/${version}/data/${LANGUAGE}/runesReforged.json`);
        return res.data;
    },

    /** Fetches the latest patch realm info dynamically */
    getRealm: async (realmUrl) => {
        const res = await axios.get(realmUrl);
        return res.data;
    },

    /** Fetches a generic JSON asset from the provided URL, with error catching */
    getAsset: async (url) => {
        try {
            const res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (error) {
            console.error(`[API Error] Failed to fetch asset from ${url}:`, error.message);
            throw error;
        }
    }
};

module.exports = { api, BASE_URL, LANGUAGE };
