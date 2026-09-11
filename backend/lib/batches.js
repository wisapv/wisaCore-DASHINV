function generateBatchId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `B-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Shared by every upload route (target-ro, part-procurement) and by
// start-new-batch, so a batch row is created exactly one way everywhere.
async function createBatchIfNotExists(db, batchId) {
  const now = new Date().toISOString();
  await db.run('INSERT OR IGNORE INTO upload_batches (batch_id, upload_date) VALUES (?, ?)', [batchId, now]);
}

// At most one batch is ever active. Deactivating every row before activating
// the target one, inside a single transaction, keeps that true even across
// back-to-back start-new-batch calls.
async function setActiveBatch(db, batchId) {
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('UPDATE upload_batches SET is_active = 0');
    await db.run('UPDATE upload_batches SET is_active = 1 WHERE batch_id = ?', batchId);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function getActiveBatchId(db) {
  const row = await db.get('SELECT batch_id FROM upload_batches WHERE is_active = 1 LIMIT 1');
  return row ? row.batch_id : null;
}

// Same "unset everywhere, then set the target" transaction pattern as
// setActiveBatch — at most one batch is ever the baseline, even across
// back-to-back calls.
async function setBaselineBatch(db, batchId) {
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('UPDATE upload_batches SET is_baseline = 0');
    await db.run('UPDATE upload_batches SET is_baseline = 1 WHERE batch_id = ?', batchId);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function getBaselineBatchId(db) {
  const row = await db.get('SELECT batch_id FROM upload_batches WHERE is_baseline = 1 LIMIT 1');
  return row ? row.batch_id : null;
}

// Getsudo's own "active batch" — same single-row-wins pattern as
// setActiveBatch above, but on the separate is_getsudo_active column, so
// setting it never touches (or is touched by) TBOS's is_active. Called
// once per newly created Getsudo batch (see saveGetsudoBatch in
// getsudoRoute.js), so "the active Getsudo batch" always means "the most
// recently created one" — mirrors how TBOS's Upload flow keeps exactly
// one batch active at a time.
async function setGetsudoActiveBatch(db, batchId) {
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('UPDATE upload_batches SET is_getsudo_active = 0');
    await db.run('UPDATE upload_batches SET is_getsudo_active = 1 WHERE batch_id = ?', batchId);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function getGetsudoActiveBatchId(db) {
  const row = await db.get('SELECT batch_id FROM upload_batches WHERE is_getsudo_active = 1 LIMIT 1');
  return row ? row.batch_id : null;
}

// Resolves which batch new-parts detection should compare the current batch
// against: an explicitly-pinned baseline takes priority regardless of age;
// otherwise the batch immediately before the current one by creation order
// (upload_date, the same column the Upload History list is already ordered
// by). Returns null when neither exists — the current batch is the first
// one ever created, and every valid row in it is a new part.
async function getPreviousBatchId(db, currentBatchId) {
  const baselineId = await getBaselineBatchId(db);
  if (baselineId) return baselineId;

  const current = await db.get('SELECT upload_date FROM upload_batches WHERE batch_id = ?', currentBatchId);
  if (!current) return null;

  const previous = await db.get(
    'SELECT batch_id FROM upload_batches WHERE upload_date < ? AND batch_id != ? ORDER BY upload_date DESC LIMIT 1',
    [current.upload_date, currentBatchId]
  );
  return previous ? previous.batch_id : null;
}

// Resolves and parses the previous batch's Target R/O rows for new-parts
// comparison — shared by every caller that needs "previous batch's data" so
// they can never disagree on what that means. Returns [] when there is no
// previous batch (see getPreviousBatchId).
async function getPreviousTgRows(db, batchId) {
  const previousBatchId = await getPreviousBatchId(db, batchId);
  if (!previousBatchId) return [];
  const previousRaw = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', previousBatchId);
  return previousRaw.map((r) => JSON.parse(r.data));
}

module.exports = {
  generateBatchId,
  createBatchIfNotExists,
  setActiveBatch,
  getActiveBatchId,
  setBaselineBatch,
  getBaselineBatchId,
  setGetsudoActiveBatch,
  getGetsudoActiveBatchId,
  getPreviousBatchId,
  getPreviousTgRows,
};