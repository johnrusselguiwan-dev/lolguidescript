/**
 * Item data service — fetches and processes item data from Data Dragon.
 */

const { api } = require("../infrastructure/api/ddragon");
const { mapItemList } = require("../domain/mappers/items");
const { printSuccess } = require("../presentation/cli-utils");

async function fetchAndProcessItems(version) {
    const rawItems = await api.getItemList(version);
    const items = mapItemList(rawItems, version);
    printSuccess(`Processed ${items.length} valid items`);
    return items;
}

module.exports = { fetchAndProcessItems };
