/**
 * Rune data service — fetches and processes rune data from Data Dragon.
 */

const { api } = require("../api/ddragon");
const { mapRuneTrees } = require("../mappers/runes");
const { printSuccess } = require("../utils/cli");

async function fetchAndProcessRunes(version) {
    const rawRunes = await api.getRuneTrees(version);
    const runeTrees = mapRuneTrees(rawRunes);
    const totalRunes = runeTrees.reduce(
        (sum, tree) => sum + tree.slots.reduce((s, slot) => s + slot.runes.length, 0),
        0
    );
    printSuccess(`Processed ${runeTrees.length} rune trees (${totalRunes} runes total)`);
    return runeTrees;
}

module.exports = { fetchAndProcessRunes };
