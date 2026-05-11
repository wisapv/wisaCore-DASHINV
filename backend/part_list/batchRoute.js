// ไฟล์: backend/part_list/batchRoute.js
const express = require('express');
const { connectDB } = require('../database');
const router = express.Router();

router.get('/list', async (req, res) => {
  try {
    const db = await connectDB();
    
    // 🟢 ดึงข้อมูล Batch ทั้งหมดออกมาตรงๆ โดยไม่ใส่เงื่อนไขดักจำนวนแถว
    const rows = await db.all(`
      SELECT 
        b.batch_id, 
        b.upload_date,
        (SELECT COUNT(*) FROM target_ro WHERE batch_id = b.batch_id) as tg_count,
        (SELECT COUNT(*) FROM part_procurement WHERE batch_id = b.batch_id) as pp_count
      FROM upload_batches b
      ORDER BY b.upload_date DESC
    `);
    
    console.log("History Sent:", rows.length, "batches"); // เช็คที่ Console ของ Backend
    res.json(rows);
  } catch (error) {
    console.error("Fetch batches error:", error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = await connectDB();
    const batchId = req.params.id;
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM upload_batches WHERE batch_id = ?', [batchId]);
      await db.run('DELETE FROM target_ro WHERE batch_id = ?', [batchId]);
      await db.run('DELETE FROM part_procurement WHERE batch_id = ?', [batchId]);
      await db.exec('COMMIT');
      res.json({ message: 'Batch deleted' });
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

module.exports = router;