/**
 * Rune data service — fetches and processes rune data from Data Dragon.
 */

const { api } = require("../infrastructure/api/ddragon");
const { mapRuneTrees } = require("../domain/mappers/runes");
const { printSuccess } = require("../presentation/cli-utils");

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
