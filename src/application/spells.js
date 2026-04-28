/**
 * Summoner Spells data service
 */

const { cdragon } = require("../infrastructure/api/cdragon");
const { mapSpellList } = require("../domain/mappers/spells");
const { printSuccess } = require("../presentation/cli-utils");

async function fetchAndProcessSpells() {
    const rawSpells = await cdragon.getSpells();
    const spells = mapSpellList(rawSpells);
    printSuccess(`Processed ${spells.length} valid summoner spells`);
    return spells;
}

module.exports = { fetchAndProcessSpells };
