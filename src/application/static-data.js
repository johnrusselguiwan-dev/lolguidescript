/**
 * Static data extractor — fetches items and runes from Data Dragon,
 * applies the same filter/grouping logic as the Kotlin Android app,
 * and writes ITEMS_SUMMARY.json + RUNES_SUMMARY.json.
 */

const { DDRAGON, STORAGE } = require("../../config/constants");
const { api } = require("../infrastructure/api/ddragon");
const { writeJson } = require("../infrastructure/utils/io");
const Logger = require("../infrastructure/utils/logger");

const DISTRIBUTED_ITEM_WHITELIST = [];
const ACTIVE_MAP_IDS = ["11", "12", "30"];
const REMOVED_ITEM_MARKER = "This item has been removed";

class StaticDataExtractor {
    static async extractAndSave() {
        Logger.info("Fetching and extracting DDragon Static Data (Items & Runes)...");

        const realm = await api.getRealm(DDRAGON.REALM_URL);
        const v = realm.v;

        const itemMap = await api.getItemList(v);
        const runesRaw = await api.getRuneTrees(v);

        // ── Process Items (matching Kotlin logic) ───────────────────────
        const groupedItems = {};

        for (const [id, dto] of Object.entries(itemMap)) {
            if (!dto.name || dto.name.trim() === "") continue;

            const isAlwaysAllowed = DISTRIBUTED_ITEM_WHITELIST.some((w) =>
                dto.name.toLowerCase().includes(w.toLowerCase())
            );
            const isAvailableInActiveMode = dto.maps
                ? Object.entries(dto.maps).some(([mId, active]) => active && ACTIVE_MAP_IDS.includes(mId))
                : false;
            const isRemoved =
                dto.description &&
                dto.description.toLowerCase().includes(REMOVED_ITEM_MARKER.toLowerCase());
            const isFreeNonPurchasable = dto.gold?.total === 0 && dto.gold?.purchasable === false;

            let isValid = true;
            if (isAlwaysAllowed) {
                isValid = !isRemoved;
            } else if (dto.hideFromAll) {
                isValid = false;
            } else if (!isAvailableInActiveMode) {
                isValid = false;
            } else if (isRemoved) {
                isValid = false;
            } else if (isFreeNonPurchasable) {
                isValid = !!dto.requiredChampion;
            }

            if (!isValid) continue;

            const cleanRawName = dto.name.replace(" (ARAM)", "").replace(" (Arena)", "").trim();
            const isSR = dto.maps?.["11"] === true;
            const isARAM = dto.maps?.["12"] === true;
            const isArena = dto.maps?.["30"] === true;

            let finalName = cleanRawName;
            if (isArena && !isSR) finalName = `${cleanRawName} (Arena)`;
            else if (isARAM && !isSR && !isArena) finalName = `${cleanRawName} (ARAM)`;

            const itemDomain = {
                id,
                name: finalName,
                shortDesc: dto.plaintext || "",
                description: dto.description || "",
                icon: dto.image?.full
                    ? `${DDRAGON.BASE_URL}/${v}/img/item/${dto.image.full}`
                    : "",
                totalCost: dto.gold?.total || 0,
                sellCost: dto.gold?.sell || 0,
                tags: dto.tags || [],
                stats: dto.description || "",
                depth: dto.depth || 0,
                from: dto.from || [],
                into: dto.into || [],
                maps: dto.maps || {},
                requiredChampion: dto.requiredChampion || "",
            };

            const groupKey = dto.name.replace(" (ARAM)", "").replace(" (Arena)", "").trim();
            if (!groupedItems[groupKey]) groupedItems[groupKey] = [];
            groupedItems[groupKey].push(itemDomain);
        }

        // Resolve groups — prefer SR, then ARAM-only, then first
        const mappedItems = [];
        for (const group of Object.values(groupedItems)) {
            const srVersion = group.find((i) => i.maps["11"] === true);
            const pureAramVersion = group.find(
                (i) => i.maps["12"] === true && i.maps["11"] !== true
            );

            if (srVersion) mappedItems.push(srVersion);
            else if (pureAramVersion) mappedItems.push(pureAramVersion);
            else mappedItems.push(group[0]);
        }

        // ── Process Runes (matching Kotlin logic) ───────────────────────
        const mappedRunes = runesRaw.map((treeDto) => ({
            id: treeDto.id,
            key: treeDto.key,
            name: treeDto.name,
            icon: `${DDRAGON.BASE_URL}/img/${treeDto.icon}`,
            slots: treeDto.slots.map((slotDto) => ({
                runes: slotDto.runes.map((runeDto) => ({
                    id: runeDto.id,
                    key: runeDto.key,
                    name: runeDto.name,
                    icon: `${DDRAGON.BASE_URL}/img/${runeDto.icon}`,
                    shortDesc: runeDto.shortDesc,
                    longDesc: runeDto.longDesc,
                })),
            })),
        }));

        await writeJson(STORAGE.ITEMS_SUMMARY, mappedItems);
        await writeJson(STORAGE.RUNES_SUMMARY, mappedRunes);

        Logger.success(
            `Saved ITEMS_SUMMARY.json (${mappedItems.length} items) and RUNES_SUMMARY.json (${mappedRunes.length} trees)`
        );
    }
}

module.exports = StaticDataExtractor;
