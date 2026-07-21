const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');
const { validateRequiredColumns, findDuplicateHeaders, REQUIRED_FIELDS_PART_PROCUREMENT } = require('../lib/validateColumns');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/part-procurement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const batchId = req.body.batchId;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const headerRow = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    const duplicates = findDuplicateHeaders(headerRow);
    if (duplicates.length > 0) {
      return res.status(400).json({ error: 'Duplicate column headers found', duplicates });
    }
    const { valid, missing } = validateRequiredColumns(headerRow, REQUIRED_FIELDS_PART_PROCUREMENT);
    if (!valid) return res.status(400).json({ error: 'Missing required columns', missing });

    const rawData = xlsx.utils.sheet_to_json(sheet);

    const db = await connectDB();
    const now = new Date().toISOString();
    
    await db.exec('BEGIN TRANSACTION');

    try {
      await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);
      const stmt = await db.prepare('INSERT INTO part_procurement (batch_id, key_pp, data, upload_at) VALUES (?, ?, ?, ?)');
      for (const row of rawData) {
        await stmt.run([batchId, 'RAW', JSON.stringify(row), now]);
      }
      await stmt.finalize();

      await db.exec('COMMIT');
      res.json({ message: 'Part Procurement RAW saved to DB successfully', batchId });

    } catch (insertError) {
      await db.exec('ROLLBACK');
      console.error("Insert Error:", insertError);
      throw insertError;
    }
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: 'Failed to process Part Procurement' });
  }
});

module.exports = router;