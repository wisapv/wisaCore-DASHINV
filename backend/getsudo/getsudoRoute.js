const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');
const { createBatchIfNotExists, setGetsudoActiveBatch, getGetsudoActiveBatchId } = require('../lib/batches');
const { saveHandheldResults, getHandheldResults } = require('../lib/handheldResults');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

const COLUMN_NAMES = {
  key0: 'Key0', source: 'Source', dock: 'Dock', sup: 'Sup', splant: 'Splant', sdock: 'Sdock',
  pno: 'Pno', partNo: 'PartNo', partName: 'PartName', kbn: 'KBN', qty: 'Qty',
  pcAddr: 'PC_Addr', addr01: 'Addr01',
};

function cellStr(row, index) {
  if (index < 0 || row[index] === undefined || row[index] === null) return '';
  return String(row[index]).trim();
}

// Whole-factory master file has a title row before the real header (see
// the sample: "NQC 202609 SUM SR" on row 1, real headers on row 2) — find
// the header row by looking for "Key0" instead of assuming a fixed row
// number, since that title row isn't guaranteed to always be exactly one
// line.
function parseMasterWorkbook(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const headerRowIndex = allRows.findIndex((row) => String(row[0]).trim() === COLUMN_NAMES.key0);
  if (headerRowIndex === -1) {
    throw new Error(`ไม่พบแถวหัวตาราง (คอลัมน์ "${COLUMN_NAMES.key0}") ในไฟล์`);
  }
  const headerRow = allRows[headerRowIndex];
  const colIndex = (name) => headerRow.findIndex((h) => String(h).trim() === name);

  const idx = Object.fromEntries(Object.entries(COLUMN_NAMES).map(([key, name]) => [key, colIndex(name)]));
  if (idx.key0 === -1 || idx.partNo === -1) {
    throw new Error('ไม่พบคอลัมน์ Key0 หรือ PartNo ในไฟล์ — เช็ครูปแบบไฟล์อีกครั้ง');
  }

  // Not used anywhere yet (kept for future use) — the 7 monthly-forecast
  // columns right after Addr01 have dynamic labels (e.g. "Jun-26",
  // "Jul-26"...) that shift every time the file is regenerated, so they
  // can't be matched by fixed name like the columns above. Everything from
  // "DMax" onward (DMax, D01-D31, N01-N31) is the daily usage block.
  const dMaxIndex = colIndex('DMax');
  const monthlyForecastCols = dMaxIndex > idx.addr01
    ? headerRow.slice(idx.addr01 + 1, dMaxIndex).map((label, i) => ({ label: String(label).trim(), index: idx.addr01 + 1 + i })).filter((c) => c.label)
    : [];
  const dailyUsageCols = dMaxIndex >= 0
    ? headerRow.slice(dMaxIndex).map((label, i) => ({ label: String(label).trim(), index: dMaxIndex + i })).filter((c) => c.label)
    : [];

  return allRows
    .slice(headerRowIndex + 1)
    .filter((row) => cellStr(row, idx.key0) !== '')
    .map((row) => {
      const monthlyForecast = {};
      monthlyForecastCols.forEach((c) => { monthlyForecast[c.label] = cellStr(row, c.index); });
      const dailyUsage = {};
      dailyUsageCols.forEach((c) => { dailyUsage[c.label] = cellStr(row, c.index); });

      return {
        key0: cellStr(row, idx.key0),
        source: cellStr(row, idx.source),
        dock: cellStr(row, idx.dock),
        supplier: cellStr(row, idx.sup),
        sPlant: cellStr(row, idx.splant),
        sDock: cellStr(row, idx.sdock),
        pno: cellStr(row, idx.pno),
        partNo: cellStr(row, idx.partNo),
        partName: cellStr(row, idx.partName),
        kbn: cellStr(row, idx.kbn),
        qty: cellStr(row, idx.qty),
        pcAddr: cellStr(row, idx.pcAddr),
        addr01: cellStr(row, idx.addr01),
        monthlyForecast,
        dailyUsage,
      };
    });
}

// POST /api/getsudo/upload-master — adds a new revision of the whole-
// factory part master (never deletes previous ones — see the revisions
// table comment in database.js). Meant to be re-run monthly. dataMonth
// (e.g. "2026-09") is picked by the admin, not parsed from the file — the
// upload date and the month the data represents aren't always the same.
async function handleUploadMaster(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const dataMonth = String(req.body.dataMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(dataMonth)) {
      return res.status(400).json({ error: 'กรุณาระบุเดือนของข้อมูล (YYYY-MM) ก่อนอัปโหลด' });
    }

    let rows;
    try {
      rows = parseMasterWorkbook(req.file.buffer);
    } catch (parseError) {
      return res.status(400).json({ error: parseError.message });
    }
    if (rows.length === 0) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });

    const db = await connectDB();
    const now = new Date().toISOString();

    let revisionId;
    await db.run('BEGIN TRANSACTION');
    try {
      const revisionResult = await db.run(
        'INSERT INTO getsudo_master_revisions (data_month, uploaded_at, row_count) VALUES (?, ?, ?)',
        [dataMonth, now, rows.length]
      );
      revisionId = revisionResult.lastID;

      for (const r of rows) {
        await db.run(
          `INSERT INTO getsudo_master_parts
             (key0, source, dock, supplier, s_plant, s_dock, pno, part_no, part_name, kbn, qty, pc_addr, addr01, monthly_forecast, daily_usage, revision_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.key0, r.source, r.dock, r.supplier, r.sPlant, r.sDock, r.pno, r.partNo, r.partName, r.kbn, r.qty, r.pcAddr, r.addr01,
            JSON.stringify(r.monthlyForecast || {}), JSON.stringify(r.dailyUsage || {}), revisionId, now,
          ]
        );
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ success: true, count: rows.length, updatedAt: now, dataMonth, revisionId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to upload master file' });
  }
}

// GET /api/getsudo/master-status — the LATEST revision's row count + month
// + upload time, so the web page can show "3,412 parts · Data for: Sep
// 2026" instead of the admin having to guess whether the upload took.
async function handleMasterStatus(req, res) {
  try {
    const db = await connectDB();
    const latest = await db.get('SELECT id, data_month, uploaded_at, row_count FROM getsudo_master_revisions ORDER BY id DESC LIMIT 1');
    res.json({
      count: latest?.row_count || 0,
      updatedAt: latest?.uploaded_at || null,
      dataMonth: latest?.data_month || null,
      revisionId: latest?.id || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load master status' });
  }
}

// GET /api/getsudo/upload-history — every past revision, newest first, for
// the "what have we uploaded, and when" view on the NQC Master page.
async function handleUploadHistory(req, res) {
  try {
    const db = await connectDB();
    const rows = await db.all('SELECT id, data_month, uploaded_at, row_count FROM getsudo_master_revisions ORDER BY id DESC');
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load upload history' });
  }
}

// GET /api/getsudo/master-preview — first N raw rows from the LATEST
// revision, for the "Preview" modal (same idea as Template Manager's own
// format preview).
async function handleMasterPreview(req, res) {
  try {
    const db = await connectDB();
    const latest = await db.get('SELECT id FROM getsudo_master_revisions ORDER BY id DESC LIMIT 1');
    if (!latest) return res.json({ data: [] });
    const rows = await db.all('SELECT * FROM getsudo_master_parts WHERE revision_id = ? LIMIT 20', latest.id);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load master preview' });
  }
}

function cleanAddress(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function generateGetsudoBatchId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // "NQC" names which master file this came from (per the file's own title
  // row, e.g. "NQC 202609 SUM SR") — helps tell Getsudo batches apart from
  // the regular Part Runout batch at a glance in any batch list.
  return `GETSUDO-NQC-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Shared by both create-batch entry points (JSON array and Target List
// file) — matches each requested part number against the master's LATEST
// revision only (older revisions stay in the database for history, but
// are never used for matching). The master can have genuine duplicate
// rows for the same part number within one revision — only the first one
// found is used, not every duplicate.
async function matchPartNumbersAgainstMaster(db, partNumbers) {
  const requested = [...new Set(partNumbers.map((p) => String(p).trim()).filter(Boolean))];
  const latest = await db.get('SELECT id FROM getsudo_master_revisions ORDER BY id DESC LIMIT 1');
  const foundRows = [];
  const notFound = [];
  if (!latest) {
    return { requested, foundRows, notFound: requested };
  }
  for (const pn of requested) {
    const match = await db.get(
      'SELECT * FROM getsudo_master_parts WHERE revision_id = ? AND (part_no = ? OR pno = ?) ORDER BY id ASC LIMIT 1',
      [latest.id, pn, pn]
    );
    if (!match) notFound.push(pn);
    else foundRows.push(match);
  }
  return { requested, foundRows, notFound };
}

// Turns matched master rows into the exact finalData shape the TBOS/
// Address-matching pipeline produces — so AssignHandheld, the multi-device
// assignment logic, and the whole Android app work on a Getsudo batch with
// zero changes on their end. No "Shop" field in the NQC master (unlike
// TBOS data) — Dock is the closest equivalent, used for both until/unless
// a real Shop column shows up in a future export.
function buildFinalDataFromMasterRows(foundRows) {
  return foundRows.map((row) => {
    const rawAddr = row.pc_addr && row.pc_addr.trim() ? row.pc_addr : row.addr01;
    // Real prefixes vary in length (2-char "SD", 3-char "R.", "IP1", or a
    // full word like "TUSHO") — there's no length that's always correct,
    // so this just takes the first 3 characters of whatever's left after
    // stripping whitespace (keeps dashes/dots — only spaces caused the
    // actual bug, e.g. "SD - R03" silently becoming "SD ").
    const cleanedAddr = cleanAddress(rawAddr);
    const shortAddr = cleanedAddr.replace(/\s+/g, '').slice(0, 3).toUpperCase();
    return {
      PIC: 'Getsudo',
      ShortAddr: shortAddr || 'UNK',
      Addr: cleanedAddr,
      Shop: row.dock || '',
      Dock: row.dock || '',
      Supplier: row.supplier || '',
      'S.plant': row.s_plant || '',
      'S.dock': row.s_dock || '',
      kbn: row.kbn || '',
      'Part no.': row.part_no || '',
      'Part name': row.part_name || '',
      "Q'ty": row.qty || '',
    };
  });
}

// Saves a new Getsudo batch (registers it + stores its finalData) and
// returns the response payload — the last step shared by both create-batch
// entry points. previewRows uses just the columns the Getsudo Target List
// page displays (Source, Dock, Sup, Splant, Sdock, PartNo, PartName, KBN,
// Qty, PC_Addr, Addr01) — the raw NQC shape, not the finalData/TBOS shape.
async function saveGetsudoBatch(db, foundRows, requestedCount, notFound, res) {
  if (foundRows.length === 0) {
    return res.status(404).json({ error: 'ไม่พบ Part Number ที่ระบุใน master เลยสักตัว', notFound });
  }

  const finalData = buildFinalDataFromMasterRows(foundRows);
  const batchId = generateGetsudoBatchId();
  await createBatchIfNotExists(db, batchId); // registers in upload_batches — shows up in /api/batches/list — without touching which batch is "active" (TBOS's)
  await setGetsudoActiveBatch(db, batchId); // ...but does become THE Getsudo-active batch, its own separate flag — see lib/batches.js
  await saveHandheldResults(db, batchId, { finalData, holdData: [], remindData: [] });

  const previewRows = foundRows.map((row) => ({
    Source: row.source, Dock: row.dock, Sup: row.supplier, Splant: row.s_plant, Sdock: row.s_dock,
    PartNo: row.part_no, PartName: row.part_name, KBN: row.kbn, Qty: row.qty, PC_Addr: row.pc_addr, Addr01: row.addr01,
  }));

  res.json({
    success: true,
    batchId,
    matchedCount: finalData.length,
    requestedCount,
    notFound,
    previewRows,
  });
}

// GET /api/getsudo/batch-history — every Target List batch ever created
// (newest first), for Getsudo's own "Upload History" — separate from
// TBOS's history view even though both batch types share the same
// upload_batches table underneath.
async function handleGetBatchHistory(req, res) {
  try {
    const db = await connectDB();
    const batches = await db.all(
      `SELECT batch_id, upload_date FROM upload_batches WHERE batch_id LIKE 'GETSUDO-%' ORDER BY upload_date DESC`
    );
    const withCounts = await Promise.all(
      batches.map(async (b) => {
        const results = await getHandheldResults(db, b.batch_id);
        return {
          batchId: b.batch_id,
          uploadDate: b.upload_date,
          recordCount: results ? results.finalData.length : 0,
        };
      })
    );
    res.json({ data: withCounts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load batch history' });
  }
}

// GET /api/getsudo/batch-preview?batchId=... — same 11-column shape as the
// create-batch response's previewRows, but for re-viewing a PAST batch
// from Upload History (Preview / Use).
async function handleGetBatchPreview(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const results = await getHandheldResults(db, batchId);
    const rows = (results ? results.finalData : []).map((row) => ({
      Source: '', Dock: row.Dock || '', Sup: row.Supplier || '', Splant: row['S.plant'] || '', Sdock: row['S.dock'] || '',
      PartNo: row['Part no.'] || '', PartName: row['Part name'] || '', KBN: row.kbn || '', Qty: row["Q'ty"] || '',
      PC_Addr: row.Addr || '', Addr01: row.Addr || '',
    }));
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load batch preview' });
  }
}
// array of part numbers). Kept alongside create-batch-from-file below in
// case something other than the Target List upload ever needs it.
async function handleCreateBatch(req, res) {
  try {
    const { partNumbers } = req.body;
    if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
      return res.status(400).json({ error: 'partNumbers must be a non-empty array' });
    }

    const db = await connectDB();
    const { requested, foundRows, notFound } = await matchPartNumbersAgainstMaster(db, partNumbers);
    if (requested.length === 0) return res.status(400).json({ error: 'No valid part numbers provided' });

    await saveGetsudoBatch(db, foundRows, requested.length, notFound, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create Getsudo batch' });
  }
}

// Same fixed-format assumption as the master file's own header row — the
// Target List template has exactly one column, "Target part list", so row
// 0 is that header and every row after it (column A) is one part number.
function extractPartNumbersFromTargetListFile(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return allRows.slice(1).map((row) => String(row[0] || '').trim()).filter(Boolean);
}

// POST /api/getsudo/create-batch-from-file — the actual Target List entry
// point (see GetsudoPage.jsx): admin downloads the blank template, fills
// in one part number per row, uploads it back here. No typing into the
// web page itself.
async function handleCreateBatchFromFile(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let partNumbers;
    try {
      partNumbers = extractPartNumbersFromTargetListFile(req.file.buffer);
    } catch (parseError) {
      return res.status(400).json({ error: 'อ่านไฟล์ไม่สำเร็จ — เช็ครูปแบบไฟล์อีกครั้ง' });
    }
    if (partNumbers.length === 0) {
      return res.status(400).json({ error: 'ไม่พบ Part Number ในไฟล์ (คอลัมน์ "Target part list")' });
    }

    const db = await connectDB();
    const { requested, foundRows, notFound } = await matchPartNumbersAgainstMaster(db, partNumbers);

    await saveGetsudoBatch(db, foundRows, requested.length, notFound, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create Getsudo batch from file' });
  }
}

// GET /api/getsudo/target-list-template — the blank Excel template (one
// column, "Target part list") for the admin to fill in and re-upload.
// Generated on the fly rather than stored as a static file, so it can
// never drift out of sync with what create-batch-from-file expects.
function handleDownloadTemplate(req, res) {
  const ws = xlsx.utils.aoa_to_sheet([['Target part list']]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="Target_part_list_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}

router.post('/upload-master', upload.single('file'), handleUploadMaster);
router.get('/master-status', handleMasterStatus);
router.get('/upload-history', handleUploadHistory);
router.get('/master-preview', handleMasterPreview);
router.post('/create-batch', express.json({ limit: '2mb' }), handleCreateBatch);
router.post('/create-batch-from-file', upload.single('file'), handleCreateBatchFromFile);
router.get('/target-list-template', handleDownloadTemplate);
// DELETE /api/getsudo/batch/:batchId — removes a Getsudo batch and every
// row of data tied to it, not just the upload_batches registration that
// batchRoute.js's generic delete handles (that one only cleans target_ro/
// part_procurement, which Getsudo never writes to — see the comment on
// createBatchIfNotExists above). Scoped to GETSUDO- ids only so this can't
// be pointed at a TBOS batch by mistake (that one goes through
// batchRoute.js's own delete instead).
async function handleDeleteBatch(req, res) {
  try {
    const { batchId } = req.params;
    if (!batchId || !batchId.startsWith('GETSUDO-')) {
      return res.status(400).json({ error: 'Not a Getsudo batch id' });
    }

    const db = await connectDB();
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM upload_batches WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM handheld_results WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM handheld_assignments WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM handheld_stock_counts WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM handheld_free_zone_counts WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM handheld_checkins WHERE batch_id = ?', batchId);
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ message: 'Batch deleted' });
  } catch (error) {
    console.error('Delete Getsudo batch error:', error);
    res.status(500).json({ error: 'Failed to delete batch' });
  }
}

// GET /api/getsudo/active-batch — mirrors /api/part-list/active-batch/
// current-batch for TBOS: whichever Getsudo batch was created most
// recently (see setGetsudoActiveBatch above). Used by the "Getsudo Assign"
// button so it lands on the right batch automatically, same one-click
// behavior as TBOS's own "Run Out Assign" — no manual picking needed.
async function handleGetActiveBatch(req, res) {
  try {
    const db = await connectDB();
    const batchId = await getGetsudoActiveBatchId(db);
    res.json({ batchId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active Getsudo batch' });
  }
}

router.get('/batch-history', handleGetBatchHistory);
router.delete('/batch/:batchId', handleDeleteBatch);
router.get('/active-batch', handleGetActiveBatch);
router.get('/batch-preview', handleGetBatchPreview);

module.exports = router;
module.exports.handleUploadMaster = handleUploadMaster;
module.exports.handleMasterStatus = handleMasterStatus;
module.exports.handleUploadHistory = handleUploadHistory;
module.exports.handleMasterPreview = handleMasterPreview;
module.exports.handleCreateBatch = handleCreateBatch;
module.exports.handleCreateBatchFromFile = handleCreateBatchFromFile;
module.exports.handleDownloadTemplate = handleDownloadTemplate;
module.exports.handleGetBatchHistory = handleGetBatchHistory;
module.exports.handleDeleteBatch = handleDeleteBatch;
module.exports.handleGetActiveBatch = handleGetActiveBatch;
module.exports.handleGetBatchPreview = handleGetBatchPreview;
module.exports.parseMasterWorkbook = parseMasterWorkbook;