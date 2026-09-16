const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { initDB, connectDB } = require('../database');
const { initSocketHub, EVENTS } = require('../lib/socketHub');
const { handlePreviewMain, handleDownloadMain, handleDownloadNewParts } = require('./mainFormatRoute');
const { handleProcessAssignAddr } = require('../handheld_part_list/assignAddrRoute');
const { setBaselineBatch } = require('../lib/batches');

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
    // Round-trip through JSON like the real wire format Express's res.json()
    // produces — undefined-valued keys are dropped, matching what a real
    // client would actually see.
    json(payload) { this.body = JSON.parse(JSON.stringify(payload)); return this; },
    setHeader(key, value) { this.headers[key] = value; },
    send(buf) { this.body = buf; return this; },
  };
}

// download-main reads a template file that isn't checked into the repo
// (backend/templates/ is gitignored — it's provided at deploy time). Create a
// minimal stand-in only if one isn't already present, and remove only what we
// created.
const TEMPLATE_PATH = path.join(__dirname, '../templates/MainFormat.xlsx');
let createdTemplateForTest = false;

async function seedBatch(batchId) {
  const db = await connectDB();
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);

  const tgRow = {
    'Part No 12 Digits': '123456789012',
    'Supplier': 'SUPX',
    'Dock IH routing': 'ZZ',
    'Source': '1',
  };
  await db.run(
    'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify(tgRow), now]
  );

  const ppRow = {
    'T/C TO (UNL)': '20991231',
    'DOCK': 'ZZ',
    'Production Routing': '',
    'PART #': '123456789012',
    'PART DESC': 'TEST PART',
    'COMP': 'C1',
    'SUPL': 'SUPX',
    'PLANT': 'P1',
    'S.DOCK': 'SD1',
    'KBN': 'K1',
    'Model Name': 'MODL',
    'Life Cycle Code': 'L1',
    'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1',
    'V.SHARE VALUE': 'VV1',
    'ORD Method': 'OM1',
    'QTY /CONT': '10',
    'PACK QTY/CONT': '20',
  };
  await db.run(
    'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify(ppRow), now]
  );
}

// Two rows share Dock IH routing + Part No 12 Digits (=> identical keyTG)
// but differ in "CTL routing" — a real, unused source column (confirmed via
// grep to be referenced nowhere in this codebase) standing in for the
// real-world duplicate-entry scenario this dedup targets. A third row is a
// genuinely different part and must never be dropped by the dedup.
async function seedBatchWithDuplicateTgRows(batchId) {
  const db = await connectDB();
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);

  const tgRows = [
    {
      'Part No 12 Digits': '123456789012',
      'Supplier': 'SUPX',
      'Dock IH routing': 'ZZ',
      'Source': '1',
      'CTL routing': 'CTL-FIRST',
    },
    {
      'Part No 12 Digits': '123456789012',
      'Supplier': 'SUPX',
      'Dock IH routing': 'ZZ',
      'Source': '1',
      'CTL routing': 'CTL-SECOND',
    },
    {
      'Part No 12 Digits': '223456789013',
      'Supplier': 'SUPY',
      'Dock IH routing': 'YY',
      'Source': '1',
    },
  ];
  for (const row of tgRows) {
    await db.run(
      'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
      [batchId, 'RAW', JSON.stringify(row), now]
    );
  }

  const ppRows = [
    {
      'T/C TO (UNL)': '20991231',
      'DOCK': 'ZZ',
      'Production Routing': '',
      'PART #': '123456789012',
      'PART DESC': 'TEST PART A',
      'COMP': 'C1',
      'SUPL': 'SUPX',
      'PLANT': 'P1',
      'S.DOCK': 'SD1',
      'KBN': 'K1',
      'Model Name': 'MODL',
      'Life Cycle Code': 'L1',
      'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1',
      'V.SHARE VALUE': 'VV1',
      'ORD Method': 'OM1',
      'QTY /CONT': '10',
      'PACK QTY/CONT': '20',
    },
    {
      'T/C TO (UNL)': '20991231',
      'DOCK': 'YY',
      'Production Routing': '',
      'PART #': '223456789013',
      'PART DESC': 'TEST PART B',
      'COMP': 'C2',
      'SUPL': 'SUPY',
      'PLANT': 'P2',
      'S.DOCK': 'SD2',
      'KBN': 'K2',
      'Model Name': 'MODL',
      'Life Cycle Code': 'L1',
      'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1',
      'V.SHARE VALUE': 'VV1',
      'ORD Method': 'OM1',
      'QTY /CONT': '10',
      'PACK QTY/CONT': '20',
    },
  ];
  for (const row of ppRows) {
    await db.run(
      'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
      [batchId, 'RAW', JSON.stringify(row), now]
    );
  }
}

async function cleanupBatch(batchId) {
  const db = await connectDB();
  await db.run('DELETE FROM target_ro WHERE batch_id = ?', batchId);
  await db.run('DELETE FROM part_procurement WHERE batch_id = ?', batchId);
  await db.run('DELETE FROM upload_batches WHERE batch_id = ?', batchId);
}

// getPreviousBatchId's chronological fallback is a genuinely global, unscoped
// "most recent batch before this one" query — a real "now" timestamp for
// every batch leaves a window where some other, concurrently-running test
// file's own real-time batch could land in between and get picked instead.
// Pre-inserting the upload_batches row ourselves with a fully controlled
// date in a year no other test uses (2099) makes ordering deterministic and
// immune to any real-time interloper. handlePreviewMain doesn't create the
// batch row itself (unlike handleTargetRoUpload), so this is required, not
// just a safety net — and setStoredGroupPrefix's UPSERT only touches
// group_prefix on conflict, leaving this pre-set upload_date untouched.
async function preCreateBatchAt(batchId, isoDate) {
  const db = await connectDB();
  await db.run('INSERT INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, isoDate]);
}

async function seedTgRows(batchId, rows) {
  const db = await connectDB();
  const now = new Date().toISOString();
  for (const row of rows) {
    await db.run(
      'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
      [batchId, 'RAW', JSON.stringify(row), now]
    );
  }
}

async function seedPpRows(batchId, rows) {
  const db = await connectDB();
  const now = new Date().toISOString();
  for (const row of rows) {
    await db.run(
      'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
      [batchId, 'RAW', JSON.stringify(row), now]
    );
  }
}

// Minimal Part Procurement row matching a given Dock IH routing + Part No —
// enough for buildMainFormatRows to match and produce a full 27-column row.
function ppRowFor(dock, partNo, partDesc = 'TEST PART') {
  return {
    'T/C TO (UNL)': '20991231',
    'DOCK': dock,
    'Production Routing': '',
    'PART #': partNo,
    'PART DESC': partDesc,
    'COMP': 'C1',
    'SUPL': 'ABC',
    'PLANT': 'P1',
    'S.DOCK': 'SD1',
    'KBN': 'K1',
    'Model Name': 'MODL',
    'Life Cycle Code': 'L1',
    'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1',
    'V.SHARE VALUE': 'VV1',
    'ORD Method': 'OM1',
    'QTY /CONT': '10',
    'PACK QTY/CONT': '20',
  };
}

async function cleanupPrefixHistory(prefix) {
  const db = await connectDB();
  await db.run('DELETE FROM group_prefix_history WHERE prefix = ?', prefix);
}

test.before(async () => {
  await initDB();

  if (!fs.existsSync(TEMPLATE_PATH)) {
    fs.mkdirSync(path.dirname(TEMPLATE_PATH), { recursive: true });
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([['h0'], ['h1'], ['h2'], ['h3'], ['h4']]);
    xlsx.utils.book_append_sheet(wb, ws, 'Part List');
    xlsx.writeFile(wb, TEMPLATE_PATH);
    createdTemplateForTest = true;
  }
});

test.after(() => {
  if (createdTemplateForTest && fs.existsSync(TEMPLATE_PATH)) {
    fs.unlinkSync(TEMPLATE_PATH);
  }
});

test('handlePreviewMain: prefix in request persists to upload_batches and is used in the computed Group', async () => {
  const batchId = 'TEST-GP-PERSIST-' + Date.now();
  await seedBatch(batchId);
  try {
    const res = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'CUSTOM1' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data[0]['Group ID*'], 'CUSTOM1A1');

    const db = await connectDB();
    const row = await db.get('SELECT group_prefix FROM upload_batches WHERE batch_id = ?', batchId);
    assert.strictEqual(row.group_prefix, 'CUSTOM1');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('CUSTOM1');
  }
});

test('handlePreviewMain: providing a prefix also upserts group_prefix_history (insert new, then update last_used_at on reuse)', async () => {
  const batchId = 'TEST-GP-HISTUPSERT-' + Date.now();
  const prefix = 'HISTUPSERT-' + Date.now();
  await seedBatch(batchId);
  try {
    await handlePreviewMain({ query: { batchId, prefix } }, mockRes());

    const db = await connectDB();
    const rowsAfterFirst = await db.all('SELECT * FROM group_prefix_history WHERE prefix = ?', prefix);
    assert.strictEqual(rowsAfterFirst.length, 1);
    const firstSeenAt = rowsAfterFirst[0].last_used_at;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await handlePreviewMain({ query: { batchId, prefix } }, mockRes());

    const rowsAfterSecond = await db.all('SELECT * FROM group_prefix_history WHERE prefix = ?', prefix);
    assert.strictEqual(rowsAfterSecond.length, 1, 'must update the existing row, not duplicate it');
    assert.ok(rowsAfterSecond[0].last_used_at >= firstSeenAt);
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory(prefix);
  }
});

test('handlePreviewMain: a later call without prefix reuses the previously stored value, not the hardcoded default', async () => {
  const batchId = 'TEST-GP-REUSE-' + Date.now();
  await seedBatch(batchId);
  try {
    await handlePreviewMain({ query: { batchId, prefix: 'STORED9' } }, mockRes());

    const res2 = mockRes();
    await handlePreviewMain({ query: { batchId } }, res2);

    assert.strictEqual(res2.body.data[0]['Group ID*'], 'STORED9A1');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('STORED9');
  }
});

test('handlePreviewMain: a batch that never had a prefix set falls back to SR481D, and the fallback is recorded into group_prefix_history like any other prefix', async () => {
  const batchId = 'TEST-GP-DEFAULT-' + Date.now();
  await seedBatch(batchId);
  try {
    const res = mockRes();
    await handlePreviewMain({ query: { batchId } }, res);

    assert.strictEqual(res.body.data[0]['Group ID*'], 'SR481DA1');

    const db = await connectDB();
    const row = await db.get('SELECT * FROM group_prefix_history WHERE prefix = ?', 'SR481D');
    assert.ok(row, 'the untouched default must be recorded into history when actually used for a merge');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('SR481D');
  }
});

test('handlePreviewMain: hasBeenMerged is false for a batch with only uploads and no explicit Merge, even though data is already non-empty', async () => {
  const batchId = 'TEST-GP-NOTMERGED-' + Date.now();
  await seedBatch(batchId);
  try {
    // No prefix — mirrors the frontend's passive/background restore call
    // (refreshPreviewDataSilently), not an explicit Merge click.
    const res = mockRes();
    await handlePreviewMain({ query: { batchId } }, res);

    // buildMainFormatRows computes straight from stored raw data regardless
    // of whether Merge was ever clicked, so data is already non-empty here —
    // this is exactly why a frontend restore can't use "data.length > 0" as
    // its "was this genuinely merged" signal.
    assert.ok(res.body.data.length > 0, 'sanity check: preview data is computable without an explicit merge');
    assert.strictEqual(res.body.hasBeenMerged, false);
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('SR481D');
  }
});

test('handlePreviewMain: hasBeenMerged is true immediately after an explicit Merge (prefix provided), and stays true on a later passive re-view', async () => {
  const batchId = 'TEST-GP-MERGEDTRUE-' + Date.now();
  await seedBatch(batchId);
  try {
    const mergeRes = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'MERGEFLAG' } }, mergeRes);
    assert.strictEqual(mergeRes.body.hasBeenMerged, true);

    const laterRes = mockRes();
    await handlePreviewMain({ query: { batchId } }, laterRes);
    assert.strictEqual(laterRes.body.hasBeenMerged, true, 'a later passive re-view must still report the batch as merged');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('MERGEFLAG');
  }
});

test('handlePreviewMain: invalid prefix (each disallowed character, and empty string) is rejected with 400 and does not overwrite the stored value', async () => {
  const batchId = 'TEST-GP-INVALID-' + Date.now();
  await seedBatch(batchId);
  try {
    await handlePreviewMain({ query: { batchId, prefix: 'GOODPFX' } }, mockRes());

    const invalidPrefixes = ['', '   ', 'BAD/X', 'BAD\\X', 'BAD:X', 'BAD*X', 'BAD?X', 'BAD"X', 'BAD<X', 'BAD>X', 'BAD|X'];
    for (const bad of invalidPrefixes) {
      const res = mockRes();
      await handlePreviewMain({ query: { batchId, prefix: bad } }, res);
      assert.strictEqual(res.statusCode, 400, `expected 400 for prefix ${JSON.stringify(bad)}`);
      assert.ok(res.body.error);
    }

    const db = await connectDB();
    const row = await db.get('SELECT group_prefix FROM upload_batches WHERE batch_id = ?', batchId);
    assert.strictEqual(row.group_prefix, 'GOODPFX');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('GOODPFX');
  }
});

test('preview-main, download-main, and process-assign-addr all use the same stored prefix for one batchId', async () => {
  const batchId = 'TEST-GP-CROSS-' + Date.now();
  await seedBatch(batchId);
  try {
    const previewRes = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'CROSSPFX' } }, previewRes);
    const expectedGroup = 'CROSSPFXA1';
    assert.strictEqual(previewRes.body.data[0]['Group ID*'], expectedGroup);

    const downloadRes = mockRes();
    await handleDownloadMain({ query: { batchId, groups: expectedGroup } }, downloadRes);
    assert.strictEqual(downloadRes.statusCode, 200);
    assert.ok(Buffer.isBuffer(downloadRes.body));

    const wb = xlsx.read(downloadRes.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
    // 5 template header rows precede the data rows.
    assert.strictEqual(rows[5][2], expectedGroup);

    const addrHeaders = ['T/C FROM (UNL)', 'T/C TO (UNL)', 'DOCK', 'PART #', 'Kanban Print Address', 'Lineside Address', 'PART DESC'];
    const addrRow = ['20180101', '20991231', 'ZZ', '123456789012', 'WH01', '', 'TEST PART'];
    const addrBuffer = bufferFromAoa([addrHeaders, addrRow]);

    const assignRes = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, assignRes);
    assert.strictEqual(assignRes.statusCode, 200);
    assert.strictEqual(assignRes.body.data.length, 1);
    assert.strictEqual(assignRes.body.data[0].Group, expectedGroup);
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('CROSSPFX');
  }
});

test('handlePreviewMain: emits batch:mergeUpdated on a real merge (prefix provided), but not on a passive history re-view (no prefix)', async () => {
  const batchId = 'TEST-GP-EMIT-' + Date.now();
  await seedBatch(batchId);
  const emitted = [];
  initSocketHub({ emit: (name, payload) => emitted.push({ name, payload }) });

  try {
    await handlePreviewMain({ query: { batchId, prefix: 'EMITPFX' } }, mockRes());
    assert.ok(emitted.some((e) => e.name === EVENTS.BATCH_MERGE_UPDATED && e.payload.batchId === batchId));

    emitted.length = 0;
    await handlePreviewMain({ query: { batchId } }, mockRes());
    assert.ok(!emitted.some((e) => e.name === EVENTS.BATCH_MERGE_UPDATED), 'a passive re-view without a prefix must not broadcast');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('EMITPFX');
  }
});

test('handleProcessAssignAddr: emits handheld:updated on success', async () => {
  const batchId = 'TEST-GP-HANDHELDEMIT-' + Date.now();
  await seedBatch(batchId);
  const emitted = [];
  initSocketHub({ emit: (name, payload) => emitted.push({ name, payload }) });

  try {
    const addrHeaders = ['T/C FROM (UNL)', 'T/C TO (UNL)', 'DOCK', 'PART #', 'Kanban Print Address', 'Lineside Address', 'PART DESC'];
    const addrRow = ['20180101', '20991231', 'ZZ', '123456789012', 'WH01', '', 'TEST PART'];
    const addrBuffer = bufferFromAoa([addrHeaders, addrRow]);

    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, mockRes());
    assert.ok(emitted.some((e) => e.name === EVENTS.HANDHELD_UPDATED && e.payload.batchId === batchId));
  } finally {
    await cleanupBatch(batchId);
  }
});

test('a Part Procurement field containing only a space produces a true empty string in preview-main, download-main, and process-assign-addr output', async () => {
  const batchId = 'TEST-GP-WHITESPACE-' + Date.now();
  const db = await connectDB();
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);

  const tgRow = {
    'Part No 12 Digits': '123456789012',
    'Supplier': 'SUPX',
    'Dock IH routing': 'ZZ',
    'Source': '1',
  };
  await db.run(
    'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify(tgRow), now]
  );

  // COMP, PLANT, V.SHARE FLG, and V.SHARE VALUE are whitespace-only — a
  // stand-in for a spacebar-instead-of-empty data entry artifact.
  const ppRow = {
    'T/C TO (UNL)': '20991231',
    'DOCK': 'ZZ',
    'Production Routing': '',
    'PART #': '123456789012',
    'PART DESC': 'TEST PART',
    'COMP': ' ',
    'SUPL': 'SUPX',
    'PLANT': ' ',
    'S.DOCK': 'SD1',
    'KBN': 'K1',
    'Model Name': 'MODL',
    'Life Cycle Code': 'L1',
    'V.SHARE FLG[SYS L/O DATE BASIS]': ' ',
    'V.SHARE VALUE': ' ',
    'ORD Method': 'OM1',
    'QTY /CONT': '10',
    'PACK QTY/CONT': '20',
  };
  await db.run(
    'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify(ppRow), now]
  );

  try {
    const previewRes = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'WSPFX' } }, previewRes);
    const previewRow = previewRes.body.data[0];
    assert.strictEqual(previewRow['Receiving company*'], '');
    assert.strictEqual(previewRow['Supplier plant code*'], '');
    assert.strictEqual(previewRow['Vender share type'], '');
    assert.strictEqual(previewRow['Vender share value'], '');

    const downloadRes = mockRes();
    await handleDownloadMain({ query: { batchId, groups: 'WSPFXA1' } }, downloadRes);
    const wb = xlsx.read(downloadRes.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const dataRow = rows[5]; // 5 template header rows precede the data rows.
    // Positional layout from generateDataRow: [.., COMP(idx6), .., PLANT(idx11), .., V.SHARE FLG(idx20), V.SHARE VALUE(idx21), ..]
    assert.strictEqual(dataRow[6], '');
    assert.strictEqual(dataRow[11], '');
    assert.strictEqual(dataRow[20], '');
    assert.strictEqual(dataRow[21], '');

    const addrHeaders = ['T/C FROM (UNL)', 'T/C TO (UNL)', 'DOCK', 'PART #', 'Kanban Print Address', 'Lineside Address', 'PART DESC'];
    const addrRow = ['20180101', '20991231', 'ZZ', '123456789012', 'WH01', '', 'TEST PART'];
    const addrBuffer = bufferFromAoa([addrHeaders, addrRow]);
    const assignRes = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, assignRes);
    assert.strictEqual(assignRes.body.data[0]['S.plant'], '');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('WSPFX');
  }
});

test('handleDownloadMain: a whitespace-only Part Procurement field writes a genuinely absent cell, not an empty-string cell (Pivot Table blank-count fix)', async () => {
  const batchId = 'TEST-XLSX-BLANKCELL-' + Date.now();
  const db = await connectDB();
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);

  const tgRow = {
    'Part No 12 Digits': '123456789012',
    'Supplier': 'SUPX',
    'Dock IH routing': 'ZZ',
    'Source': '1',
  };
  await db.run(
    'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify(tgRow), now]
  );

  // COMP is whitespace-only — blankOrTrim reduces it to '' for the JSON
  // preview, but the written .xlsx must not carry that '' into a real cell.
  const ppRow = {
    'T/C TO (UNL)': '20991231',
    'DOCK': 'ZZ',
    'Production Routing': '',
    'PART #': '123456789012',
    'PART DESC': 'TEST PART',
    'COMP': '   ',
    'SUPL': 'SUPX',
    'PLANT': 'P1',
    'S.DOCK': 'SD1',
    'KBN': 'K1',
    'Model Name': 'MODL',
    'Life Cycle Code': 'L1',
    'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1',
    'V.SHARE VALUE': 'VV1',
    'ORD Method': 'OM1',
    'QTY /CONT': '10',
    'PACK QTY/CONT': '20',
  };
  await db.run(
    'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
    [batchId, 'RAW', JSON.stringify(ppRow), now]
  );

  try {
    const previewRes = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'BLANKCELL' } }, previewRes);
    // Preview/JSON output is unaffected by this fix — still a true empty string.
    assert.strictEqual(previewRes.body.data[0]['Receiving company*'], '');

    const downloadRes = mockRes();
    await handleDownloadMain({ query: { batchId, groups: 'BLANKCELLA1' } }, downloadRes);
    const wb = xlsx.read(downloadRes.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // 5 template header rows precede the data row, so the data row is sheet
    // row 6. "Receiving company*" (COMP) is column index 6 => column G.
    // Reading the raw cell (not via sheet_to_json's defval sugar) is the
    // point: a present-but-empty-string cell and a genuinely absent cell
    // both stringify to '' through defval, but only one is what Excel's
    // Pivot Table treats as blank.
    assert.strictEqual(ws['G6'], undefined, 'blank field must produce a genuinely absent cell, not an empty-string cell');
    // Sanity check: a real, non-blank field in the same row is still a real cell.
    assert.strictEqual(ws['K6'].v, 'SUPX'); // Supplier*
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('BLANKCELL');
  }
});

test('handlePreviewMain: two target_ro rows with identical Dock IH routing + Part No (same keyTG) collapse to one, keeping the first seen; a genuinely different part is untouched', async () => {
  const batchId = 'TEST-DEDUP-PREVIEW-' + Date.now();
  await seedBatchWithDuplicateTgRows(batchId);
  try {
    const res = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'DEDUPFX' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 2, 'the duplicate pair must collapse to one row, plus the one genuinely different part');

    const partNumbers = res.body.data.map((row) => row['Part No.*']);
    assert.deepStrictEqual(partNumbers.sort(), ['1234567890', '2234567890'].sort());
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('DEDUPFX');
  }
});

test('preview-main and download-main agree on row count for a batch containing the duplicate-keyTG scenario', async () => {
  const batchId = 'TEST-DEDUP-COUNT-' + Date.now();
  await seedBatchWithDuplicateTgRows(batchId);
  try {
    const previewRes = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'DEDUPCNT' } }, previewRes);
    assert.strictEqual(previewRes.body.data.length, 2);

    // Both matched rows resolve to the same Shop ('A', neither ZZ nor YY is
    // SW/S9/SK) and the same Source ('1'), so they share one Group — a
    // single-group download, which handleDownloadMain sends directly as one
    // .xlsx rather than a .zip.
    const groups = [...new Set(previewRes.body.data.map((row) => row['Group ID*']))];
    assert.strictEqual(groups.length, 1);

    const downloadRes = mockRes();
    await handleDownloadMain({ query: { batchId, groups: groups[0] } }, downloadRes);
    assert.strictEqual(downloadRes.statusCode, 200);
    assert.ok(Buffer.isBuffer(downloadRes.body));

    const wb = xlsx.read(downloadRes.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
    // Rows: 5 template header rows + data rows + one "END" sentinel row.
    const totalDataRows = rows.length - 5 - 1;

    assert.strictEqual(totalDataRows, previewRes.body.data.length, 'download-main and preview-main must agree on row count for the same batch');
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('DEDUPCNT');
  }
});

test('handlePreviewMain: two target_ro rows with genuinely different keyTG both still appear (dedup is not overly aggressive)', async () => {
  const batchId = 'TEST-DEDUP-REGRESSION-' + Date.now();
  await seedBatchWithDuplicateTgRows(batchId);
  try {
    const res = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'DEDUPREG' } }, res);
    // Confirms both distinct parts survive even though a duplicate pair
    // was also collapsed to one — the same assertion as the first test,
    // phrased as the explicit "not overly aggressive" regression check.
    assert.strictEqual(res.body.data.length, 2);
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('DEDUPREG');
  }
});

test('handleProcessAssignAddr: the keyTG dedup composes correctly with the Dock=Supplier drop', async () => {
  const batchId = 'TEST-DEDUP-HANDHELD-COMPOSE-' + Date.now();
  const db = await connectDB();
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);

  // Part A: a Dock=Supplier pair (Dock IH routing === Supplier) — per the
  // Zone Assignment Rules / Handheld-process spec discussion, cleanTargetRow
  // now drops these entirely for mode 'handheld' too (previously kept +
  // deduped; confirmed wrong against the original spec, which drops
  // Dock=Supplier universally, Main and Handheld alike).
  // Part B: a general keyTG duplicate pair (same Dock IH routing + Part No)
  // differing only in an unused source column — dedup this task adds.
  // Part C: a genuinely different part, must never be dropped by either rule.
  const tgRows = [
    { 'Part No 12 Digits': 'AAAAAAAAAAAA', 'Supplier': 'SUPD', 'Dock IH routing': 'SUPD', 'Source': 'S1' },
    { 'Part No 12 Digits': 'AAAAAAAAAAAA', 'Supplier': 'SUPD', 'Dock IH routing': 'SUPD', 'Source': 'S2' },
    { 'Part No 12 Digits': 'BBBBBBBBBBBB', 'Supplier': 'SUPX', 'Dock IH routing': 'ZZ', 'Source': '1', 'CTL routing': 'CTL-FIRST' },
    { 'Part No 12 Digits': 'BBBBBBBBBBBB', 'Supplier': 'SUPX', 'Dock IH routing': 'ZZ', 'Source': '1', 'CTL routing': 'CTL-SECOND' },
    { 'Part No 12 Digits': 'CCCCCCCCCCCC', 'Supplier': 'SUPY', 'Dock IH routing': 'YY', 'Source': '1' },
  ];
  for (const row of tgRows) {
    await db.run(
      'INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)',
      [batchId, 'RAW', JSON.stringify(row), now]
    );
  }

  const ppBase = {
    'T/C TO (UNL)': '20991231',
    'Production Routing': '',
    'COMP': 'C1',
    'PLANT': 'P1',
    'S.DOCK': 'SD1',
    'KBN': 'K1',
    'Model Name': 'MODL',
    'Life Cycle Code': 'L1',
    'V.SHARE FLG[SYS L/O DATE BASIS]': 'V1',
    'V.SHARE VALUE': 'VV1',
    'ORD Method': 'OM1',
    'QTY /CONT': '10',
    'PACK QTY/CONT': '20',
  };
  const ppRows = [
    { ...ppBase, 'DOCK': 'SUPD', 'PART #': 'AAAAAAAAAAAA', 'PART DESC': 'PART A', 'SUPL': 'SUPD' },
    { ...ppBase, 'DOCK': 'ZZ', 'PART #': 'BBBBBBBBBBBB', 'PART DESC': 'PART B', 'SUPL': 'SUPX' },
    { ...ppBase, 'DOCK': 'YY', 'PART #': 'CCCCCCCCCCCC', 'PART DESC': 'PART C', 'SUPL': 'SUPY' },
  ];
  for (const row of ppRows) {
    await db.run(
      'INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)',
      [batchId, 'RAW', JSON.stringify(row), now]
    );
  }

  try {
    const addrHeaders = ['T/C FROM (UNL)', 'T/C TO (UNL)', 'DOCK', 'PART #', 'Kanban Print Address', 'Lineside Address', 'PART DESC'];
    const addrRows = [
      ['20180101', '20991231', 'SUPD', 'AAAAAAAAAAAA', 'WH01', '', 'PART A'],
      ['20180101', '20991231', 'ZZ', 'BBBBBBBBBBBB', 'WH02', '', 'PART B'],
      ['20180101', '20991231', 'YY', 'CCCCCCCCCCCC', 'WH03', '', 'PART C'],
    ];
    const addrBuffer = bufferFromAoa([addrHeaders, ...addrRows]);

    const res = mockRes();
    await handleProcessAssignAddr({ file: { buffer: addrBuffer }, body: { batchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.hold.length, 0);
    assert.strictEqual(res.body.remind.length, 0);
    // Part A (Dock=Supplier) is dropped entirely now; Part B's keyTG
    // duplicate pair collapses to one; Part C is untouched.
    assert.strictEqual(res.body.data.length, 2);

    const partNumbers = res.body.data.map((row) => row['Part no.']).sort();
    assert.deepStrictEqual(partNumbers, ['BBBBBBBBBBBB', 'CCCCCCCCCCCC']);
  } finally {
    await cleanupBatch(batchId);
  }
});

// New-parts detection surfaces at Merge time (handlePreviewMain), not at
// Target R/O upload time — these three tests moved here from
// targetRoRoute.test.js when that trigger point moved.

// The 27 keys the Main Format 26/27-column construction always produces, in
// order — used to assert newParts rows have the exact same shape as
// previewData rows, not a separately maintained thinner format.
const MAIN_FORMAT_COLUMNS = [
  'Company*', 'Company plant code*', 'Group ID*', 'CTL flag*', 'Part No.*', 'Suffix*',
  'Receiving company*', 'Receiving company plant code*', 'Production process routing',
  'Dock code*', 'Supplier*', 'Supplier plant code*', 'Supplier shipping dock',
  'Previous process routing', 'Dummy', 'Kanban No.*', 'Source code*', 'Hikiate matching key*',
  'Model 1', 'Life cycle code*', 'Vender share type', 'Vender share value', 'Order method*',
  'Order lot*', 'Order lot size*', 'Round up flag*', 'Part name*',
];

test('handlePreviewMain: first-ever batch (no previous batch to compare against) flags every valid, matched row as new, in full Main Format column shape', async () => {
  const batchId = 'TEST-NEWPARTS-FIRST-' + Date.now();
  await preCreateBatchAt(batchId, '2099-01-01T00:00:00.000Z');
  await seedTgRows(batchId, [
    { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    { 'Part No 12 Digits': '222222222222', 'Supplier': 'ABC', 'Dock IH routing': 'ST', 'Source': '1' },
    { 'Part No 12 Digits': '', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' }, // blank part no — invalid, must not be flagged
  ]);
  await seedPpRows(batchId, [
    ppRowFor('SW', '111111111111', 'PART ONE'),
    ppRowFor('ST', '222222222222', 'PART TWO'),
  ]);

  try {
    const res = mockRes();
    await handlePreviewMain({ query: { batchId, prefix: 'NEWPFX1' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.newParts.length, 2);
    assert.deepStrictEqual(
      res.body.newParts.map((r) => r['Part No.*']).sort(),
      ['1111111111', '2222222222']
    );
    // Full Main Format shape, not the old raw Target R/O fields.
    for (const row of res.body.newParts) {
      assert.deepStrictEqual(Object.keys(row), MAIN_FORMAT_COLUMNS);
    }
    // Genuinely the same rows as previewData for the same parts — not a
    // separately constructed subset.
    const previewByPartNo = Object.fromEntries(res.body.data.map((r) => [r['Part No.*'], r]));
    for (const row of res.body.newParts) {
      assert.deepStrictEqual(row, previewByPartNo[row['Part No.*']]);
    }
  } finally {
    await cleanupBatch(batchId);
    await cleanupPrefixHistory('NEWPFX1');
  }
});

test('handlePreviewMain: a second batch only flags rows whose keyTG is not in the immediately-previous batch', async () => {
  const previousBatchId = 'TEST-NEWPARTS-PREV-' + Date.now();
  const currentBatchId = 'TEST-NEWPARTS-CUR-' + Date.now();

  try {
    await preCreateBatchAt(previousBatchId, '2099-01-01T00:00:00.000Z');
    await seedTgRows(previousBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);

    await preCreateBatchAt(currentBatchId, '2099-02-01T00:00:00.000Z');
    // Same part (111...) plus a genuinely new one (222...).
    await seedTgRows(currentBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
      { 'Part No 12 Digits': '222222222222', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);
    await seedPpRows(currentBatchId, [
      ppRowFor('SW', '111111111111'),
      ppRowFor('SW', '222222222222'),
    ]);

    const res = mockRes();
    await handlePreviewMain({ query: { batchId: currentBatchId, prefix: 'NEWPFX2' } }, res);

    assert.strictEqual(res.body.newParts.length, 1);
    assert.strictEqual(res.body.newParts[0]['Part No.*'], '2222222222');
    assert.deepStrictEqual(Object.keys(res.body.newParts[0]), MAIN_FORMAT_COLUMNS);
  } finally {
    await cleanupBatch(previousBatchId);
    await cleanupBatch(currentBatchId);
    await cleanupPrefixHistory('NEWPFX2');
  }
});

test('handlePreviewMain: an explicitly-set baseline is preferred over the chronologically-previous batch', async () => {
  const oldestBatchId = 'TEST-NEWPARTS-BASE-' + Date.now();
  const middleBatchId = 'TEST-NEWPARTS-MID-' + Date.now();
  const currentBatchId = 'TEST-NEWPARTS-CUR2-' + Date.now();

  try {
    // Oldest batch contains part 111 (the real reference point per the baseline).
    await preCreateBatchAt(oldestBatchId, '2099-01-01T00:00:00.000Z');
    await seedTgRows(oldestBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);

    // Middle (chronologically-previous) batch contains only an unrelated part.
    await preCreateBatchAt(middleBatchId, '2099-02-01T00:00:00.000Z');
    await seedTgRows(middleBatchId, [
      { 'Part No 12 Digits': '999999999999', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);

    const db = await connectDB();
    await setBaselineBatch(db, oldestBatchId);

    await preCreateBatchAt(currentBatchId, '2099-03-01T00:00:00.000Z');
    // Current batch re-includes 111 (present in the baseline) plus a genuinely new 222.
    await seedTgRows(currentBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
      { 'Part No 12 Digits': '222222222222', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);
    await seedPpRows(currentBatchId, [
      ppRowFor('SW', '111111111111'),
      ppRowFor('SW', '222222222222'),
    ]);

    const res = mockRes();
    await handlePreviewMain({ query: { batchId: currentBatchId, prefix: 'NEWPFX3' } }, res);

    // Without the baseline, 111 would also show as new (it isn't in "middle").
    // With the baseline preferred, only 222 is genuinely new.
    assert.strictEqual(res.body.newParts.length, 1);
    assert.strictEqual(res.body.newParts[0]['Part No.*'], '2222222222');
  } finally {
    await cleanupBatch(oldestBatchId);
    await cleanupBatch(middleBatchId);
    await cleanupBatch(currentBatchId);
    await cleanupPrefixHistory('NEWPFX3');
  }
});

test('handlePreviewMain: a new Target R/O row with no Part Procurement match is excluded from newParts, but still appears in remind', async () => {
  const previousBatchId = 'TEST-NEWPARTS-NOPPMATCH-PREV-' + Date.now();
  const currentBatchId = 'TEST-NEWPARTS-NOPPMATCH-CUR-' + Date.now();

  try {
    await preCreateBatchAt(previousBatchId, '2099-01-01T00:00:00.000Z');
    await seedTgRows(previousBatchId, []);

    await preCreateBatchAt(currentBatchId, '2099-02-01T00:00:00.000Z');
    // New part, but no matching Part Procurement row is seeded for it —
    // it can never produce a full 27-column row.
    await seedTgRows(currentBatchId, [
      { 'Part No 12 Digits': '333333333333', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);
    // No seedPpRows call — Part Procurement is empty for this batch.

    const res = mockRes();
    await handlePreviewMain({ query: { batchId: currentBatchId, prefix: 'NEWPFX4' } }, res);

    assert.strictEqual(res.body.newParts.length, 0);
    assert.strictEqual(res.body.remind.length, 1);
    assert.strictEqual(res.body.remind[0]['Part No'], '333333333333');
    assert.strictEqual(res.body.remind[0]['Reason'], 'Missing in Part Procurement');
  } finally {
    await cleanupBatch(previousBatchId);
    await cleanupBatch(currentBatchId);
    await cleanupPrefixHistory('NEWPFX4');
  }
});

test('handleDownloadNewParts: produces a .xlsx with the same 27-column Main Format layout as handleDownloadMain, filtered to new parts', async () => {
  const previousBatchId = 'TEST-DLNEWPARTS-PREV-' + Date.now();
  const currentBatchId = 'TEST-DLNEWPARTS-CUR-' + Date.now();

  try {
    await preCreateBatchAt(previousBatchId, '2099-01-01T00:00:00.000Z');
    await seedTgRows(previousBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);

    await preCreateBatchAt(currentBatchId, '2099-02-01T00:00:00.000Z');
    await seedTgRows(currentBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
      { 'Part No 12 Digits': '222222222222', 'Supplier': 'XYZ', 'Dock IH routing': 'ST', 'Source': '2' },
    ]);
    await seedPpRows(currentBatchId, [
      ppRowFor('SW', '111111111111'),
      ppRowFor('ST', '222222222222', 'NEW PART TWO'),
    ]);

    // Merge first, so download-main's own row-count-matches-preview
    // expectations elsewhere in this file stay meaningful; not required by
    // handleDownloadNewParts itself, which recomputes independently.
    await handlePreviewMain({ query: { batchId: currentBatchId, prefix: 'DLNEWPFX' } }, mockRes());

    const res = mockRes();
    await handleDownloadNewParts({ query: { batchId: currentBatchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(Buffer.isBuffer(res.body));

    const wb = xlsx.read(res.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
    // Same template shape as handleDownloadMain: 5 header rows + data rows + END.
    assert.strictEqual(rows.length, 5 + 1 + 1);
    const dataRow = rows[5];
    assert.strictEqual(dataRow[2], 'DLNEWPFXA2'); // Group ID* for shop A, source 2
    assert.strictEqual(dataRow[4], '2222222222'); // Part No.*
    assert.deepStrictEqual(rows[6], ['END']);
  } finally {
    await cleanupBatch(previousBatchId);
    await cleanupBatch(currentBatchId);
    await cleanupPrefixHistory('DLNEWPFX');
  }
});

test('handleDownloadNewParts: a whitespace-only Part Procurement field also writes a genuinely absent cell, not an empty-string cell', async () => {
  const previousBatchId = 'TEST-DLNEWPARTS-BLANKCELL-PREV-' + Date.now();
  const currentBatchId = 'TEST-DLNEWPARTS-BLANKCELL-CUR-' + Date.now();

  try {
    await preCreateBatchAt(previousBatchId, '2099-01-01T00:00:00.000Z');
    await seedTgRows(previousBatchId, []);

    await preCreateBatchAt(currentBatchId, '2099-02-01T00:00:00.000Z');
    await seedTgRows(currentBatchId, [
      { 'Part No 12 Digits': '333333333333', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);
    // COMP is whitespace-only, same as the handleDownloadMain blank-cell test.
    await seedPpRows(currentBatchId, [
      { ...ppRowFor('SW', '333333333333'), 'COMP': '   ' },
    ]);

    const res = mockRes();
    await handleDownloadNewParts({ query: { batchId: currentBatchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    const wb = xlsx.read(res.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Same layout as handleDownloadMain: data starts at row 6, COMP is
    // column index 6 => column G.
    assert.strictEqual(ws['G6'], undefined, 'blank field must produce a genuinely absent cell, not an empty-string cell');
  } finally {
    await cleanupBatch(previousBatchId);
    await cleanupBatch(currentBatchId);
  }
});

test('handleDownloadNewParts: zero new parts produces the template header rows plus END, no data rows — not an error', async () => {
  const batchId = 'TEST-DLNEWPARTS-EMPTY-' + Date.now();
  const secondBatchId = batchId + '-B';

  try {
    await preCreateBatchAt(batchId, '2099-01-01T00:00:00.000Z');
    await seedTgRows(batchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);
    await seedPpRows(batchId, [ppRowFor('SW', '111111111111')]);

    await preCreateBatchAt(secondBatchId, '2099-02-01T00:00:00.000Z');
    await seedTgRows(secondBatchId, [
      { 'Part No 12 Digits': '111111111111', 'Supplier': 'ABC', 'Dock IH routing': 'SW', 'Source': '1' },
    ]);
    await seedPpRows(secondBatchId, [ppRowFor('SW', '111111111111')]);

    const res = mockRes();
    await handleDownloadNewParts({ query: { batchId: secondBatchId } }, res);

    assert.strictEqual(res.statusCode, 200);
    const wb = xlsx.read(res.body, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
    assert.strictEqual(rows.length, 5 + 1); // 5 header rows + END, zero data rows
    assert.deepStrictEqual(rows[5], ['END']);
  } finally {
    await cleanupBatch(batchId);
    await cleanupBatch(secondBatchId);
  }
});

test('handleDownloadNewParts: missing batchId is a 400, unknown batchId is a 404', async () => {
  const missingRes = mockRes();
  await handleDownloadNewParts({ query: {} }, missingRes);
  assert.strictEqual(missingRes.statusCode, 400);

  const notFoundRes = mockRes();
  await handleDownloadNewParts({ query: { batchId: 'TEST-DLNEWPARTS-NOPE-' + Date.now() } }, notFoundRes);
  assert.strictEqual(notFoundRes.statusCode, 404);
});