const fs = require('fs');

const drafting = JSON.parse(fs.readFileSync('./data/outputs/champions_drafting.json'));

const optimized = [];

for (const champ of drafting) {
    const optChamp = {
        id: champ.id,
        drafting: {
            strongAgainst: [],
            weakAgainst: [],
            synergizesWith: []
        }
    };

    if (champ.drafting.strongAgainst) {
        optChamp.drafting.strongAgainst = champ.drafting.strongAgainst.map(m => ({ id: m.id, winRate: parseFloat(m.winRate) }));
    }
    if (champ.drafting.weakAgainst) {
        optChamp.drafting.weakAgainst = champ.drafting.weakAgainst.map(m => ({ id: m.id, winRate: parseFloat(m.winRate) }));
    }
    if (champ.drafting.synergizesWith) {
        optChamp.drafting.synergizesWith = champ.drafting.synergizesWith.map(m => ({ id: m.id, winRate: parseFloat(m.winRate) }));
    }

    optimized.push(optChamp);
}

const str = JSON.stringify(optimized);
console.log("Array-based Optimized Size:", Buffer.byteLength(str, 'utf8'));
