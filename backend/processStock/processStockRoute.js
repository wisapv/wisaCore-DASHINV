const express = require('express');
const xlsx = require('xlsx');
const archiver = require('archiver');
const { connectDB } = require('../database');
const { computeMatchKey, FIELD_ORDER } = require('../ltbo/ltboImportRoute');

const router = express.Router();

// PIC → INV bucket, per the locked 22-zone → INV1-11 mapping (see the
// Inventory Sum design discussion). PIC is what handheld_stock_counts
// actually carries — it's coarser than the real zone list (see the Zone
// Assignment Rules backlog item: W should split into W_PC/W_SEQ/W_LINE,
// which map to INV7/INV8/INV9 respectively, but nothing distinguishes them
// yet). Every OTHER PIC maps cleanly to exactly one INV bucket (K's several
// real zones all land on INV10 regardless, so no ambiguity there).
const PIC_TO_INV = {
  A: [5], T: [11], K: [10], S4: [3], TTAT: [3], R: [6], PC: [2], S5: [3], ALS: [4],
  // W is genuinely ambiguous — see runProcessStock below for how it's
  // handled (duplicated into all three, not guessed into just one).
};
const W_AMBIGUOUS_INV_BUCKETS = [7, 8, 9];

// Free Zone's own zone codes map directly and unambiguously (each zone
// code IS the exact zone, no PIC-level coarseness — see the Free Zone
// design discussion), straight to their INV bucket.
const ZONE_CODE_TO_INV = {
  'S1_S-LANE': 1, 'S1_OVERFLOW': 1,
  'WH3_OVERFLOW': 2, 'WH3_PC': 2,
  'S4_S-LANE': 3, 'S4_OVERFLOW': 3, 'S5_RECEIVING': 3,
};

// Shops that sort collected Seq values ascending (SeqNo1 = smallest) vs the
// one exception that sorts descending (SeqNo1 = largest) — see the
// Inventory Sum / SeqNo design discussion: a Kanban counted at more than
// one address ends up with more than one Seq value; every shop except W
// sorts them ascending, only W sorts descending. Up to 3 are kept
// (SeqNo1-3, matching InventoryStock.xls's own column count) — fewer than
// 3 found just leaves the remaining slots blank, that's not an error.
const DESCENDING_SEQ_SHOPS = new Set(['W']);

async function runProcessStock(db, ltboBatchId) {
  const ltboBatch = await db.get('SELECT * FROM ltbo_import_batches WHERE batch_id = ?', ltboBatchId);
  if (!ltboBatch) throw Object.assign(new Error('LTBO import batch not found'), { status: 404 });
  const countingBatchId = ltboBatch.linked_batch_id;

  const masterRows = await db.all(
    'SELECT id, match_key, part_no, group_id FROM ltbo_master_rows WHERE batch_id = ?',
    ltboBatchId
  );

  // sums[match_key] = { inv: {1: n, ..., 11: n}, total: n, ambiguousW: bool, seqs: [{seq, shop}] }
  const sums = {};
  const addQty = (matchKey, invBuckets, qty, ambiguous) => {
    if (!qty) return;
    if (!sums[matchKey]) sums[matchKey] = { inv: {}, total: 0, ambiguousW: false, seqs: [] };
    const entry = sums[matchKey];
    entry.total += qty;
    if (ambiguous) entry.ambiguousW = true;
    invBuckets.forEach((n) => { entry.inv[n] = (entry.inv[n] || 0) + qty; });
  };
  const addSeq = (matchKey, seq, shop) => {
    if (seq === null || seq === undefined || seq === '') return;
    if (!sums[matchKey]) sums[matchKey] = { inv: {}, total: 0, ambiguousW: false, seqs: [] };
    sums[matchKey].seqs.push({ seq: Number(seq), shop });
  };

  // --- Fix zone counts: matched by PIC → INV bucket(s) ---
  const fixRows = await db.all(
    'SELECT pic, shop, dock, supplier, s_plant, s_dock, part_no, qty, seq FROM handheld_stock_counts WHERE batch_id = ?',
    countingBatchId
  );
  for (const row of fixRows) {
    const matchKey = computeMatchKey({
      dock: row.dock, supplier: row.supplier, supplierPlant: row.s_plant, supplierDock: row.s_dock, partNo: row.part_no,
    });
    const qty = Number(row.qty) || 0;
    if (row.pic === 'W') {
      // Placeholder per the design discussion: the SAME total goes into
      // all three candidate buckets (not split, not guessed into one) —
      // this means summing INV7+INV8+INV9 together over-counts W parts by
      // 3x until Zone Assignment Rules can actually tell the sub-zones
      // apart. Each field individually still shows the true W total.
      addQty(matchKey, W_AMBIGUOUS_INV_BUCKETS, qty, true);
    } else if (PIC_TO_INV[row.pic]) {
      addQty(matchKey, PIC_TO_INV[row.pic], qty, false);
    }
    // An unrecognized PIC contributes to nothing — see fileErrors-style
    // reporting below via unmappedPicCount if this ever shows up.
    if (!Number.isNaN(parseInt(row.seq, 10))) addSeq(matchKey, row.seq, row.shop);
  }

  // --- Free zone scans: matched by zone code → INV bucket ---
  const freeScans = await db.all('SELECT * FROM handheld_free_zone_scans WHERE batch_id = ?', countingBatchId);
  const assignments = await db.all(
    'SELECT pic AS dock, short_addr AS code, device_id FROM handheld_assignments WHERE batch_id = ?',
    countingBatchId
  );
  const zoneByDevice = {};
  for (const a of assignments) zoneByDevice[a.device_id] = a.code;

  for (const scan of freeScans) {
    const matchKey = computeMatchKey({
      dock: scan.dock, supplier: scan.supplier, supplierPlant: scan.s_plant, supplierDock: scan.s_dock, partNo: scan.part_no,
    });
    const zoneCode = zoneByDevice[scan.device_id];
    const invBucket = ZONE_CODE_TO_INV[zoneCode];
    if (invBucket) addQty(matchKey, [invBucket], Number(scan.qty) || 0, false);
  }

  // --- Compare against the master list, write results, block on gaps ---
  const now = new Date().toISOString();
  await db.run('DELETE FROM process_stock_results WHERE ltbo_batch_id = ?', ltboBatchId);

  let matchedCount = 0;
  const notFound = [];
  const ambiguousWParts = [];

  await db.run('BEGIN TRANSACTION');
  try {
    for (const master of masterRows) {
      const entry = sums[master.match_key];
      const status = entry ? 'matched' : 'not_found';
      if (status === 'matched') matchedCount += 1;
      else notFound.push({ matchKey: master.match_key, partNo: master.part_no, groupId: master.group_id });
      if (entry && entry.ambiguousW) ambiguousWParts.push({ matchKey: master.match_key, partNo: master.part_no });

      const inv = entry ? entry.inv : {};

      // Sort every Seq value found for this part across all its addresses
      // — descending only if any of them came from Shop W, ascending
      // otherwise (see DESCENDING_SEQ_SHOPS above) — then keep up to 3.
      let seqNo1 = null, seqNo2 = null, seqNo3 = null;
      if (entry && entry.seqs.length > 0) {
        const descending = entry.seqs.some((s) => DESCENDING_SEQ_SHOPS.has(s.shop));
        const sortedSeqs = entry.seqs.map((s) => s.seq).sort((a, b) => (descending ? b - a : a - b));
        const pad = (n) => String(n).padStart(3, '0');
        [seqNo1, seqNo2, seqNo3] = [sortedSeqs[0], sortedSeqs[1], sortedSeqs[2]].map((n) => (n === undefined ? null : pad(n)));
      }

      await db.run(
        `INSERT INTO process_stock_results
           (ltbo_batch_id, ltbo_row_id, match_key, part_no, group_id,
            inv_result_1, inv_result_2, inv_result_3, inv_result_4, inv_result_5,
            inv_result_6, inv_result_7, inv_result_8, inv_result_9, inv_result_10, inv_result_11,
            seq_no_1, seq_no_2, seq_no_3,
            total_qty, status, has_ambiguous_w, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ltboBatchId, master.id, master.match_key, master.part_no, master.group_id,
          inv[1] || 0, inv[2] || 0, inv[3] || 0, inv[4] || 0, inv[5] || 0,
          inv[6] || 0, inv[7] || 0, inv[8] || 0, inv[9] || 0, inv[10] || 0, inv[11] || 0,
          seqNo1, seqNo2, seqNo3,
          entry ? entry.total : 0, status, entry && entry.ambiguousW ? 1 : 0, now,
        ]
      );
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    ltboBatchId,
    countingBatchId,
    totalParts: masterRows.length,
    matchedCount,
    notFoundCount: notFound.length,
    notFound,
    ambiguousWParts,
    blocked: notFound.length > 0,
  };
}

// POST /api/process-stock/run — body: { ltboBatchId }
async function handleRun(req, res) {
  try {
    const { ltboBatchId } = req.body;
    if (!ltboBatchId) return res.status(400).json({ error: 'Missing ltboBatchId' });
    const db = await connectDB();
    const result = await runProcessStock(db, ltboBatchId);
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Process Stock error:', error);
    res.status(500).json({ error: 'Failed to run Process Stock' });
  }
}

// GET /api/process-stock/results?ltboBatchId=X — the last computed run's
// full results (every part, matched or not), for a detail table.
async function handleGetResults(req, res) {
  try {
    const { ltboBatchId } = req.query;
    if (!ltboBatchId) return res.status(400).json({ error: 'Missing ltboBatchId' });
    const db = await connectDB();
    const rows = await db.all(
      'SELECT * FROM process_stock_results WHERE ltbo_batch_id = ? ORDER BY status ASC, part_no ASC',
      ltboBatchId
    );
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load Process Stock results' });
  }
}

// The LTBO1021 template's own row 1-5 metadata/header/format rows — copied
// verbatim from the real template file (see the Export design discussion),
// never generated or guessed. Row 6 onward is real data; the template's
// own row 6 is just the "END" sentinel on an otherwise-empty file.
const TEMPLATE_ROW_1 = ['Template Name :', '', 'LTBO1021 Inventory result data Upload and Download report'];
const TEMPLATE_ROW_2 = ['Description :', '',
  'This template file is used for uploading inventory result data. User starts input data at Line 6\nLine 3 is Column/Field length\nLine 4 is Column name or field name\nLine 5 is format for each column \nRemark: Please do not change cell format , Please do noting  In case of value display "N/A"  (if can not mapping stock in transit  will be  display value as "N/A".)'];
const TEMPLATE_ROW_3 = [2, 1, 8, 2, 10, 2, 5, 1, 6, 2, 5, 1, 3, 6, 2, 1, 1, 3, 3, 3, 3, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 40];
const TEMPLATE_ROW_4 = [
  'Company*', 'Company plant code*', 'Group ID*', 'No. of inventory*', 'Part No.*', 'Suffix*',
  'Receiving company*', 'Receiving company plant code*', 'Production process routing', 'Dock code*',
  'Supplier*', 'Supplier plant code*', 'Supplier shipping dock', 'Previous process routing', 'Dummy',
  'Out of calculation flg*', 'Out of check flg*', 'Min BC Seq (A and W =Line Off Sequence)',
  'Attachment point 1', 'Attachment point 2', 'Attachment point 3',
  'Inventory result 1*', 'Inventory result 2*', 'Inventory result 3*', 'Inventory result 4*',
  'Inventory result 5*', 'Inventory result 6*', 'Inventory result 7*', 'Inventory result 8*',
  'Inventory result 9*', 'Inventory result 10*', 'Inventory result 11*', 'Inventory result 12*',
  'Inventory result 13*', 'Stock in Transit (SYSTEM)', 'Stock in Transit (Adjust Qty)', 'Comments (Inventory result)',
];
const TEMPLATE_ROW_5 = [
  'XX', 'X', 'XXXXXXXX', 'XX', 'XXXXXXXXXX', 'XX', 'XXXXX', 'X', 'XXXXXX', 'XX', 'XXXXX', 'X', 'XXX',
  'XXXXXX', 'XX', 'X', 'X', 'XXX', 'XXX', 'XXX', 'XXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX',
  'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX',
  'XXXXXXX', 'XXXXXXX', '(up to 40 characters)',
];

// Builds one data row (37 cells, matching TEMPLATE_ROW_4's column order
// exactly) for a single LTBO master row + its computed Process Stock
// result. Everything EXCEPT Attachment point 1-3 and Inventory result 1-11
// passes through from the master row untouched (Process Stock never
// touches those — see the table comments) — Attachment point 1-3 carry
// SeqNo1-3 (see the Export design discussion: confirmed against the real
// template, both are 3-character fields), and Inventory result 12-13
// always stay 0 (see the INV1-11 mapping design discussion).
function buildExportRow(master, result) {
  return [
    master.company, master.company_plant_code, master.group_id, master.no_of_inventory,
    master.part_no, master.suffix, master.receiving_company, master.receiving_company_plant_code,
    master.production_process_routing, master.dock_code, master.supplier, master.supplier_plant_code,
    master.supplier_shipping_dock, master.previous_process_routing, master.dummy,
    master.out_of_calculation_flg, master.out_of_check_flg, master.min_bc_seq,
    result.seq_no_1 || '', result.seq_no_2 || '', result.seq_no_3 || '',
    result.inv_result_1, result.inv_result_2, result.inv_result_3, result.inv_result_4,
    result.inv_result_5, result.inv_result_6, result.inv_result_7, result.inv_result_8,
    result.inv_result_9, result.inv_result_10, result.inv_result_11, 0, 0,
    master.stock_in_transit_system, master.stock_in_transit_adjust_qty, master.comments,
  ];
}

function buildWorkbookBuffer(rows) {
  const sheetData = [TEMPLATE_ROW_1, TEMPLATE_ROW_2, TEMPLATE_ROW_3, TEMPLATE_ROW_4, TEMPLATE_ROW_5, ...rows, ['END']];
  const sheet = xlsx.utils.aoa_to_sheet(sheetData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'Inventory_Result_Data');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// GET /api/process-stock/export?ltboBatchId=X — generates one .xlsx per
// Group ID (mirrors the old VBA's own per-Group-ID split — see the RUN OUT
// Export design discussion and the "<GroupID>_Inv_Upload_<date>.xlsx"
// naming from the real Upload_File folder screenshot), zipped together.
// Hard-blocks if anything is still unmatched — same rule Process Stock
// itself reports, checked again here so a stale "matched" view from before
// a batch delete/recount can't slip through.
async function handleExport(req, res) {
  try {
    const { ltboBatchId } = req.query;
    if (!ltboBatchId) return res.status(400).json({ error: 'Missing ltboBatchId' });
    const db = await connectDB();

    const totalRow = await db.get('SELECT COUNT(*) AS n FROM process_stock_results WHERE ltbo_batch_id = ?', ltboBatchId);
    if (!totalRow || totalRow.n === 0) {
      return res.status(400).json({ error: 'Process Stock has not been run for this batch yet.' });
    }
    const notFoundCount = await db.get(
      "SELECT COUNT(*) AS n FROM process_stock_results WHERE ltbo_batch_id = ? AND status = 'not_found'",
      ltboBatchId
    );
    if (notFoundCount.n > 0) {
      return res.status(409).json({ error: `${notFoundCount.n} part(s) are still not matched — Process Stock must show 0 not-found before exporting.` });
    }

    const joined = await db.all(
      `SELECT m.*, r.seq_no_1, r.seq_no_2, r.seq_no_3,
              r.inv_result_1, r.inv_result_2, r.inv_result_3, r.inv_result_4, r.inv_result_5,
              r.inv_result_6, r.inv_result_7, r.inv_result_8, r.inv_result_9, r.inv_result_10, r.inv_result_11
       FROM ltbo_master_rows m
       JOIN process_stock_results r ON r.ltbo_batch_id = m.batch_id AND r.ltbo_row_id = m.id
       WHERE m.batch_id = ?
       ORDER BY m.group_id, m.part_no`,
      ltboBatchId
    );
    if (joined.length === 0) return res.status(400).json({ error: 'No data to export for this batch.' });

    const byGroup = {};
    for (const row of joined) {
      const groupId = row.group_id || 'UNKNOWN';
      if (!byGroup[groupId]) byGroup[groupId] = [];
      byGroup[groupId].push(buildExportRow(row, row));
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ltboBatchId}_Inv_Upload_${dateStr}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    for (const [groupId, rows] of Object.entries(byGroup)) {
      const buffer = buildWorkbookBuffer(rows);
      archive.append(buffer, { name: `${groupId}_Inv_Upload_${dateStr}.xlsx` });
    }
    await archive.finalize();
  } catch (error) {
    console.error('Export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export' });
  }
}

// GET /api/process-stock/template — the blank LTBO1021 List Report /
// Upload template itself (rows 1-5 + "END", no data rows), for the Format
// Template Management page (see the Export design discussion — every
// downloadable template in the system lives there, this is the same
// content the export step already builds from, just empty).
function handleDownloadTemplate(req, res) {
  const buffer = buildWorkbookBuffer([]);
  res.setHeader('Content-Disposition', 'attachment; filename="LTBO1021_Inventory_Result_Upload_Template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}

router.post('/run', express.json({ limit: '1mb' }), handleRun);
router.get('/results', handleGetResults);
router.get('/export', handleExport);
router.get('/template', handleDownloadTemplate);

module.exports = router;
module.exports.runProcessStock = runProcessStock;
module.exports.handleRun = handleRun;
module.exports.handleGetResults = handleGetResults;
module.exports.handleExport = handleExport;
module.exports.handleDownloadTemplate = handleDownloadTemplate;
module.exports.buildExportRow = buildExportRow;
module.exports.PIC_TO_INV = PIC_TO_INV;
module.exports.ZONE_CODE_TO_INV = ZONE_CODE_TO_INV;