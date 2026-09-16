const test = require('node:test');
const assert = require('node:assert');
const xlsx = require('xlsx');
const { connectDB, initDB } = require('../database');
const { evaluatePicAndShop, generateExcelBuffer, handleProcessAssignAddr, handleGetFinalData, handleSaveFinalData } = require('./assignAddrRoute');

// Mirrors the Group formula in createFinalRow('SR481D' + finalShop + source) so
// the test can confirm Group follows the fixed Shop value without duplicating logic.
function group(shop, source) {
  return 'SR481D' + shop + source;
}

function bufferFromAoa(aoa) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = JSON.parse(JSON.stringify(payload)); return this; },
    setHeader(key, value) { this.headers[key] = value; },
    send(buf) { this.body = buf; return this; },
  };
}

async function seedBatch(batchId, { partNo, dock = 'ZZ', supplier = 'SUPX', source = '1', partDesc = 'TEST PART', kbn = 'K1' } = {}) {
  const db = await connectDB();
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);
  await db.run(
    'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify({ 'Part No 12 Digits': partNo, 'Supplier': supplier, 'Dock IH routing': dock, 'Source': source }), now]
  );
  await db.run(
    'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify({
      'T/C TO (UNL)': '20991231', 'DOCK': dock, 'Production Routing': '', 'PART #': partNo,
      'PART DESC': partDesc, 'COMP': 'C1', 'SUPL': supplier, 'PLANT': 'P1', 'S.DOCK': 'SD1', 'KBN': kbn,
      'Model Name': 'MODL', 'Life Cycle Code': 'L1', 'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1', 'V.SHARE VALUE': 'VV1',
      'ORD Method': 'OM1', 'QTY /CONT': '10', 'PACK QTY/CONT': '20',
    }), now]
  );
}

async function cleanupBatch(batchId) {
  const db = await connectDB();
  await db.run('DELETE FROM target_ro WHERE batch_id = ?', batchId);
  await db.run('DELETE FROM part_procurement WHERE batch_id = ?', batchId);
  await db.run('DELETE FROM upload_batches WHERE batch_id = ?', batchId);
  await db.run('DELETE FROM handheld_results WHERE batch_id = ?', batchId);
}

test.before(async () => {
  await initDB();
});

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

test('evaluatePicAndShop: regression — W/T dock-based shouldDup:true branches unchanged', () => {
  assert.strictEqual(evaluatePicAndShop('ANY', 'SW', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('ANY', 'S9', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('ANY', 'ST', '').shouldDup, true);
});

test('evaluatePicAndShop: SK dock (Shop K) no longer duplicates into a Lineside row', () => {
  const result = evaluatePicAndShop('ANY', 'SK', '');
  assert.strictEqual(result.pic, 'K');
  assert.strictEqual(result.shop, 'K');
  assert.strictEqual(result.shouldDup, false);
});

test('evaluatePicAndShop: regression — PC/WH address-based shouldDup:true branch unchanged', () => {
  assert.strictEqual(evaluatePicAndShop('PC01', '', '').shouldDup, true);
  assert.strictEqual(evaluatePicAndShop('WH01', '', '').shouldDup, true);
});

test('generateExcelBuffer: a blank ("") field value writes a genuinely absent cell, not an empty-string cell', () => {
  // Stands in for what /export-excel actually receives: rows the client
  // posts back, built from this route's own blankOrTrim(...) preview data,
  // where a blank field is already reduced to ''.
  const dataRows = [
    { Shop: 'A', Group: 'SR481DA1', Source: '1', Dock: 'ZZ', Supplier: '', 'Part no.': '123456789012' },
  ];

  const buffer = generateExcelBuffer(dataRows);
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];

  // Fixed export column order (see HANDHELD_EXPORT_COLUMNS): Group(A),
  // Shop(B), Source(C), Dock(D), Supplier(E), S.plant(F), S.dock(G),
  // Part no.(H), ...
  assert.strictEqual(ws['E2'], undefined, 'blank field must produce a genuinely absent cell, not an empty-string cell');
  // Sanity check: a real, non-blank field in the same row is still a real cell.
  assert.strictEqual(ws['D2'].v, 'ZZ');
});

const ADDR_HEADERS = ['T/C FROM (UNL)', 'T/C TO (UNL)', 'DOCK', 'PART #', 'Kanban Print Address', 'Lineside Address', 'PART DESC'];

// The real Address Master source file's actual header has no space before
// the parenthesis ("T/C FROM(UNL)") — confirmed directly from the business
// owner's file. This is deliberately distinct from ADDR_HEADERS above (which
// uses the space variant) so at least one test proves the real-world file
// shape works, not just the variant the earlier tests happened to use.
const ADDR_HEADERS_REAL_NO_SPACE = ['T/C FROM(UNL)', 'T/C TO (UNL)', 'DOCK', 'PART #', 'Kanban Print Address', 'Lineside Address', 'PART DESC'];

test('handleProcessAssignAddr: two time-overlapping valid Address Master rows for the same part both produce output rows (real 692050K110C0 example, real no-space "T/C FROM(UNL)" header)', async () => {
  const batchId = 'TEST-ADDR-MULTIROW-' + Date.now();
  const partNo = '692050K110C0';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    // Mirrors the real Address Master data that surfaced this bug: both rows
    // are valid today (T/C TO = 99991231, no expiry) and represent two
    // genuinely different physical delivery points for the same part.
    const addrRows = [
      ['20181029', '99991231', 'ZZ', partNo, 'DO1 - R11', 'DO1 - R11', 'TEST PART'],
      ['20251014', '99991231', 'ZZ', partNo, 'SBP - L03', 'BP1 - R07', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS_REAL_NO_SPACE, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 0);
    assert.strictEqual(res.body.data.length, 2, 'both DO1 and SBP rows must be present, not just one');
    assert.deepStrictEqual(res.body.data.map((r) => r.Addr).sort(), ['DO1 - R11', 'SBP - L03']);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: an expired Address Master row alongside a valid row for the same key only produces output for the valid one', async () => {
  const batchId = 'TEST-ADDR-EXPIRED-' + Date.now();
  const partNo = '777777777777';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    const addrRows = [
      ['20180101', '20200101', 'ZZ', partNo, 'WH-EXPIRED', '', 'TEST PART'], // today is outside this window
      ['20180101', '99991231', 'ZZ', partNo, 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].Addr, 'WH01');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: Kanban Print Address equal to Lineside Address (case/whitespace-insensitive) in a shouldDup group produces exactly one row', async () => {
  const batchId = 'TEST-ADDR-KANBANEQLINESIDE-' + Date.now();
  const partNo = '888888888888';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    // PC prefix -> shouldDup group. Lineside differs from Kanban only by case/whitespace.
    const addrRows = [
      ['20180101', '99991231', 'ZZ', partNo, 'PC01', ' pc01 ', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 1, 'Kanban === Lineside must not produce a duplicate Lineside row');
    assert.strictEqual(res.body.data[0].PIC, 'PC');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: Kanban Print Address different from Lineside Address in a shouldDup group still produces two rows (regression)', async () => {
  const batchId = 'TEST-ADDR-KANBANNELINESIDE-' + Date.now();
  const partNo = '000111222333';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', partNo, 'PC01', 'R.LINE1', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 2);
    assert.deepStrictEqual(res.body.data.map((r) => r.PIC).sort(), ['PC', 'R']);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: identical Kanban Print Address across two time-overlapping valid rows collapses to one row, distinct Lineside addresses stay (real SH/D-07/FN1 example)', async () => {
  const batchId = 'TEST-ADDR-SAMEKANBAN-' + Date.now();
  const partNo = '909801000000'; // stand-in for the real 9.09801E+11-style part number
  await seedBatch(batchId, { partNo, dock: 'SH' });

  try {
    // Both rows share the exact same Kanban Print Address ('D    -  07') but
    // have genuinely different Lineside Addresses — the Kanban row must only
    // appear once, while both Lineside rows must still appear.
    const addrRows = [
      ['20251106', '99991231', 'SH', partNo, 'D    -  07', 'FN1  - R09', 'TEST PART'],
      ['20260126', '99991231', 'SH', partNo, 'D    -  07', 'FN1  - R11', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 3, 'the duplicated Kanban address must collapse to one row, not appear twice');
    assert.deepStrictEqual(
      res.body.data.map((r) => r.Addr).sort(),
      ['D    -  07', 'FN1  - R09', 'FN1  - R11'].sort()
    );
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: the fallback (part-name) lookup surfaces multiple valid rows sharing a part name, not just the last one parsed', async () => {
  const batchId = 'TEST-ADDR-FALLBACK-MULTIROW-' + Date.now();
  const partNo = '999888777666';
  const partDesc = 'UNIQUE FALLBACK PART';
  await seedBatch(batchId, { partNo, dock: 'ZZ', partDesc });

  try {
    // Neither Address Master row's DOCK+PART # matches the Target R/O part
    // (ZZ + 999888777666) directly — both only match via PART DESC, so this
    // exercises the partNameAddrLookup fallback path. Both are valid and
    // have genuinely different addresses; both must surface, not just one.
    const addrRows = [
      ['20180101', '99991231', 'XX', '000000000001', 'WH01', '', partDesc],
      ['20180101', '99991231', 'YY', '000000000002', 'WH02', '', partDesc],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 0);
    assert.strictEqual(res.body.data.length, 2, 'both fallback-matched rows must surface, not just the last one parsed');
    assert.deepStrictEqual(res.body.data.map((r) => r.Addr).sort(), ['WH01', 'WH02']);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr (Part A): a part with no direct Address Master match borrows the resolved address from a sibling part sharing the same Part Procurement PART DESC', async () => {
  const batchId = 'TEST-ADDR-SIBLING-FALLBACK-' + Date.now();
  const partDesc = 'BUMPER ASSY FR';

  // X has a direct Address Master match; Y shares X's PART DESC (from Part
  // Procurement, not Address Master — the real name source per Part A) but
  // has a genuinely different Dock+PartNo with no Address Master row of its
  // own at all.
  await seedBatch(batchId, { partNo: '111111111111', dock: 'ZZ', supplier: 'SUPX', partDesc });
  await seedBatch(batchId, { partNo: '222222222222', dock: 'YY', supplier: 'SUPY', partDesc });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', '111111111111', 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 0, 'Y must resolve via the sibling fallback, not fall through to Hold');
    assert.strictEqual(res.body.data.length, 2);

    const rowX = res.body.data.find((r) => r['Part no.'] === '111111111111');
    const rowY = res.body.data.find((r) => r['Part no.'] === '222222222222');
    assert.ok(rowX, 'X (direct match) must still produce its own row');
    assert.ok(rowY, 'Y (borrowed via sibling fallback) must produce a row too');
    assert.strictEqual(rowX.Addr, 'WH01');
    // Y borrows the same physical address X resolved directly, but keeps
    // its own identity (Dock, Supplier, Part no.) — it isn't a copy of X,
    // and it goes through the exact same buildPartRows/dedup logic as X.
    assert.strictEqual(rowY.Addr, 'WH01');
    assert.strictEqual(rowY.Dock, 'YY');
    assert.strictEqual(rowY.Supplier, 'SUPY');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr (Part A): a part with a genuinely unique name and no direct match gets no false-positive sibling match, still goes to Hold with no output row (Part B is out of scope here)', async () => {
  const batchId = 'TEST-ADDR-SIBLING-NOFALSEPOS-' + Date.now();

  // X resolves directly. Z shares no name with X and has no Address Master
  // row of its own — it must NOT borrow X's address just because X resolved
  // something in the same batch.
  await seedBatch(batchId, { partNo: '111111111111', dock: 'ZZ', partDesc: 'BUMPER ASSY FR' });
  await seedBatch(batchId, { partNo: '333333333333', dock: 'WW', partDesc: 'SUPPORT UREA TANK FILLER PIPE NO.1' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', '111111111111', 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 1, 'Z has no sibling to borrow from, so it must genuinely go to Hold');
    assert.strictEqual(res.body.hold[0]['Part No'], '333333333333');
    assert.strictEqual(res.body.hold[0]['Reason'], 'Missing in Address Master');

    // Part B (a MANUAL/NOT FOUND output row for unresolved parts) is out of
    // scope for this task — Z must NOT appear in data at all, same as today.
    assert.strictEqual(res.body.data.length, 1, 'only X (the direct match) produces a row; Z produces none');
    assert.strictEqual(res.body.data[0]['Part no.'], '111111111111');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: a part with no direct match and no part-name match still goes to Hold, unchanged', async () => {
  const batchId = 'TEST-ADDR-NOMATCH-' + Date.now();
  const partNo = '123123123123';
  await seedBatch(batchId, { partNo, dock: 'ZZ', partDesc: 'NEVER MATCHED PART' });

  try {
    // Address Master has a row, but neither its DOCK+PART # nor its PART DESC
    // matches this part in any way.
    const addrRows = [
      ['20180101', '99991231', 'XX', '000000000001', 'WH01', '', 'SOME OTHER PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 0);
    assert.strictEqual(res.body.hold.length, 1);
    assert.strictEqual(res.body.hold[0]['Part No'], partNo);
    assert.strictEqual(res.body.hold[0]['Reason'], 'Missing in Address Master');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr: a key with zero valid Address Master rows (all expired) still goes to Hold, unchanged from today', async () => {
  const batchId = 'TEST-ADDR-ALLEXPIRED-' + Date.now();
  const partNo = '444555666777';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    const addrRows = [
      ['20180101', '20200101', 'ZZ', partNo, 'WH01', '', 'TEST PART'], // expired
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 0);
    assert.strictEqual(res.body.hold.length, 1);
    assert.strictEqual(res.body.hold[0]['Part No'], partNo);
    assert.strictEqual(res.body.hold[0]['Reason'], 'Missing in Address Master');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr (Task 1): a successful run upserts finalData/holdData/remindData into handheld_results, without changing the response shape', async () => {
  const batchId = 'TEST-ADDR-PERSIST-' + Date.now();
  const partNo = '555444333222';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', partNo, 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    // Response shape is unchanged — still success/data/hold/remind/duplicateKeys.
    assert.deepStrictEqual(Object.keys(res.body).sort(), ['data', 'duplicateKeys', 'hold', 'remind', 'success'].sort());

    const db = await connectDB();
    const row = await db.get('SELECT final_data, hold_data, remind_data, updated_at FROM handheld_results WHERE batch_id = ?', batchId);
    assert.ok(row, 'a row must be upserted for this batch');
    assert.deepStrictEqual(JSON.parse(row.final_data), res.body.data);
    assert.deepStrictEqual(JSON.parse(row.hold_data), res.body.hold);
    assert.deepStrictEqual(JSON.parse(row.remind_data), res.body.remind);
    assert.ok(row.updated_at);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleGetFinalData (Task 1): returns persisted data for a processed batch, and a clear 404 for a batch never processed', async () => {
  const batchId = 'TEST-ADDR-GETFINAL-' + Date.now();
  const partNo = '111222333444';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    // Not processed yet — must be a clear "not found", not an empty success.
    const notFoundRes = mockRes();
    await handleGetFinalData({ query: { batchId } }, notFoundRes);
    assert.strictEqual(notFoundRes.statusCode, 404);
    assert.ok(notFoundRes.body.error);

    const addrRows = [
      ['20180101', '99991231', 'ZZ', partNo, 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);
    const processRes = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, processRes);

    const foundRes = mockRes();
    await handleGetFinalData({ query: { batchId } }, foundRes);
    assert.strictEqual(foundRes.statusCode, 200);
    assert.strictEqual(foundRes.body.success, true);
    assert.deepStrictEqual(foundRes.body.data, processRes.body.data);
    assert.deepStrictEqual(foundRes.body.hold, processRes.body.hold);
    assert.deepStrictEqual(foundRes.body.remind, processRes.body.remind);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleGetFinalData (Task 1): missing batchId is a 400', async () => {
  const res = mockRes();
  await handleGetFinalData({ query: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('handleSaveFinalData (Task 1): a PIC drag-and-drop reassignment persists and is visible via a re-fetch of final-data', async () => {
  const batchId = 'TEST-ADDR-SAVEFINAL-' + Date.now();
  const partNo = '666777888999';
  await seedBatch(batchId, { partNo, dock: 'ZZ' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', partNo, 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);
    const processRes = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, processRes);
    assert.strictEqual(processRes.body.data.length, 1);

    // Simulate the frontend's PIC drag-and-drop: reassign PIC on the one row.
    const reassigned = processRes.body.data.map((row) => ({ ...row, PIC: 'MANUAL-Z' }));
    const saveRes = mockRes();
    await handleSaveFinalData({ body: { batchId, data: reassigned } }, saveRes);
    assert.strictEqual(saveRes.statusCode, 200);
    assert.strictEqual(saveRes.body.success, true);

    const refetchRes = mockRes();
    await handleGetFinalData({ query: { batchId } }, refetchRes);
    assert.strictEqual(refetchRes.body.data[0].PIC, 'MANUAL-Z', 'the reassignment must be visible via a fresh fetch, not just in-memory');
    // Hold/Remind must be untouched by a PIC-only save.
    assert.deepStrictEqual(refetchRes.body.hold, processRes.body.hold);
    assert.deepStrictEqual(refetchRes.body.remind, processRes.body.remind);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleSaveFinalData (Task 1): saving for a batch that was never processed is a clear 404, not a silent no-op success', async () => {
  const batchId = 'TEST-ADDR-SAVENOPROCESS-' + Date.now();
  try {
    const res = mockRes();
    await handleSaveFinalData({ body: { batchId, data: [{ PIC: 'A' }] } }, res);
    assert.strictEqual(res.statusCode, 404);
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleSaveFinalData (Task 1): a non-array data payload is rejected with 400', async () => {
  const res = mockRes();
  await handleSaveFinalData({ body: { batchId: 'TEST-ADDR-SAVEBADTYPE', data: 'not-an-array' } }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('handleProcessAssignAddr (Task 2a - Pass 3): a part unresolved by direct match and by name-sibling match still borrows via a 5-char Part No prefix match with a directly-resolved sibling', async () => {
  const batchId = 'TEST-ADDR-PREFIX-FALLBACK-' + Date.now();

  // X has a direct Address Master match. Y shares X's first 5 Part No
  // characters ('77916') but has its own distinct PART DESC (so Pass 2's
  // name fallback can't resolve it) and its own distinct Dock+PartNo (so
  // Pass 1's direct match can't resolve it either) — only Pass 3's prefix
  // fallback can resolve Y.
  await seedBatch(batchId, { partNo: '77916K05000', dock: 'ZZ', supplier: 'SUPX', partDesc: 'PART X UNIQUE NAME' });
  await seedBatch(batchId, { partNo: '77916Z09999', dock: 'QQ', supplier: 'SUPY', partDesc: 'PART Y UNIQUE NAME' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', '77916K05000', 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 0, 'Y must resolve via the prefix fallback, not fall through to Hold');
    assert.strictEqual(res.body.data.length, 2);

    const rowX = res.body.data.find((r) => r['Part no.'] === '77916K05000');
    const rowY = res.body.data.find((r) => r['Part no.'] === '77916Z09999');
    assert.ok(rowX, 'X (direct match) must still produce its own row');
    assert.ok(rowY, 'Y (borrowed via the prefix fallback) must produce a row too');
    assert.strictEqual(rowX.Addr, 'WH01');
    assert.strictEqual(rowY.Addr, 'WH01');
    assert.strictEqual(rowY.Dock, 'QQ');
    assert.strictEqual(rowY.Supplier, 'SUPY');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr (Task 2a - Pass 3): a part sharing no prefix with anything resolved still goes to Hold, unchanged', async () => {
  const batchId = 'TEST-ADDR-PREFIX-NOMATCH-' + Date.now();

  // X resolves directly (prefix '77916'). Z shares no name, no direct
  // match, and no 5-char Part No prefix with X (prefix '99999') — it must
  // still genuinely go to Hold, same as before this task.
  await seedBatch(batchId, { partNo: '77916K05000', dock: 'ZZ', partDesc: 'PART X UNIQUE NAME' });
  await seedBatch(batchId, { partNo: '99999Z09999', dock: 'WW', partDesc: 'PART Z UNIQUE NAME' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', '77916K05000', 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 1, 'Z has no prefix sibling to borrow from, so it must genuinely go to Hold');
    assert.strictEqual(res.body.hold[0]['Part No'], '99999Z09999');
    assert.strictEqual(res.body.hold[0]['Reason'], 'Missing in Address Master');
    assert.strictEqual(res.body.data.length, 1, 'only X (the direct match) produces a row; Z produces none');
  } finally {
    await cleanupBatch(batchId);
  }
});

test('handleProcessAssignAddr (Task 2a - Pass 3): the prefix fallback is built only from Pass 1 direct matches, never from a Pass 2 name-borrowed resolution', async () => {
  const batchId = 'TEST-ADDR-PREFIX-NOSOURCEFROMPASS2-' + Date.now();

  // X resolves directly (prefix '77916'). W has no direct match but shares
  // X's PART DESC, so Pass 2 resolves W by borrowing X's address (prefix
  // '55555', unrelated to X's prefix). Q shares W's prefix ('55555') but not
  // W's name, and has no direct match of its own. If the prefix fallback
  // were (incorrectly) sourced from W's Pass 2 resolution, Q would resolve
  // by borrowing a second time, one step further removed from Address
  // Master. It must not: Q must still go to Hold.
  await seedBatch(batchId, { partNo: '77916K05000', dock: 'ZZ', supplier: 'SUPX', partDesc: 'SHARED NAME' });
  await seedBatch(batchId, { partNo: '55555Z09999', dock: 'YY', supplier: 'SUPY', partDesc: 'SHARED NAME' });
  await seedBatch(batchId, { partNo: '55555Q00000', dock: 'WW', supplier: 'SUPZ', partDesc: 'UNIQUE NAME FOR Q' });

  try {
    const addrRows = [
      ['20180101', '99991231', 'ZZ', '77916K05000', 'WH01', '', 'TEST PART'],
    ];
    const addrBuffer = bufferFromAoa([ADDR_HEADERS, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    // X resolves directly, W resolves via Pass 2 (name sibling of X).
    assert.strictEqual(res.body.data.length, 2);
    assert.ok(res.body.data.find((r) => r['Part no.'] === '77916K05000'), 'X (direct match) must produce a row');
    assert.ok(res.body.data.find((r) => r['Part no.'] === '55555Z09999'), 'W (Pass 2 name fallback) must produce a row');
    assert.ok(!res.body.data.find((r) => r['Part no.'] === '55555Q00000'), 'Q must not resolve via a prefix borrowed from a Pass 2 resolution');

    assert.strictEqual(res.body.hold.length, 1, 'Q must genuinely go to Hold, unresolved by all three passes');
    assert.strictEqual(res.body.hold[0]['Part No'], '55555Q00000');
    assert.strictEqual(res.body.hold[0]['Reason'], 'Missing in Address Master');
  } finally {
    await cleanupBatch(batchId);
  }
});