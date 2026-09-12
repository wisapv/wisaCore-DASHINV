const test = require('node:test');
const assert = require('node:assert');
const { decodeLocalFreeZoneQr } = require('./freeZoneQr');

const REAL_SAMPLE = 'SS12026090301 335040K270C00001/00020000028DAIWGD3 03/09/202609:4011A610ASD - R03';

test('decodeLocalFreeZoneQr parses every field from the real sample correctly', () => {
  const result = decodeLocalFreeZoneQr(REAL_SAMPLE);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.plant, 'S');
  assert.strictEqual(result.dock, 'S1');
  assert.strictEqual(result.orderNumber, '2026090301');
  assert.strictEqual(result.partNo, '335040K270C0');
  assert.strictEqual(result.boxSeq, 1);
  assert.strictEqual(result.totalBoxes, 2);
  assert.strictEqual(result.qty, 28);
  assert.strictEqual(result.supplier, 'DAIW');
  assert.strictEqual(result.sPlant, 'G');
  assert.strictEqual(result.sDock, 'D3');
  assert.strictEqual(result.arrivalDate, '03/09/2026');
  assert.strictEqual(result.arrivalTime, '09:40');
  assert.strictEqual(result.laneNo, '11');
  assert.strictEqual(result.kbn, 'A610');
  assert.strictEqual(result.conveyance, 'A');
  assert.strictEqual(result.address, 'SD - R03');
});

test('decodeLocalFreeZoneQr fails gracefully on a garbage string instead of throwing', () => {
  const result = decodeLocalFreeZoneQr('not a real qr code at all');
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test('decodeLocalFreeZoneQr fails gracefully when the string is too short', () => {
  const result = decodeLocalFreeZoneQr('SS12026090301');
  assert.strictEqual(result.ok, false);
});

test('decodeLocalFreeZoneQr rejects non-string input without throwing', () => {
  const result = decodeLocalFreeZoneQr(null);
  assert.strictEqual(result.ok, false);
});

test('decodeLocalFreeZoneQr requires the "/" separator exactly where expected', () => {
  // Same sample but with the "/" shifted by one character — should fail
  // the positional check rather than silently misreading every field after it.
  const corrupted = 'SS12026090301 335040K270C000012/0020000028DAIWGD3 03/09/202609:4011A610ASD - R03';
  const result = decodeLocalFreeZoneQr(corrupted);
  assert.strictEqual(result.ok, false);
});
