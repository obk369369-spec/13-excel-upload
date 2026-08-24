const assert = require('assert');
const batch = require('../scripts/tool13_batch_state.js');

const first = batch.mergeBatch(batch.emptySnapshot(), {
  files:['a.xlsx'], headers:['Title','Pages'],
  rows:[{origin_file:'a.xlsx',origin_row:2,Title:'Alpha',Pages:10}]
});
assert.strictEqual(first.rows.length, 1);
assert.strictEqual(first.batches, 1);

const liveState = batch.mergeBatch({files:first.files, headers:first.headers, rows:first.rows, batches:first.batches}, {
  files:['live.csv'], headers:['Title'], rows:[{origin_file:'live.csv',origin_row:2,Title:'Live'}]
});
assert.strictEqual(liveState.rows.length, 2);

const second = batch.mergeBatch(first, {
  files:['b.xlsx'], headers:['Title','Pages','Code'],
  rows:[{origin_file:'b.xlsx',origin_row:2,Title:'Beta',Pages:20,Code:'B-1'}]
});
assert.deepStrictEqual(second.files, ['a.xlsx','b.xlsx']);
assert.deepStrictEqual(second.headers, ['Title','Pages','Code']);
assert.strictEqual(second.rows.length, 2);
assert.strictEqual(second.rows[0].Title, 'Alpha');
assert.strictEqual(second.rows[1].Code, 'B-1');

const duplicate = batch.mergeBatch(second, {
  files:['a.xlsx'], headers:['Title','Pages'],
  rows:[{origin_file:'a.xlsx',origin_row:2,Title:'Alpha',Pages:10}]
});
assert.strictEqual(duplicate.rows.length, 2);
assert.strictEqual(duplicate.duplicate_rows, 1);

const resumed = batch.restore(batch.serialize(duplicate));
assert.strictEqual(resumed.rows.length, 2);
assert.strictEqual(resumed.batches, 3);
assert.strictEqual(resumed.rows[0].Title, 'Alpha');
assert.strictEqual(resumed.rows[1].Pages, 20);

const afterResume = batch.mergeBatch(resumed, {
  files:['c.xlsx'], headers:['Title','Pages'],
  rows:[{origin_file:'c.xlsx',origin_row:2,Title:'Gamma',Pages:30}]
});
assert.strictEqual(afterResume.rows.length, 3);
assert.strictEqual(afterResume.rows[2].Title, 'Gamma');
console.log('PASS: TOOL013 sequential multi-file accumulation + duplicate guard + checkpoint resume fixtures');
