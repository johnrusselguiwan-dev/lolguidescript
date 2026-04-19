const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/Joro/Documents/Programs/lolguidescript/data/assets/items_16.8.1.json'));
const s_items = { '3111': 10, '3047': 20, '3153': 5 };
const assets = { itemData: data.data };
const rawItems = Object.entries(s_items).sort((a, b) => b[1] - a[1]);
const isBoots = (itemId) => Object.values(assets.itemData[itemId]?.tags || {}).includes('Boots');
const sortedOtherItems = rawItems.filter(i => !isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
console.log(sortedOtherItems);
