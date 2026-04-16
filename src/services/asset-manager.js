/**
 * Asset manager — fetches Data Dragon assets (champions, items, summoner
 * spells, runes) and builds the lookup maps used by the analytics engine.
 *
 * Results are cached to disk under data/assets/ to avoid redundant downloads.
 */

const path = require("path");
const { DDRAGON, STORAGE } = require("../../config/constants");
const { readJson, writeJson } = require("../utils/io");
const Logger = require("../utils/logger");

class AssetManager {
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
        Logger.info("Updating Data Dragon Assets...");

        const realm = await (await fetch(DDRAGON.REALM_URL)).json();
        const v = realm.v;
        const base = `${DDRAGON.BASE_URL}/${v}/data/en_US`;

        const fetchCache = async (name, url) => {
            const cachePath = path.join(STORAGE.ASSETS, `${name}_${v}.json`);
            let data = await readJson(cachePath);
            if (!data) {
                data = await (await fetch(url)).json();
                await writeJson(cachePath, data);
            }
            return data;
        };

        const [champs, items, spells, runes] = await Promise.all([
            fetchCache("champions", `${base}/champion.json`),
            fetchCache("items", `${base}/item.json`),
            fetchCache("summoners", `${base}/summoner.json`),
            fetchCache("runes", `${base}/runesReforged.json`),
        ]);

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

        return {
            champMap,
            itemData: items.data,
            spellMap,
            perkMap,
            styleMap,
            champData: champs.data,
            ddragonVersion: v,
        };
    }
}

module.exports = AssetManager;
