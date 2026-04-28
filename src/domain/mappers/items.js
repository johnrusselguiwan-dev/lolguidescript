/**
 * Item mapper — mirrors the Kotlin ItemMapper logic from the Android app.
 * Filters out invalid / removed / hidden items and normalises each entry
 * into the same domain shape used by the mobile client.
 */

const ARAM_MAP_ID = "12";
const ARENA_MAP_ID = "30";
const SUMMONERS_RIFT_MAP_ID = "11";
const ACTIVE_MAP_IDS = new Set([SUMMONERS_RIFT_MAP_ID, ARAM_MAP_ID, ARENA_MAP_ID]);

const REMOVED_ITEM_MARKER = "This item has been removed";
const ARAM_TAG = " (ARAM)";
const ARENA_TAG = " (Arena)";

// Items that should always pass the filter (e.g. Ornn upgrades, distributed items)
const DISTRIBUTED_ITEM_WHITELIST = [
    "Ornn", // Ornn Masterwork items
];

// ── helpers ──────────────────────────────────────────────────────────────────

function getItemImage(version, imageName) {
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${imageName}`;
}

function isValidItem(dto) {
    const { name, description, gold, maps, hideFromAll, requiredChampion } = dto;

    if (!name || !name.trim()) return false;

    const isAlwaysAllowed = DISTRIBUTED_ITEM_WHITELIST.some(w =>
        name.toLowerCase().includes(w.toLowerCase())
    );
    const isAvailableInActiveMode = maps
        ? Object.entries(maps).some(([id, active]) => active === true && ACTIVE_MAP_IDS.has(id))
        : false;
    const isRemoved = description
        ? description.toLowerCase().includes(REMOVED_ITEM_MARKER.toLowerCase())
        : false;
    const isFreeNonPurchasable =
        gold && gold.total === 0 && gold.purchasable === false;

    if (isAlwaysAllowed) return !isRemoved;
    if (hideFromAll === true) return false;
    if (!isAvailableInActiveMode) return false;
    if (isRemoved) return false;
    if (isFreeNonPurchasable) return !!requiredChampion;
    return true;
}

function toDomainItem(id, dto, version) {
    const imageName = dto.image ? dto.image.full : "";
    const cleanRawName = (dto.name || "")
        .replace(ARAM_TAG, "")
        .replace(ARENA_TAG, "")
        .trim();

    const isSR = dto.maps && dto.maps[SUMMONERS_RIFT_MAP_ID] === true;
    const isARAM = dto.maps && dto.maps[ARAM_MAP_ID] === true;
    const isArena = dto.maps && dto.maps[ARENA_MAP_ID] === true;

    let finalName;
    if (isArena && !isSR) {
        finalName = cleanRawName + ARENA_TAG;
    } else if (isARAM && !isSR && !isArena) {
        finalName = cleanRawName + ARAM_TAG;
    } else {
        finalName = cleanRawName;
    }

    return {
        id,
        name: finalName,
        shortDesc: dto.plaintext || "",
        description: dto.description || "",
        icon: imageName ? getItemImage(version, imageName) : "",
        totalCost: (dto.gold && dto.gold.total) || 0,
        sellCost: (dto.gold && dto.gold.sell) || 0,
        tags: dto.tags || [],
        stats: dto.description || "",
        depth: dto.depth || 0,
        from: dto.from || [],
        into: dto.into || [],
        maps: dto.maps || {},
        requiredChampion: dto.requiredChampion || "",
    };
}

// ── main entry point ────────────────────────────────────────────────────────

/**
 * Converts the raw DDragon item.json `data` map into a filtered, deduplicated
 * list of domain items — exactly the same logic as the Kotlin `toDomainItems()`.
 */
function mapItemList(rawData, version) {
    // 1. Filter + map
    const mapped = Object.entries(rawData)
        .filter(([, dto]) => isValidItem(dto))
        .map(([id, dto]) => toDomainItem(id, dto, version));

    // 2. Deduplicate by base-name (prefer SR, then ARAM-only, then first)
    const groups = {};
    for (const item of mapped) {
        const baseName = item.name
            .replace(ARAM_TAG, "")
            .replace(ARENA_TAG, "")
            .trim();
        if (!groups[baseName]) groups[baseName] = [];
        groups[baseName].push(item);
    }

    const deduped = [];
    for (const group of Object.values(groups)) {
        const srVersion = group.find(i => i.maps[SUMMONERS_RIFT_MAP_ID] === true);
        const pureAram = group.find(
            i => i.maps[ARAM_MAP_ID] === true && i.maps[SUMMONERS_RIFT_MAP_ID] !== true
        );

        if (srVersion) {
            deduped.push(srVersion);
        } else if (pureAram) {
            deduped.push(pureAram);
        } else {
            deduped.push(group[0]);
        }
    }

    return deduped;
}

module.exports = { mapItemList };
