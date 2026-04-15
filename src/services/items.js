/**
 * Item data service — fetches and processes item data from Data Dragon.
 */

const { api } = require("../api/ddragon");
const { mapItemList } = require("../mappers/items");
const { printSuccess } = require("../utils/cli");

async function fetchAndProcessItems(version) {
    const rawItems = await api.getItemList(version);
    const items = mapItemList(rawItems, version);
    printSuccess(`Processed ${items.length} valid items`);
    return items;
}

module.exports = { fetchAndProcessItems };
