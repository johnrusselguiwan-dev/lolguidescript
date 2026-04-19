const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/Joro/Documents/Programs/lolguidescript/data/assets/items_16.8.1.json'));
for (const id in data.data) {
  if (data.data[id].name.includes('Mercury')) {
    console.log(id, data.data[id].name, data.data[id].tags);
  }
}
