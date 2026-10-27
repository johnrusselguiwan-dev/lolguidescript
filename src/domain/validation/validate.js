const contract = require('./data-contract.json');

class DataValidationError extends Error {
    constructor(path, reason) {
        super(`${path}: ${reason}`);
        this.name = 'DataValidationError';
    }
}
const fail = (path, reason) => { throw new DataValidationError(path, reason); };
function check(value, rule, path) {
    if (value === null && rule.nullable) return;
    const type = rule.type;
    const valid = type === 'array' ? Array.isArray(value)
        : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : type === 'integer' ? Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === type;
    if (!valid) fail(path, `expected ${type}`);
    if (type === 'string') {
        if (rule.nonblank && !value.trim()) fail(path, 'must not be blank');
        if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail(path, 'invalid format');
    }
    if (type === 'number' || type === 'integer') {
        if (rule.minimum !== undefined && value < rule.minimum) fail(path, 'below minimum');
        if (rule.maximum !== undefined && value > rule.maximum) fail(path, 'above maximum');
    }
    if (type === 'array') {
        if (value.length < rule.minItems) fail(path, 'unexpected empty dataset or list');
        const ids = new Set();
        value.forEach((item, i) => {
            check(item, rule.items, `${path}[${i}]`);
            if (rule.uniqueBy) {
                const id = item[rule.uniqueBy];
                if (ids.has(id)) fail(`${path}[${i}].${rule.uniqueBy}`, `duplicate ID ${id}`);
                ids.add(id);
            }
        });
    }
    if (type === 'object') {
        for (const key of rule.required || []) {
            if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'required field missing');
        }
        for (const options of rule.requiredOneOf || []) {
            if (!options.some(key => Object.hasOwn(value, key))) fail(path, `requires ${options.join(' or ')}`);
        }
        for (const [key, item] of Object.entries(value)) {
            const child = rule.properties?.[key] || rule.values;
            if (child) check(item, child, `${path}.${key}`);
        }
        if (rule.equalLengths) {
            const lengths = rule.equalLengths.map(key => value[key].length);
            if (new Set(lengths).size !== 1) fail(path, 'skill arrays must have equal lengths');
        }
    }
}
function validateDataset(name, data) {
    if (!contract.datasets[name]) fail(name, 'unknown dataset');
    check(data, contract.datasets[name], name);
    // Leave headroom for document fields/names below Firestore's 1 MiB limit.
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 1000000) fail(name, 'JSON exceeds safe document size');
    return data;
}
function assertSameIds(left, right, path) {
    const expected = new Set(left.map(row => row.id));
    if (expected.size !== right.length || right.some(row => !expected.has(row.id))) fail(path, 'champion ID sets differ');
}
function validateTierData(meta, rating, drafting, scaling, region = null) {
    for (const [name, rows] of Object.entries({champion_meta: meta, champion_rating: rating, champion_drafting: drafting, champion_scaling: scaling})) {
        validateDataset(name, rows);
        assertSameIds(meta, rows, name);
    }
    const target = !region || region === 'all' ? 'Global (All Regions)' : region;
    if (!['Global (All Regions)', 'SEA', 'Asia', 'Americas', 'Europe'].includes(target)) fail('region', 'unknown region');
    const patch = meta[0].patch;
    if (typeof patch !== 'string' || !patch.trim()) fail('champion_meta[0].patch', 'required patch');
    for (const [name, rows] of [['champion_meta', meta], ['champion_rating', rating]]) {
        rows.forEach((row, i) => {
            if (row.region !== target) fail(`${name}[${i}].region`, `expected ${target}`);
            if (row.patch !== patch) fail(`${name}[${i}].patch`, 'mixed aggregation patches');
        });
    }
}
function validateStaticData({ championData, items, runeTrees, spells }) {
    if (championData !== null && championData !== undefined) {
        if (!Array.isArray(championData) || !championData.length) fail('champions', 'expected non-empty array');
        const list = championData.map(row => row?.listEntry);
        const details = championData.map(row => row?.detailEntry);
        validateDataset('champion_list', list);
        validateDataset('champion_details', details);
        assertSameIds(list, details, 'champions');
    }
    for (const [name, rows] of [['item_list', items], ['rune_trees', runeTrees], ['summoner_spells', spells]]) {
        if (rows !== null && rows !== undefined) validateDataset(name, rows);
    }
}
module.exports = { DataValidationError, validateDataset, validateTierData, validateStaticData, assertSameIds };
