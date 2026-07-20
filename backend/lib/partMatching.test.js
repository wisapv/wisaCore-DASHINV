const test = require('node:test');
const assert = require('node:assert');
const { buildPpIndex, cleanTargetRow, computeShop } = require('./partMatching');

function ppRow(data) {
  return { data: JSON.stringify(data) };
}

test('cleanTargetRow: TTAT supplier dropped', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'TTAT',
    'Dock IH routing': 'SW',
  });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow: dock equals supplier dropped', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'SW',
    'Dock IH routing': 'SW',
  });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow: empty part no dropped', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow: "N/A" part no dropped (case-insensitive)', () => {
  assert.strictEqual(cleanTargetRow({
    'Part No 12 Digits': 'N/A',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }).valid, false);

  assert.strictEqual(cleanTargetRow({
    'Part No 12 Digits': 'n/a',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }).valid, false);
});

test('cleanTargetRow: valid row passes', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  });
  assert.strictEqual(result.valid, true);
});

test('computeShop: main mode branches', () => {
  assert.strictEqual(computeShop('SW', { mode: 'main' }), 'W');
  assert.strictEqual(computeShop('S9', { mode: 'main' }), 'W');
  assert.strictEqual(computeShop('SK', { mode: 'main' }), 'K');
  assert.strictEqual(computeShop('ST', { mode: 'main' }), 'A');
  assert.strictEqual(computeShop('OTHER', { mode: 'main' }), 'A');
});

test('computeShop: handheld mode branches', () => {
  assert.strictEqual(computeShop('SW', { mode: 'handheld' }), 'W');
  assert.strictEqual(computeShop('S9', { mode: 'handheld' }), 'W');
  assert.strictEqual(computeShop('ST', { mode: 'handheld' }), 'T');
  assert.strictEqual(computeShop('SK', { mode: 'handheld' }), 'K');
  assert.strictEqual(computeShop('OTHER', { mode: 'handheld' }), 'A');
});

test('buildPpIndex: expired rows excluded from ppMap but present in allPpMap', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yyyymmdd = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

  const rows = [
    ppRow({ 'DOCK': 'SW', 'PART #': 'PART1', 'T/C TO (UNL)': yyyymmdd, 'PART DESC': 'BRACKET' }),
  ];

  const { ppMap, allPpMap } = buildPpIndex(rows);
  assert.strictEqual(ppMap.size, 0);
  assert.strictEqual(allPpMap.size, 1);
});

test('buildPpIndex: excluded PART DESC excluded from ppMap', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyymmdd = tomorrow.toISOString().slice(0, 10).replace(/-/g, '');

  const rows = [
    ppRow({ 'DOCK': 'SW', 'PART #': 'PART1', 'T/C TO (UNL)': yyyymmdd, 'PART DESC': 'WHEEL ASSY' }),
  ];

  const { ppMap, allPpMap } = buildPpIndex(rows, { excludePartDesc: ['WHEEL ASSY'] });
  assert.strictEqual(ppMap.size, 0);
  assert.strictEqual(allPpMap.size, 1);
});

test('buildPpIndex: duplicate key detected and last-row-wins preserved', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyymmdd = tomorrow.toISOString().slice(0, 10).replace(/-/g, '');

  const rows = [
    ppRow({ 'DOCK': 'SW', 'PART #': 'PART1', 'T/C TO (UNL)': yyyymmdd, 'PART DESC': 'FIRST' }),
    ppRow({ 'DOCK': 'SW', 'PART #': 'PART1', 'T/C TO (UNL)': yyyymmdd, 'PART DESC': 'SECOND' }),
  ];

  const { ppMap, allPpMap, duplicateKeys } = buildPpIndex(rows);
  assert.strictEqual(duplicateKeys.length, 1);
  assert.strictEqual(ppMap.get(duplicateKeys[0])['PART DESC'], 'SECOND');
  assert.strictEqual(allPpMap.get(duplicateKeys[0])['PART DESC'], 'SECOND');
});
