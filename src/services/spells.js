/**
 * Summoner Spells data service
 */

const { cdragon } = require("../api/cdragon");
const { mapSpellList } = require("../mappers/spells");
const { printSuccess } = require("../utils/cli");

async function fetchAndProcessSpells() {
    const rawSpells = await cdragon.getSpells();
    const spells = mapSpellList(rawSpells);
    printSuccess(`Processed ${spells.length} valid summoner spells`);
    return spells;
}

module.exports = { fetchAndProcessSpells };
