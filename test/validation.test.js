const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateDataset, validateTierData } = require('../src/domain/validation/validate');
const fixtures = require('./validation-cases.json');
for (const fixture of fixtures) {
    test(fixture.name, () => {
        const run = () => validateDataset(fixture.dataset, fixture.value);
        if (fixture.valid) assert.doesNotThrow(run);
        else assert.throws(run, /:/);
    });
}
const meta = [{id:'Nilah',name:'Nilah',builds:[{boots:null,items:[],spareItems:[]}],loadout:{spells:'',runes:'',skills:{}},patch:'16.19',region:'Global (All Regions)'}];
const rating = [{id:'Nilah',name:'Nilah',winRate:'50%',pickRate:'1%',banRate:'1%',patch:'16.19',region:'Global (All Regions)'}];
const drafting = [{id:'Nilah',name:'Nilah',drafting:{strongAgainst:{},weakAgainst:{}}}];
const scaling = [{id:'Nilah',championName:'Nilah',scalingData:[]}];
test('all four analytics datasets agree', () => assert.doesNotThrow(() => validateTierData(meta,rating,drafting,scaling)));
test('region mismatch blocks publishing', () => assert.throws(() => validateTierData(meta,rating,drafting,scaling,'SEA'), /region/));
test('missing champion in companion dataset blocks publishing', () => assert.throws(() => validateTierData(meta,[{...rating[0],id:'Ashe'}],drafting,scaling), /ID sets differ/));
test('mixed patches block publishing', () => assert.throws(() => validateTierData(meta,[{...rating[0],patch:'16.18'}],drafting,scaling), /patch/));
test('non-finite number is rejected before JSON can turn it into null', () => assert.throws(() => validateDataset('champion_rating',[{...rating[0],score:NaN}]), /score/));
test('oversized JSON is rejected', () => assert.throws(() => validateDataset('champion_rating',[{...rating[0],icon:'x'.repeat(1000001)}]), /size/));

function publisher() {
    let batches = 0, commits = 0;
    const collections = [];
    const fakeDb = {
        batch() { batches++; return {set(){}, async commit(){commits++;}}; },
        collection(name) {
            collections.push(name);
            return {doc(id){return `${name}/${id}`;}};
        }
    };
    const module = {exports:{}};
    const source = fs.readFileSync(path.join(__dirname,'../src/infrastructure/output/firebase-storage.js'),'utf8');
    vm.runInNewContext(source, {module, require(name){
        if (name.endsWith('config/firebase')) return {db:fakeDb,admin:{firestore:{FieldValue:{serverTimestamp:()=>0}}}};
        if (name.endsWith('utils/logger')) return {success(){}};
        if (name.endsWith('domain/validation/validate')) return require('../src/domain/validation/validate');
        throw new Error(`Unexpected import ${name}`);
    }});
    return {api:module.exports, counts:()=>({batches,commits}), collections: () => collections};
}
test('invalid analytics never create a Firebase batch', async () => {
    const p=publisher();
    await assert.rejects(p.api.uploadTierData(meta,[],drafting,scaling));
    assert.deepEqual(p.counts(),{batches:0,commits:0});
});
test('invalid static datasets never create a Firebase batch', async () => {
    const p=publisher();
    for (const method of ['uploadChampions','uploadItems','uploadRunes','uploadSpells']) {
        await assert.rejects(p.api[method]([], '16.19'));
    }
    assert.deepEqual(p.counts(),{batches:0,commits:0});
});
test('valid analytics still publish in one batch', async () => {
    const p=publisher();
    await p.api.uploadTierData(meta,rating,drafting,scaling);
    assert.deepEqual(p.counts(),{batches:1,commits:1});
});
test('analytics upload targets staging_data by default', async () => {
    const p = publisher();
    const res = await p.api.uploadTierData(meta, rating, drafting, scaling);
    assert.equal(res.targetCollection, 'staging_data');
    assert.ok(p.collections().includes('staging_data'));
    assert.ok(!p.collections().includes('data'));
});
test('analytics upload targets data when specified', async () => {
    const p = publisher();
    const res = await p.api.uploadTierData(meta, rating, drafting, scaling, null, 'data');
    assert.equal(res.targetCollection, 'data');
    assert.ok(p.collections().includes('data'));
    assert.ok(!p.collections().includes('staging_data'));
});
test('static upload targets staging_data by default and data when specified', async () => {
    const p1 = publisher();
    const item = fixtures.find(f => f.name === 'item_list valid').value;
    const resDefault = await p1.api.uploadItems(item, '16.19');
    assert.equal(resDefault.targetCollection, 'staging_data');
    assert.ok(p1.collections().includes('staging_data'));

    const p2 = publisher();
    const resData = await p2.api.uploadItems(item, '16.19', 'data');
    assert.equal(resData.targetCollection, 'data');
    assert.ok(p2.collections().includes('data'));
});

test('whole static sync is validated before output', () => {
    const {validateStaticData} = require('../src/domain/validation/validate');
    const list = fixtures.find(f => f.name === 'champion_list valid').value[0];
    const detail = fixtures.find(f => f.name === 'champion_details valid').value[0];
    assert.throws(() => validateStaticData({championData:[{listEntry:list,detailEntry:detail}],items:[]}), /item_list/);
    assert.doesNotThrow(() => validateStaticData({championData:[{listEntry:list,detailEntry:detail}]}));
});
