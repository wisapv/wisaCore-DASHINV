const test = require('node:test');
const assert = require('node:assert');
const { evaluatePicAndShop } = require('./assignAddrRoute');

// Mirrors the Group formula in createFinalRow('SR481D' + finalShop + source) so
// the test can confirm Group follows the fixed Shop value without duplicating logic.
function group(shop, source) {
  return 'SR481D' + shop + source;
}

test('evaluatePicAndShop: ALS-triggering address has shouldDup === false', () => {
  const result = evaluatePicAndShop('SXX01', '', '');
  assert.strictEqual(result.pic, 'ALS');
  assert.strictEqual(result.shouldDup, false);
});

test('evaluatePicAndShop: Lineside address evaluates its own shop independently of Kanban', () => {
  // Same ppDock is passed for both calls (as the real route does) — it's neither
  // SW/S9/ST/SK nor S6, so both evaluations fall through to the address-driven
  // branches, where Kanban ('WH01') and Lineside ('R.LINE1') diverge.
  const dock = 'ZZ';
  const kanbanEval = evaluatePicAndShop('WH01', dock, 'SUP1');
  const linesideEval = evaluatePicAndShop('R.LINE1', dock, 'SUP1');

  assert.strictEqual(kanbanEval.pic, 'PC');
  assert.strictEqual(kanbanEval.shop, 'A');
  assert.strictEqual(kanbanEval.shouldDup, true);
  assert.strictEqual(linesideEval.pic, 'R');
  assert.strictEqual(linesideEval.shop, 'R');

  // The Lineside row's Shop/Group must be built from linesideEval, not kanbanEval.
  assert.notStrictEqual(linesideEval.shop, kanbanEval.shop);
  const linesideGroup = group(linesideEval.shop, '1');
  const kanbanGroup = group(kanbanEval.shop, '1');
  assert.strictEqual(linesideGroup, 'SR481DR1');
  assert.notStrictEqual(linesideGroup, kanbanGroup);
});

test('evaluatePicAndShop: regression — dock-based shouldDup:true branches unchanged', () => {
  assert.strictEqual(evaluatePicAndShop('ANY', 'SW', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('ANY', 'S9', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('ANY', 'ST', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('ANY', 'SK', '').shouldDup, true);
});

test('evaluatePicAndShop: regression — PC/WH address-based shouldDup:true branch unchanged', () => {
  assert.strictEqual(evaluatePicAndShop('PC01', '', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('WH01', '', '').shouldDup, true);
});
