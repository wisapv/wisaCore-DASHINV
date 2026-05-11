const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/target-ro', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const batchId = req.body.batchId;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(sheet);

    const db = await connectDB();
    const now = new Date().toISOString();
    
    await db.exec('BEGIN TRANSACTION');
    
    try {
      await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);
      const stmt = await db.prepare('INSERT INTO target_ro (batch_id, key_tg, data, upload_at) VALUES (?, ?, ?, ?)');
      for (const row of rawData) {
        await stmt.run([batchId, 'RAW', JSON.stringify(row), now]);
      }
      await stmt.finalize();

      await db.exec('COMMIT');
      res.json({ message: 'Target R/O RAW saved to DB successfully', batchId });

    } catch (insertError) {
      await db.exec('ROLLBACK');
      console.error("Insert Error:", insertError);
      throw insertError; 
    }
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: 'Failed to process Target R/O' });
  }
});

module.exports = router;