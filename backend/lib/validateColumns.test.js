const test = require('node:test');
const assert = require('node:assert');
const { validateRequiredColumns } = require('./validateColumns');

test('validateRequiredColumns: passes when all required aliases present', () => {
  const rawData = [{
    'Part No 12 Digits ': '123456789012', // trailing-space alias variant
    'Supplier': 'ABC',
    'Dock IH routing': 'SW',
    'Source': '1',
  }];

  const result = validateRequiredColumns(rawData, ['PART_NO_TG', 'SUPPLIER', 'DOCK_IH', 'SOURCE']);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.missing, []);
});

test('validateRequiredColumns: fails listing correct missing canonical names', () => {
  const rawData = [{
    'Supplier': 'ABC',
  }];

  const result = validateRequiredColumns(rawData, ['PART_NO_TG', 'SUPPLIER', 'DOCK_IH', 'SOURCE']);
  assert.strictEqual(result.valid, false);
  assert.deepStrictEqual(result.missing.sort(), ['DOCK_IH', 'PART_NO_TG', 'SOURCE'].sort());
});
