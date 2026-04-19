const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/Joro/Documents/Programs/lolguidescript/data/assets/items_16.8.1.json'));
for (const id in data.data) {
  if (data.data[id].name === "Mercury's Treads" && !Object.values(data.data[id].tags || {}).includes('Boots')) {
    console.log('FOUND:', id, data.data[id]);
  }
}
