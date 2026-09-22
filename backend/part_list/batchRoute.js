// ไฟล์: backend/part_list/batchRoute.js
const express = require('express');
const { connectDB } = require('../database');
const { setActiveBatch } = require('../lib/batches');
const { emitEvent, EVENTS } = require('../lib/socketHub');
const router = express.Router();

async function handleListBatches(req, res) {
  try {
    const db = await connectDB();
    const rows = await db.all(`
      SELECT
        b.batch_id,
        b.upload_date,
        b.is_baseline,
        b.is_active,
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

// POST /api/batches/:id/activate — makes an EXISTING batch the active one,
// without re-uploading anything. Until this existed, the only way to set
// is_active was start-new-batch (a fresh TBOS upload) — so a batch that
// stopped being active (a newer one was started) or was never activated in
// the first place (see the design discussion: a batch can sit there fully
// uploaded and even set as Baseline, yet still have is_active = 0, or the
// server can end up with NO active batch at all) had no way back. That
// silently breaks handheld check-in: My Work Modes only ever looks at
// whichever batch is_active — an assignment saved against any other batch
// is invisible to the device even though "Send to Handheld" reports
// success, because the save and the device's own lookup are keyed off two
// different things (whatever the web's batch picker had selected vs.
// is_active) that nothing kept in sync until now.
async function handleActivateBatch(req, res) {
  try {
    const db = await connectDB();
    const batchId = req.params.id;

    const batch = await db.get('SELECT batch_id FROM upload_batches WHERE batch_id = ?', batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    await setActiveBatch(db, batchId);
    emitEvent(EVENTS.BATCH_CHANGED, { batchId }); // same event start-new-batch fires — every open tab's useActiveBatch() picks it up live
    res.json({ success: true, activeBatchId: batchId });
  } catch (error) {
    console.error('Activate batch error:', error);
    res.status(500).json({ error: 'Failed to activate batch' });
  }
}

router.get('/list', handleListBatches);
router.delete('/:id', handleDeleteBatch);
router.post('/:id/activate', handleActivateBatch);

module.exports = router;
module.exports.handleListBatches = handleListBatches;
module.exports.handleDeleteBatch = handleDeleteBatch;
module.exports.handleActivateBatch = handleActivateBatch;