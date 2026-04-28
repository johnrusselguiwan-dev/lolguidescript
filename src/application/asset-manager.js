/**
 * Asset manager — fetches Data Dragon assets (champions, items, summoner
 * spells, runes) and builds the lookup maps used by the analytics engine.
 *
 * Results are cached to disk under data/assets/ to avoid redundant downloads.
 */

const path = require("path");
const { DDRAGON, STORAGE } = require("../../config/constants");
const { api } = require("../infrastructure/api/ddragon");
const { readJson, writeJson } = require("../infrastructure/utils/io");
const Logger = require("../infrastructure/utils/logger");

class AssetManager {
    /**
     * Cache for the current session to avoid repeated network checks to DDragon.
     */
    static cached = null;

    /**
     * Fetches (or loads from cache) all Data Dragon assets and returns
     * convenient lookup maps.
     *
     * @returns {Promise<{
     *   champMap: Object, champData: Object, itemData: Object,
     *   spellMap: Object, perkMap: Object, styleMap: Object,
     *   ddragonVersion: string
     * }>}
     */
    static async getAssets() {
        if (this.cached) return this.cached;

        let realm;
        try {
            realm = await api.getRealm(DDRAGON.REALM_URL);
        } catch (err) {
            Logger.error("Failed to fetch DDragon Realm. Check network connection.");
            throw err;
        }

        const v = realm.v;
        const base = `${DDRAGON.BASE_URL}/${v}/data/en_US`;

        const fetchCache = async (name, url) => {
            const cachePath = path.join(STORAGE.ASSETS, `${name}_${v}.json`);
            let data = await readJson(cachePath);
            if (!data) {
                Logger.info(`Downloading new LoL Patch Assets (${v}): ${name}...`);
                data = await api.getAsset(url);
                await writeJson(cachePath, data);
            }
            return data;
        };

        let champs, items, spells, runes;
        try {
            [champs, items, spells, runes] = await Promise.all([
                fetchCache("champions", `${base}/champion.json`),
                fetchCache("items", `${base}/item.json`),
                fetchCache("summoners", `${base}/summoner.json`),
                fetchCache("runes", `${base}/runesReforged.json`),
            ]);
        } catch (e) {
            Logger.error("Critical error while downloading base assets: " + e.message);
            throw new Error("ASSET_DOWNLOAD_FAILED");
        }

        const champMap = {};
        const spellMap = {};
        const perkMap = {};
        const styleMap = {};

        Object.values(champs.data).forEach((c) => (champMap[c.key] = c.id));
        Object.values(spells.data).forEach((s) => (spellMap[s.key] = s.name));
        runes.forEach((style) => {
            styleMap[style.id] = style.name;
            style.slots.forEach((slot) =>
                slot.runes.forEach((r) => (perkMap[r.id] = r.name))
            );
        });

        this.cached = {
            champMap,
            itemData: items.data,
            spellMap,
            perkMap,
            styleMap,
            champData: champs.data,
            ddragonVersion: v,
        };

        return this.cached;
    }
}

module.exports = AssetManager;
