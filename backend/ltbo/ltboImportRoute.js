const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');
const { createBatchIfNotExists } = require('../lib/batches');
const { emitEvent, EVENTS } = require('../lib/socketHub');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function generateLtboBatchId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `LTBO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// The 37 fields in this exact order, from the LTBO1021 template's own row 4
// header (verified against a real "List Report" download — see the RUN OUT
// Summary / Import design discussion). Data starts at row 6 (1-indexed);
// rows 1-5 are the template's own title/description/field-length/header/
// format rows, not data.
const FIELD_ORDER = [
  'company', 'company_plant_code', 'group_id', 'no_of_inventory', 'part_no', 'suffix',
  'receiving_company', 'receiving_company_plant_code', 'production_process_routing',
  'dock_code', 'supplier', 'supplier_plant_code', 'supplier_shipping_dock',
  'previous_process_routing', 'dummy', 'out_of_calculation_flg', 'out_of_check_flg',
  'min_bc_seq', 'attachment_point_1', 'attachment_point_2', 'attachment_point_3',
  'inv_result_1', 'inv_result_2', 'inv_result_3', 'inv_result_4', 'inv_result_5',
  'inv_result_6', 'inv_result_7', 'inv_result_8', 'inv_result_9', 'inv_result_10',
  'inv_result_11', 'inv_result_12', 'inv_result_13',
  'stock_in_transit_system', 'stock_in_transit_adjust_qty', 'comments',
];

function cellStr(row, index) {
  if (index < 0 || row[index] === undefined || row[index] === null) return '';
  return String(row[index]).trim();
}

// Same shape as the Key used elsewhere for stock matching — Dock+Supplier+
// Supplier plant code+Supplier shipping dock+full 12-digit Part No, dashes
// stripped (see the Process Stock design discussion). LTBO1021's own "Part
// No." field is only 10 characters — the remaining 2 digits needed to make
// a real 12-digit part number live in the separate "Suffix" field, so
// they're only appended when Part No. isn't already a full 12 digits on
// its own (some sources do give the complete 12-digit number directly).
function computeMatchKey({ dock, supplier, supplierPlant, supplierDock, partNo, suffix }) {
  const strippedPartNo = String(partNo || '').replace(/-/g, '');
  const fullPartNo = strippedPartNo.length >= 12 ? strippedPartNo : `${strippedPartNo}${String(suffix || '').replace(/-/g, '')}`;
  return `${dock || ''}${supplier || ''}${supplierPlant || ''}${supplierDock || ''}${fullPartNo}`
    .replace(/-/g, '')
    .toUpperCase();
}

// Every field, joined — two rows only count as "the same row" (and so
// collapse into one on merge) if they match on ALL of these, not just a
// handful of identifying columns. See the design discussion: the earlier
// version keyed on Group ID+Part No+Dock+Supplier alone, which silently
// merged rows that actually differed elsewhere (e.g. Suffix).
function computeRowSignature(record) {
  return FIELD_ORDER.map((f) => record[f] || '').join('\u0001');
}

// Parses one uploaded workbook's "Inventory_Result_Data" sheet (or just its
// first sheet, in case a real export names it differently) into row objects
// — stops at the first row whose Company field is literally "END" (the
// template's own end-of-data sentinel — see the RO Master / Raw_File
// design discussion), same as the original VBA did.
function parseLtboWorkbook(buffer, fileName) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.includes('Inventory_Result_Data')
    ? 'Inventory_Result_Data'
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  const parsed = [];
  for (let i = 5; i < rows.length; i += 1) { // row 6 is index 5 (0-indexed)
    const row = rows[i] || [];
    const company = cellStr(row, 0);
    if (!company) continue; // blank row — skip, don't treat as end
    if (company.toUpperCase() === 'END') break;

    const record = { source_file: fileName };
    FIELD_ORDER.forEach((field, idx) => { record[field] = cellStr(row, idx); });
    record.match_key = computeMatchKey({
      dock: record.dock_code, supplier: record.supplier,
      supplierPlant: record.supplier_plant_code, supplierDock: record.supplier_shipping_dock,
      partNo: record.part_no, suffix: record.suffix,
    });
    record.row_signature = computeRowSignature(record);
    parsed.push(record);
  }
  return parsed;
}

// POST /api/ltbo/import — multipart, field name "files" (one or more),
// plus a "linkedBatchId" field naming which counting batch this import is
// for. Every uploaded file's rows merge into ONE new ltbo batch (mirrors
// GentFile()'s old job of combining several Raw_File exports).
async function handleImport(req, res) {
  try {
    const { linkedBatchId } = req.body;
    if (!linkedBatchId) return res.status(400).json({ error: 'Missing linkedBatchId' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const db = await connectDB();
    const linked = await db.get('SELECT batch_id FROM upload_batches WHERE batch_id = ?', linkedBatchId);
    if (!linked) return res.status(400).json({ error: 'linkedBatchId does not match any known batch' });

    const batchId = generateLtboBatchId();
    let allRows = [];
    const perFileErrors = [];
    for (const file of req.files) {
      try {
        const rows = parseLtboWorkbook(file.buffer, file.originalname);
        allRows = allRows.concat(rows);
      } catch (err) {
        perFileErrors.push({ file: file.originalname, error: err.message });
      }
    }

    if (allRows.length === 0) {
      return res.status(400).json({ error: 'No data rows found in any uploaded file', fileErrors: perFileErrors });
    }

    await createBatchIfNotExists(db, batchId);
    const now = new Date().toISOString();

    let storedCount = 0;
    await db.run('BEGIN TRANSACTION');
    try {
      const columns = ['batch_id', ...FIELD_ORDER, 'match_key', 'row_signature', 'source_file'];
      const placeholders = columns.map(() => '?').join(',');

      for (const record of allRows) {
        const values = [batchId, ...FIELD_ORDER.map((f) => record[f]), record.match_key, record.row_signature, record.source_file];
        // A row identical in EVERY column to one already stored for this
        // batch is skipped (UNIQUE on batch_id+row_signature) — anything
        // that differs in even one column is kept as its own row, per the
        // design discussion.
        await db.run(`INSERT OR IGNORE INTO ltbo_master_rows (${columns.join(', ')}) VALUES (${placeholders})`, values);
      }
      const finalCountRow = await db.get('SELECT COUNT(*) AS n FROM ltbo_master_rows WHERE batch_id = ?', batchId);
      storedCount = finalCountRow.n;
      await db.run(
        `INSERT INTO ltbo_import_batches (batch_id, linked_batch_id, file_count, row_count, uploaded_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (batch_id) DO UPDATE SET file_count = excluded.file_count, row_count = excluded.row_count, uploaded_at = excluded.uploaded_at`,
        [batchId, linkedBatchId, req.files.length, storedCount, now]
      );
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    emitEvent(EVENTS.HANDHELD_UPDATED, { batchId: linkedBatchId });
    res.json({
      success: true,
      batchId,
      linkedBatchId,
      fileCount: req.files.length,
      rowCount: storedCount, // rows actually stored after dedup, not rows parsed — see the loop above
      parsedCount: allRows.length,
      fileErrors: perFileErrors,
    });
  } catch (error) {
    console.error('LTBO import error:', error);
    res.status(500).json({ error: 'Failed to import LTBO1021 files' });
  }
}

// GET /api/ltbo/batches?linkedBatchId=X — list of LTBO import batches, all
// of them or filtered to ones linked to a specific counting batch.
async function handleListBatches(req, res) {
  try {
    const { linkedBatchId } = req.query;
    const db = await connectDB();
    const rows = linkedBatchId
      ? await db.all('SELECT * FROM ltbo_import_batches WHERE linked_batch_id = ? ORDER BY uploaded_at DESC', linkedBatchId)
      : await db.all('SELECT * FROM ltbo_import_batches ORDER BY uploaded_at DESC');
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list LTBO import batches' });
  }
}

// GET /api/ltbo/master?batchId=X — preview the merged master rows for one
// LTBO import batch.
async function handleGetMaster(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });
    const db = await connectDB();
    const rows = await db.all('SELECT * FROM ltbo_master_rows WHERE batch_id = ? ORDER BY group_id, part_no', batchId);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load LTBO master data' });
  }
}

// DELETE /api/ltbo/batch/:batchId — removes an LTBO import batch and all of
// its merged rows (matches the same pattern as Getsudo's own batch delete).
async function handleDeleteBatch(req, res) {
  try {
    const { batchId } = req.params;
    if (!batchId || !batchId.startsWith('LTBO-')) {
      return res.status(400).json({ error: 'Not an LTBO import batch id' });
    }
    const db = await connectDB();
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM ltbo_master_rows WHERE batch_id = ?', batchId);
      const result = await db.run('DELETE FROM ltbo_import_batches WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM upload_batches WHERE batch_id = ?', batchId);
      await db.run('COMMIT');
      if (result.changes === 0) return res.status(404).json({ error: 'Batch not found' });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete LTBO import batch' });
  }
}

router.post('/import', upload.array('files'), handleImport);
router.get('/batches', handleListBatches);
router.get('/master', handleGetMaster);
router.delete('/batch/:batchId', handleDeleteBatch);

module.exports = router;
module.exports.handleImport = handleImport;
module.exports.handleListBatches = handleListBatches;
module.exports.handleGetMaster = handleGetMaster;
module.exports.handleDeleteBatch = handleDeleteBatch;
module.exports.parseLtboWorkbook = parseLtboWorkbook;
module.exports.computeMatchKey = computeMatchKey;
module.exports.FIELD_ORDER = FIELD_ORDER;