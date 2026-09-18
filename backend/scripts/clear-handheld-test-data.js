// Clears everything a handheld device SUBMITTED for one batch — Fix Zone
// counts, Free Zone scans, "Mark done" flags, check-in log — so a batch
// used for testing can be re-counted from zero. Deliberately leaves
// alone:
//   - handheld_assignments (which zone is assigned to which device) —
//     that's setup/configuration, not a test result, and re-doing it is
//     the slow part of getting a batch ready to test with again.
//   - upload_batches / target_ro / part_procurement — the batch's real
//     source data (from the TBOS upload), never touched by testing.
//
// Usage:
//   node scripts/clear-handheld-test-data.js <batch_id>
//
// Makes a timestamped backup copy of the whole database file first (see
// backupDatabaseFile below) — this only ever deletes rows for the ONE
// batch_id given, but a backup costs nothing and this is a destructive,
// unrecoverable operation otherwise.

const fs = require('fs');
const path = require('path');
const { connectDB } = require('../database');

// Tables that hold data a handheld device itself wrote, keyed by batch_id.
// Add a new table here if a future feature introduces another one — this
// list is deliberately explicit (not "every table with a batch_id column")
// so a table holding real source/config data never gets swept in by
// accident.
const TABLES_TO_CLEAR = [
  'handheld_stock_counts',
  'handheld_free_zone_scans',
  'handheld_free_zone_counts', // legacy barcode+box_count model, kept for old batches
  'free_zone_progress',
  'handheld_checkins',
];

function backupDatabaseFile() {
  const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, '..', 'database', `database.sqlite.before-clear-${stamp}.bak`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error('Usage: node scripts/clear-handheld-test-data.js <batch_id>');
    process.exit(1);
  }

  const backupPath = backupDatabaseFile();
  if (backupPath) console.log(`Backed up database to: ${backupPath}`);

  const db = await connectDB();

  const batchRow = await db.get('SELECT batch_id FROM upload_batches WHERE batch_id = ?', batchId);
  if (!batchRow) {
    console.warn(`Warning: "${batchId}" isn't in upload_batches — double-check this is the right batch_id. Continuing anyway (will just delete 0 rows from tables where it doesn't appear).`);
  }

  console.log(`\nClearing handheld test data for batch: ${batchId}\n`);

  await db.run('BEGIN TRANSACTION');
  try {
    for (const table of TABLES_TO_CLEAR) {
      const { count: before } = await db.get(`SELECT COUNT(*) AS count FROM ${table} WHERE batch_id = ?`, batchId);
      await db.run(`DELETE FROM ${table} WHERE batch_id = ?`, batchId);
      console.log(`  ${table}: deleted ${before} row(s)`);
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    console.error('Failed — rolled back, nothing was deleted.', err);
    process.exit(1);
  }

  console.log('\nDone. handheld_assignments and the batch\'s own TBOS data were left untouched.');
  if (backupPath) console.log(`(If this wasn't what you wanted, restore from ${backupPath}.)`);
}

main();
