const rawItems = [['3047', 10], ['3111', 8], ['1001', 5], ['A', 9], ['B', 8], ['C', 7], ['D', 6], ['E', 5], ['F', 4], ['G', 3], ['H', 2]];
const assets = { itemData: { '3047': {name: 'Plated', tags:['Boots']}, '3111': {name: 'Mercs', tags:['Boots']}, '1001': {name: 'Swifties', tags:['Boots']}, 'A': {name: 'A'}, 'B': {name: 'B'}, 'C': {name:'C'}, 'D':{name:'D'}, 'E':{name:'E'}, 'F':{name:'F'}, 'G':{name:'G'}, 'H':{name:'H'} }};
const isBoots = (itemId) => Object.values(assets.itemData[itemId]?.tags || {}).includes('Boots');
const allBoots = rawItems.filter(i => isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
const nonBoots = rawItems.filter(i => !isBoots(i[0])).map(i => assets.itemData[i[0]]?.name).filter(Boolean);
const bootsName = allBoots[0] || null;
let nonBootsIndex = 0;
let bootsIndex = 1;
const makeBuild = () => {
  const items = nonBoots.slice(nonBootsIndex, nonBootsIndex + 5);
  nonBootsIndex += 5;
  const spareItems = [];
  if (bootsIndex < allBoots.length) {
    spareItems.push(allBoots[bootsIndex]);
    bootsIndex++;
  }
  if (nonBootsIndex < nonBoots.length) {
    spareItems.push(nonBoots[nonBootsIndex]);
    nonBootsIndex++;
  }
  if (spareItems.length < 2 && nonBootsIndex < nonBoots.length) {
    spareItems.push(nonBoots[nonBootsIndex]);
    nonBootsIndex++;
  }
  return { boots: bootsName, items, spareItems };
};
console.log(JSON.stringify([makeBuild(), makeBuild()], null, 2));
