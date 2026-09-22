const test = require('node:test');
const assert = require('node:assert');
const { decodeLocalFreeZoneQr } = require('./freeZoneQr');

// All three samples below are confirmed against the official fixed-width
// field layout (Plant/Dock/Order/PartNo/etc. — see freeZoneQr.js's own
// header comment for the exact byte ranges). Normal Order was additionally
// cross-checked against a real printed Kanban label. Order No. is 12
// characters wide and CAN contain letters (an "E1" emergency suffix, or a
// sequential order's own lettering) — this replaces an earlier, since-
// disproven assumption that Order No. was a fixed 10 digits plus a single
// separator space, which briefly caused this exact test file to assert the
// wrong values for a "verified" sample that turned out to be mistyped.

const NORMAL_ORDER = 'SS12026013006  126010E010000001/000500000061PITAI1 30/01/202607:3011A001IFN4  - R00';
const EMERGENCY_ORDER = 'SS12026091101E1019990KD15000003/00030000024ITP1AI1 11/09/202614:000-R882 FN4  - R02';
const SEQUENTIAL_ORDER = 'SS620260918032S71001FAL80C00001/00020000001TBASO   19/09/202603:200-N510 958       ';

test('decodeLocalFreeZoneQr parses a Normal order correctly (cross-checked against a real printed label)', () => {
  const result = decodeLocalFreeZoneQr(NORMAL_ORDER);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.plant, 'S');
  assert.strictEqual(result.dock, 'S1');
  assert.strictEqual(result.orderNumber, '2026013006');
  assert.strictEqual(result.partNo, '126010E01000');
  assert.strictEqual(result.boxSeq, 1);
  assert.strictEqual(result.totalBoxes, 5);
  assert.strictEqual(result.qty, 6);
  assert.strictEqual(result.supplier, '1PIT');
  assert.strictEqual(result.sPlant, 'A');
  assert.strictEqual(result.sDock, 'I1');
  assert.strictEqual(result.arrivalDate, '30/01/2026');
  assert.strictEqual(result.arrivalTime, '07:30');
  assert.strictEqual(result.laneNo, '11');
  assert.strictEqual(result.kbn, 'A001');
  assert.strictEqual(result.conveyance, 'I');
  assert.strictEqual(result.address, 'FN4  - R00');
});

test('decodeLocalFreeZoneQr parses an Emergency order correctly (Order No. carries a letter suffix, "0-" is a real Lane value)', () => {
  const result = decodeLocalFreeZoneQr(EMERGENCY_ORDER);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dock, 'S1');
  assert.strictEqual(result.orderNumber, '2026091101E1');
  assert.strictEqual(result.partNo, '019990KD1500');
  assert.strictEqual(result.boxSeq, 3);
  assert.strictEqual(result.totalBoxes, 3);
  assert.strictEqual(result.qty, 24);
  assert.strictEqual(result.supplier, 'ITP1');
  assert.strictEqual(result.sPlant, 'A');
  assert.strictEqual(result.sDock, 'I1');
  assert.strictEqual(result.arrivalDate, '11/09/2026');
  assert.strictEqual(result.arrivalTime, '14:00');
  assert.strictEqual(result.laneNo, '0-'); // literal placeholder, not two digits — must not be trimmed away
  assert.strictEqual(result.kbn, 'R882');
  assert.strictEqual(result.conveyance, ''); // genuinely blank for this order
  assert.strictEqual(result.address, 'FN4  - R02');
});

test('decodeLocalFreeZoneQr parses a Sequential order correctly (Order No. is mostly digits with a trailing letter)', () => {
  const result = decodeLocalFreeZoneQr(SEQUENTIAL_ORDER);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dock, 'S6');
  assert.strictEqual(result.orderNumber, '20260918032S');
  assert.strictEqual(result.partNo, '71001FAL80C0');
  assert.strictEqual(result.boxSeq, 1);
  assert.strictEqual(result.totalBoxes, 2);
  assert.strictEqual(result.qty, 1);
  assert.strictEqual(result.supplier, 'TBAS');
  assert.strictEqual(result.sPlant, 'O');
  assert.strictEqual(result.sDock, ''); // genuinely blank for this order
  assert.strictEqual(result.arrivalDate, '19/09/2026');
  assert.strictEqual(result.arrivalTime, '03:20');
  assert.strictEqual(result.laneNo, '0-');
  assert.strictEqual(result.kbn, 'N510');
  assert.strictEqual(result.address, '958');
});

test('decodeLocalFreeZoneQr fails gracefully on a garbage string instead of throwing', () => {
  const result = decodeLocalFreeZoneQr('not a real qr code at all');
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test('decodeLocalFreeZoneQr fails gracefully when the string is shorter than the fixed 83-character layout', () => {
  const result = decodeLocalFreeZoneQr('SS12026013006');
  assert.strictEqual(result.ok, false);
});

test('decodeLocalFreeZoneQr rejects non-string input without throwing', () => {
  const result = decodeLocalFreeZoneQr(null);
  assert.strictEqual(result.ok, false);
});

test('decodeLocalFreeZoneQr rejects a string with no "/" inside the Box Seq/Total Boxes field', () => {
  const noSlash = NORMAL_ORDER.slice(0, 31) + 'X' + NORMAL_ORDER.slice(32);
  const result = decodeLocalFreeZoneQr(noSlash);
  assert.strictEqual(result.ok, false);
});

test('decodeLocalFreeZoneQr rejects a blank Part No. field', () => {
  const blankPartNo = NORMAL_ORDER.slice(0, 15) + ' '.repeat(12) + NORMAL_ORDER.slice(27);
  const result = decodeLocalFreeZoneQr(blankPartNo);
  assert.strictEqual(result.ok, false);
});

const { decodeBarePartNo } = require('./freeZoneQr');

test('decodeBarePartNo recognizes a 12-character Import Part tag', () => {
  const result = decodeBarePartNo('166043501000');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.partNo, '166043501000');
  assert.strictEqual(result.orderType, 'import');
});

test('decodeBarePartNo recognizes a 13-character Special Order tag and drops the meaningless trailing character', () => {
  const result = decodeBarePartNo('53293KK17000P');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.partNo, '53293KK17000');
  assert.strictEqual(result.orderType, 'special');
});

test('decodeBarePartNo rejects a length that is neither 12 nor 13 characters', () => {
  const result = decodeBarePartNo('12345');
  assert.strictEqual(result.ok, false);
});