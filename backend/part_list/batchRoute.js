// ไฟล์: backend/part_list/batchRoute.js
const express = require('express');
const { connectDB } = require('../database');
const router = express.Router();

async function handleListBatches(req, res) {
  try {
    const db = await connectDB();
    const rows = await db.all(`
      SELECT
        b.batch_id,
        b.upload_date,
        b.is_baseline,
        (SELECT COUNT(*) FROM target_ro WHERE batch_id = b.batch_id) as tg_count,
        (SELECT COUNT(*) FROM part_procurement WHERE batch_id = b.batch_id) as pp_count
      FROM upload_batches b
      WHERE b.batch_id NOT LIKE 'LTBO-%'
      ORDER BY b.upload_date DESC
    `);

    res.json(rows);

  } catch (error) {
    console.error("Fetch batches error:", error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
}

async function handleDeleteBatch(req, res) {
  try {
    const db = await connectDB();
    const batchId = req.params.id;

    await db.exec('BEGIN TRANSACTION');
    try {
      // 🟢 เอาวงเล็บก้ามปู [ ] ออก เพื่อให้ SQLite อ่านค่าตัวแปรได้ถูกต้อง
      await db.run('DELETE FROM upload_batches WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM target_ro WHERE batch_id = ?', batchId);
      await db.run('DELETE FROM part_procurement WHERE batch_id = ?', batchId);
      await db.exec('COMMIT');
      res.json({ message: 'Batch deleted' });
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ error: 'Failed to delete batch' });
  }
}

router.get('/list', handleListBatches);
router.delete('/:id', handleDeleteBatch);

module.exports = router;
module.exports.handleListBatches = handleListBatches;
module.exports.handleDeleteBatch = handleDeleteBatch;