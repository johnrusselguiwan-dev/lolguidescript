/**
 * Rune mapper — mirrors the Kotlin RuneMapper logic from the Android app.
 * Transforms DDragon runesReforged.json into domain RuneTree objects.
 */

const RUNE_ASSET_URL = "https://ddragon.leagueoflegends.com/cdn/img/";

function getRuneImage(iconPath) {
    // DDragon already provides relative paths like "perk-images/Styles/..."
    return `${RUNE_ASSET_URL}${iconPath}`;
}

/**
 * Maps a single RuneTreeDto into a domain RuneTree.
 */
function mapRuneTree(treeDto) {
    return {
        id: treeDto.id,
        key: treeDto.key,
        name: treeDto.name,
        icon: getRuneImage(treeDto.icon),
        slots: (treeDto.slots || []).map((slot, slotIndex) => ({
            slotIndex,
            runes: (slot.runes || []).map((rune, runeIndex) => ({
                id: rune.id,
                key: rune.key,
                name: rune.name,
                icon: getRuneImage(rune.icon),
                shortDesc: rune.shortDesc || "",
                longDesc: rune.longDesc || "",
                runeIndex,
            })),
        })),
    };
}

/**
 * Maps the full DDragon runesReforged array into domain RuneTree list.
 */
function mapRuneTrees(runesReforgedArray) {
    return runesReforgedArray.map(mapRuneTree);
}

module.exports = { mapRuneTrees };
