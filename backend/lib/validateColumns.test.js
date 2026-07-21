const test = require('node:test');
const assert = require('node:assert');
const { validateRequiredColumns, findDuplicateHeaders } = require('./validateColumns');

test('validateRequiredColumns: passes when all required aliases present', () => {
  const headerRow = ['Part No 12 Digits ', 'Supplier', 'Dock IH routing', 'Source']; // trailing-space alias variant

  const result = validateRequiredColumns(headerRow, ['PART_NO_TG', 'SUPPLIER', 'DOCK_IH', 'SOURCE']);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.missing, []);
});

test('validateRequiredColumns: fails listing correct missing canonical names', () => {
  const headerRow = ['Supplier'];

  const result = validateRequiredColumns(headerRow, ['PART_NO_TG', 'SUPPLIER', 'DOCK_IH', 'SOURCE']);
  assert.strictEqual(result.valid, false);
  assert.deepStrictEqual(result.missing.sort(), ['DOCK_IH', 'PART_NO_TG', 'SOURCE'].sort());
});

test('validateRequiredColumns: passes when a required column header exists but every sample data row omits it (blank-cell bug)', () => {
  // xlsx.utils.sheet_to_json() omits a key entirely when a row's cell for that column is
  // blank. A required column whose header is present but whose only data row is blank for
  // that cell must still be treated as present, since the header row is the source of truth.
  const headerRow = ['DOCK', 'PART #', 'T/C TO (UNL)', 'V.SHARE VALUE'];

  const result = validateRequiredColumns(headerRow, ['DOCK', 'PART_NO_PP', 'TC_TO_UNL', 'V_SHARE_VALUE']);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.missing, []);
});

test('findDuplicateHeaders: header repeated twice is reported', () => {
  const headerRow = ['DOCK', 'PART #', 'PLANT', 'KBN', 'PLANT'];
  const result = findDuplicateHeaders(headerRow);
  assert.deepStrictEqual(result, ['PLANT']);
});

test('findDuplicateHeaders: no duplicates returns empty array', () => {
  const headerRow = ['DOCK', 'PART #', 'PLANT', 'KBN'];
  assert.deepStrictEqual(findDuplicateHeaders(headerRow), []);
});

test('findDuplicateHeaders: blank/undefined cells are ignored, not reported as duplicates', () => {
  const headerRow = ['DOCK', '', undefined, 'PART #', '', undefined];
  assert.deepStrictEqual(findDuplicateHeaders(headerRow), []);
});
