const test = require('node:test');
const assert = require('node:assert');
const { getField } = require('./fieldAliases');

test('getField resolves known aliases', () => {
  assert.strictEqual(getField({ 'DOCK ': 'SW' }, 'DOCK'), 'SW');
  assert.strictEqual(getField({ 'PART #': 'ABC123' }, 'PART_NO_PP'), 'ABC123');
});

test('getField trims whitespace', () => {
  assert.strictEqual(getField({ 'DOCK': '  SW  ' }, 'DOCK'), 'SW');
});

test('getField returns empty string when missing', () => {
  assert.strictEqual(getField({}, 'DOCK'), '');
  assert.strictEqual(getField({ 'DOCK': '' }, 'DOCK'), '');
});
