const test = require('node:test');
const assert = require('node:assert');
const { buildPpIndex, cleanTargetRow, computeShop, dedupeDockEqualsSupplierRows, createFirstOccurrenceTracker, findNewPartsSinceBatch } = require('./partMatching');

function ppRow(data) {
  return { data: JSON.stringify(data) };
}

test('cleanTargetRow mode "main": TTAT supplier dropped', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'TTAT',
    'Dock IH routing': 'SW',
  }, { mode: 'main' });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow mode "main": dock equals supplier dropped', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'SW',
    'Dock IH routing': 'SW',
  }, { mode: 'main' });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow mode "main": empty part no dropped', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }, { mode: 'main' });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow mode "main": "N/A" part no dropped (case-insensitive)', () => {
  assert.strictEqual(cleanTargetRow({
    'Part No 12 Digits': 'N/A',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }, { mode: 'main' }).valid, false);

  assert.strictEqual(cleanTargetRow({
    'Part No 12 Digits': 'n/a',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }, { mode: 'main' }).valid, false);
});

test('cleanTargetRow mode "main": valid row passes', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }, { mode: 'main' });
  assert.strictEqual(result.valid, true);
});

test('cleanTargetRow mode "handheld": TTAT supplier is KEPT — the Handheld-process spec says "this time we do NOT delete TTAT", unlike mode "main" which does', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'TTAT',
    'Dock IH routing': 'S6',
  }, { mode: 'handheld' });
  assert.strictEqual(result.valid, true);
});

test('cleanTargetRow mode "handheld": dock equals supplier dropped, same as mode "main" — even though the physical Address Master match later on can still find a real location for such a part via Part Procurement\'s Production Routing (see the real Part 52110-0K410-A3 case), Handheld must follow TBOS\'s Clean step rather than diverge from it', () => {
  const result = cleanTargetRow({
    'Part No 12 Digits': '123456789012',
    'Supplier': 'SW',
    'Dock IH routing': 'SW',
  }, { mode: 'handheld' });
  assert.strictEqual(result.valid, false);
});

test('cleanTargetRow mode "handheld": empty/"N/A" part no still invalid', () => {
  assert.strictEqual(cleanTargetRow({
    'Part No 12 Digits': '',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }, { mode: 'handheld' }).valid, false);

  assert.strictEqual(cleanTargetRow({
    'Part No 12 Digits': 'N/A',
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
  }, { mode: 'handheld' }).valid, false);
});

test('dedupeDockEqualsSupplierRows: keeps first occurrence per key within the subgroup', () => {
  const rows = [
    { partNo: 'P1', isDockEqualsSupplier: true, source: 'S1' },
    { partNo: 'P1', isDockEqualsSupplier: true, source: 'S2' },
    { partNo: 'P1', isDockEqualsSupplier: true, source: 'S3' },
  ];

  const result = dedupeDockEqualsSupplierRows(rows, (row) => row.partNo);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'S1');
});

test('dedupeDockEqualsSupplierRows: non-subgroup rows pass through untouched, order preserved', () => {
  const rows = [
    { partNo: 'A', isDockEqualsSupplier: false, tag: 'keep-1' },
    { partNo: 'P1', isDockEqualsSupplier: true, tag: 'dup-first' },
    { partNo: 'B', isDockEqualsSupplier: false, tag: 'keep-2' },
    { partNo: 'P1', isDockEqualsSupplier: true, tag: 'dup-second' },
    { partNo: 'C', isDockEqualsSupplier: false, tag: 'keep-3' },
  ];

  const result = dedupeDockEqualsSupplierRows(rows, (row) => row.partNo);
  assert.deepStrictEqual(result.map((r) => r.tag), ['keep-1', 'dup-first', 'keep-2', 'keep-3']);
});

test('createFirstOccurrenceTracker: true on the first occurrence of a key, false on every repeat', () => {
  const isFirstOccurrence = createFirstOccurrenceTracker();
  assert.strictEqual(isFirstOccurrence('A'), true);
  assert.strictEqual(isFirstOccurrence('A'), false);
  assert.strictEqual(isFirstOccurrence('A'), false);
});

test('createFirstOccurrenceTracker: tracks distinct keys independently', () => {
  const isFirstOccurrence = createFirstOccurrenceTracker();
  assert.strictEqual(isFirstOccurrence('A'), true);
  assert.strictEqual(isFirstOccurrence('B'), true);
  assert.strictEqual(isFirstOccurrence('A'), false);
  assert.strictEqual(isFirstOccurrence('B'), false);
  assert.strictEqual(isFirstOccurrence('C'), true);
});

function tgRow({ dock, partNo, supplier = 'ABC' }) {
  return { 'Dock IH routing': dock, 'Part No 12 Digits': partNo, 'Supplier': supplier };
}

test('findNewPartsSinceBatch: a part present in both sets is excluded', () => {
  const previous = [tgRow({ dock: 'SW', partNo: '111111111111' })];
  const current = [tgRow({ dock: 'SW', partNo: '111111111111' })];
  assert.deepStrictEqual(findNewPartsSinceBatch(current, previous), []);
});

test('findNewPartsSinceBatch: a part only in the current set is included', () => {
  const previous = [tgRow({ dock: 'SW', partNo: '111111111111' })];
  const current = [tgRow({ dock: 'SW', partNo: '111111111111' }), tgRow({ dock: 'SW', partNo: '222222222222' })];
  const result = findNewPartsSinceBatch(current, previous);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]['Part No 12 Digits'], '222222222222');
});

test('findNewPartsSinceBatch: invalid/blank rows in either set do not affect the comparison', () => {
  // Blank part no in current: never counted as new, regardless of the previous set.
  const blankCurrent = [tgRow({ dock: 'SW', partNo: '' })];
  assert.deepStrictEqual(findNewPartsSinceBatch(blankCurrent, []), []);

  // Blank/"N/A" part no in previous: ignored when building the comparison set,
  // so it can never "shadow" a real part in the current set that happens to
  // share the same (blank) key.
  const previousWithBlank = [tgRow({ dock: 'SW', partNo: '' }), tgRow({ dock: '', partNo: 'N/A' })];
  const current = [tgRow({ dock: 'SW', partNo: '333333333333' })];
  const result = findNewPartsSinceBatch(current, previousWithBlank);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]['Part No 12 Digits'], '333333333333');
});

test('findNewPartsSinceBatch: an empty previous set (first-ever batch) returns all valid current rows as new', () => {
  const current = [
    tgRow({ dock: 'SW', partNo: '111111111111' }),
    tgRow({ dock: 'ST', partNo: '222222222222' }),
    tgRow({ dock: 'SW', partNo: '' }), // invalid, must still be excluded
  ];
  const result = findNewPartsSinceBatch(current, []);
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map((r) => r['Part No 12 Digits']).sort(), ['111111111111', '222222222222']);
});

test('findNewPartsSinceBatch: a TTAT or Dock=Supplier row (dropped by main mode) still counts as a real part', () => {
  const previous = [];
  const current = [tgRow({ dock: 'SW', partNo: '444444444444', supplier: 'SW' })]; // dock === supplier
  const result = findNewPartsSinceBatch(current, previous);
  assert.strictEqual(result.length, 1);
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