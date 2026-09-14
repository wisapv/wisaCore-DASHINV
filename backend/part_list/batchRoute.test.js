const test = require('node:test');
const assert = require('node:assert');
const { initDB, connectDB } = require('../database');
const { handleListBatches, handleDeleteBatch } = require('./batchRoute');
const { createBatchIfNotExists, setBaselineBatch } = require('../lib/batches');

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = JSON.parse(JSON.stringify(payload)); return this; },
  };
}

async function cleanupBatch(batchId) {
  const db = await connectDB();
  await db.run('DELETE FROM upload_batches WHERE batch_id = ?', batchId);
}

test.before(async () => {
  await initDB();
});

test('handleListBatches: includes is_baseline for each batch, reflecting which one is currently pinned', async () => {
  const db = await connectDB();
  const batchA = 'TEST-BATCHROUTE-A-' + Date.now();
  const batchB = 'TEST-BATCHROUTE-B-' + Date.now();
  await createBatchIfNotExists(db, batchA);
  await createBatchIfNotExists(db, batchB);
  await setBaselineBatch(db, batchA);

  try {
    const res = mockRes();
    await handleListBatches({}, res);

    assert.strictEqual(res.statusCode, 200);
    const rowA = res.body.find((b) => b.batch_id === batchA);
    const rowB = res.body.find((b) => b.batch_id === batchB);
    assert.strictEqual(rowA.is_baseline, 1);
    assert.strictEqual(rowB.is_baseline, 0);
  } finally {
    await cleanupBatch(batchA);
    await cleanupBatch(batchB);
  }
});

test('handleListBatches: excludes LTBO- import batches (they belong only to Summary/RUN OUT import, not the shared batch selector)', async () => {
  const db = await connectDB();
  const normalBatch = 'TEST-BATCHROUTE-NORMAL-' + Date.now();
  const ltboBatch = 'LTBO-' + Date.now();
  await createBatchIfNotExists(db, normalBatch);
  await createBatchIfNotExists(db, ltboBatch);

  try {
    const res = mockRes();
    await handleListBatches({}, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.some((b) => b.batch_id === normalBatch), 'normal batch should still be listed');
    assert.ok(!res.body.some((b) => b.batch_id === ltboBatch), 'LTBO- batch should be excluded');
  } finally {
    await cleanupBatch(normalBatch);
    await cleanupBatch(ltboBatch);
  }
});

test('handleDeleteBatch: removes the batch row', async () => {
  const db = await connectDB();
  const batchId = 'TEST-BATCHROUTE-DEL-' + Date.now();
  await createBatchIfNotExists(db, batchId);

  const res = mockRes();
  await handleDeleteBatch({ params: { id: batchId } }, res);
  assert.strictEqual(res.statusCode, 200);

  const row = await db.get('SELECT batch_id FROM upload_batches WHERE batch_id = ?', batchId);
  assert.strictEqual(row, undefined);
});