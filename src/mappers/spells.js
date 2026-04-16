/**
 * Summoner Spell mapper
 */

function getSpellImage(iconPath) {
    if (!iconPath) return "";
    const lowerPath = iconPath.toLowerCase();
    return lowerPath.replace(
        "/lol-game-data/assets/",
        "https://raw.communitydragon.org/13.24/plugins/rcp-be-lol-game-data/global/default/"
    );
}

const ALLOWED_SPELLS = new Set([
    "barrier",
    "cleanse",
    "flash",
    "flee",
    "ghost",   // user typo'd as hsot
    "ignite",
    "exhaust",
    "heal",
    "clarity",
    "to the king!",
    "poro toss",
    "smite",
    "mark",
    "teleport"
]);

function mapSpellList(rawSpells) {
    return rawSpells
        .filter(spell => spell.name && ALLOWED_SPELLS.has(spell.name.toLowerCase()))
        .map(spell => ({
            id: String(spell.id),
            name: spell.name,
            description: spell.description,
            cooldown: String(spell.cooldown),
            imageUrl: getSpellImage(spell.iconPath)
        }));
}

module.exports = { mapSpellList };
