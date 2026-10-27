// Offline only: never initializes Firebase or changes local output files.
const fs = require('node:fs');
const { validateTierData } = require('../src/domain/validation/validate');
const { STORAGE } = require('../config/constants');
const region = process.argv[2] || 'all';
try {
    const rows = ['CHAMPION_META', 'CHAMPION_RATING', 'CHAMPION_DRAFTING', 'CHAMPION_SCALING']
        .map(key => JSON.parse(fs.readFileSync(STORAGE[key], 'utf8')));
    validateTierData(...rows, region);
    console.log(`Validation passed: ${rows[0].length} champions, region ${region}`);
} catch (error) {
    console.error(`Validation failed: ${error.message}`);
    process.exitCode = 1;
}
