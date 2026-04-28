const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
    if (!fs.existsSync(filePath)) {
        console.warn('File not found:', filePath);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    for (const [search, replace] of replacements) {
        if (content.includes(search)) {
            content = content.split(search).join(replace);
            changed = true;
        }
    }
    if (changed) fs.writeFileSync(filePath, content, 'utf8');
}

replaceInFile('src/application/aggregator.js', [
    ['require("./database")', 'require("../infrastructure/database/sqlite-client")'],
    ['require("../utils/io")', 'require("../infrastructure/utils/io")'],
    ['require("../utils/logger")', 'require("../infrastructure/utils/logger")']
]);
replaceInFile('src/application/import-manager.js', [
    ['require("./database")', 'require("../infrastructure/database/sqlite-client")'],
    ['require("./match-registry")', 'require("../infrastructure/database/firebase-firestore")'],
    ['require("../utils/logger")', 'require("../infrastructure/utils/logger")']
]);
replaceInFile('src/application/asset-manager.js', [
    ['require("../utils/io")', 'require("../infrastructure/utils/io")'],
    ['require("../utils/logger")', 'require("../infrastructure/utils/logger")']
]);
replaceInFile('src/application/static-data.js', [
    ['require("../utils/io")', 'require("../infrastructure/utils/io")'],
    ['require("../utils/logger")', 'require("../infrastructure/utils/logger")']
]);
replaceInFile('src/application/champions.js', [
    ['require("../api/ddragon")', 'require("../infrastructure/api/ddragon")'],
    ['require("../mappers/champion-details")', 'require("../domain/mappers/champion-details")'],
    ['require("../mappers/champion-list")', 'require("../domain/mappers/champion-list")'],
    ['require("../utils/metadata")', 'require("../infrastructure/utils/metadata")'],
    ['require("../utils/io")', 'require("../infrastructure/utils/io")'],
    ['require("../utils/cli")', 'require("../presentation/cli-utils")'],
    ['require("../utils/logger")', 'require("../infrastructure/utils/logger")']
]);

const servicesToFix = ['items.js', 'runes.js', 'spells.js'];
servicesToFix.forEach(f => {
    let fn = 'src/application/' + f;
    replaceInFile(fn, [
        ['require("../api/ddragon")', 'require("../infrastructure/api/ddragon")'],
        ['require("../api/cdragon")', 'require("../infrastructure/api/cdragon")'],
        ['require("../mappers/items")', 'require("../domain/mappers/items")'],
        ['require("../mappers/runes")', 'require("../domain/mappers/runes")'],
        ['require("../mappers/spells")', 'require("../domain/mappers/spells")'],
        ['require("../utils/cli")', 'require("../presentation/cli-utils")']
    ]);
});

replaceInFile('src/application/crawler.js', [
    ['require("../config/constants")', 'require("../../config/constants")'],
    ['require("../src/api/riot-client")', 'require("../infrastructure/api/riot-client")'],
    ['require("../src/services/asset-manager")', 'require("./asset-manager")'],
    ['require("../src/services/analytics")', 'require("./analytics")'],
    ['require("../src/services/aggregator")', 'require("./aggregator")'],
    ['require("../src/services/match-registry")', 'require("../infrastructure/database/firebase-firestore")'],
    ['require("../src/services/import-manager")', 'require("./import-manager")'],
    ['require("../src/services/database")', 'require("../infrastructure/database/sqlite-client")'],
    ['require("../src/output/firebase")', 'require("../infrastructure/output/firebase-storage")'],
    ['require("../src/utils/io")', 'require("../infrastructure/utils/io")'],
    ['require("../src/utils/logger")', 'require("../infrastructure/utils/logger")']
]);

replaceInFile('src/application/sync-master.js', [
    ['require("../src/api/ddragon")', 'require("../infrastructure/api/ddragon")'],
    ['require("../src/services/champions")', 'require("./champions")'],
    ['require("../src/services/items")', 'require("./items")'],
    ['require("../src/services/runes")', 'require("./runes")'],
    ['require("../src/services/spells")', 'require("./spells")'],
    ['require("../src/output/firebase")', 'require("../infrastructure/output/firebase-storage")'],
    ['require("../src/output/local-export")', 'require("../infrastructure/output/local-export")'],
    ['require("../src/utils/cli")', 'require("../presentation/cli-utils")']
]);

replaceInFile('src/domain/mappers/champion-details.js', [
    ['require("../utils/parser")', 'require("../parser")']
]);

replaceInFile('src/infrastructure/api/riot-client.js', [
    ['require("../../config/constants")', 'require("../../../config/constants")']
]);

replaceInFile('src/infrastructure/database/firebase-firestore.js', [
    ['require("./database")', 'require("./sqlite-client")'],
    ['require("../../config/firebase")', 'require("../../../config/firebase")']
]);

replaceInFile('src/infrastructure/database/sqlite-client.js', [
    ['require("../../config/constants")', 'require("../../../config/constants")']
]);

replaceInFile('src/infrastructure/output/firebase-storage.js', [
    ['require("../../config/firebase")', 'require("../../../config/firebase")'],
    ['require("../utils/cli")', 'require("../../presentation/cli-utils")']
]);

replaceInFile('src/infrastructure/output/local-export.js', [
    ['require("../utils/cli")', 'require("../../presentation/cli-utils")']
]);

console.log('Fix script complete');
