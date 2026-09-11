// ไฟล์: backend/database.js
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');

const dbFolder = path.join(__dirname, 'database');
const dbPath = path.join(dbFolder, 'database.sqlite');

async function connectDB() {
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder);
    console.log("Created 'database' folder automatically.");
  }
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  // Every route (and every test) opens its own connection against the same
  // file; without this, concurrent writers (e.g. two people uploading at
  // once, or setActiveBatch's table-wide UPDATE racing another insert) can
  // fail immediately with SQLITE_BUSY instead of just waiting briefly.
  await db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

async function initDB() {
  const db = await connectDB();
  
  // สร้างตารางใหม่สำหรับ Batch และปรับตารางเดิมให้มี batch_id
  await db.exec(`
    CREATE TABLE IF NOT EXISTS upload_batches (
      batch_id TEXT PRIMARY KEY,
      upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS target_ro (
      batch_id TEXT,
      key_tg TEXT,
      data TEXT,
      upload_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS part_procurement (
      batch_id TEXT,
      key_pp TEXT,
      data TEXT,
      upload_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_prefix_history (
      prefix TEXT PRIMARY KEY,
      last_used_at TEXT NOT NULL
    );
    -- Computed cache of process-assign-addr's output (Kanban/Lineside rows,
    -- PIC assignments, Hold/Remind lists), keyed one row per batch — tied to
    -- that batch's Target R/O + Part Procurement + uploaded Address Master
    -- inputs, not a source of truth in its own right. A JSON blob per batch
    -- is enough here; no need for a fully relational schema for a cache.
    CREATE TABLE IF NOT EXISTS handheld_results (
      batch_id TEXT PRIMARY KEY,
      final_data TEXT,
      hold_data TEXT,
      remind_data TEXT,
      updated_at TEXT
    );
    -- Registry of physical handheld scanners (HH-01, HH-02, ...). Not tied
    -- to any batch — a device exists independently of which batch's address
    -- groups are currently assigned to it. status is 'active' | 'inactive';
    -- inactive devices are hidden from AssignHandheld's device picker but
    -- kept here (not deleted) so history/audit isn't lost by a toggle.
    CREATE TABLE IF NOT EXISTS handheld_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    -- Free Zone definitions (S1_S-LANE, WH3_OVERFLOW, ...) — factory-wide
    -- master list, not tied to any batch, same as handheld_devices. These
    -- have no real Address Master row behind them (nothing to compute PIC/
    -- ShortAddr from), so they're just a manually-managed code + dock label.
    -- AssignHandheld merges active rows from this table into its address-
    -- derived groups client-side (see AssignHandheld.jsx); assigning one to
    -- a device still writes into the existing handheld_assignments table
    -- using this row's code as short_addr, dock as pic — no schema change
    -- needed there. status='inactive' hides it without losing history.
    CREATE TABLE IF NOT EXISTS zone_definitions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      dock TEXT NOT NULL DEFAULT 'FREE',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    -- Which address group (PIC + ShortAddr, from a batch's PIC/Addr-matched
    -- data) is assigned to which physical device. A group CAN have more
    -- than one row (one per device) — multiple devices can share the same
    -- zone's remaining pool instead of the zone being split ahead of time;
    -- whoever gets to a part first "claims" it (see handheld_stock_counts),
    -- so no double-counting even with several devices working the same
    -- zone at once. A group with no rows here is simply unassigned.
    CREATE TABLE IF NOT EXISTS handheld_assignments (
      batch_id TEXT NOT NULL,
      pic TEXT NOT NULL,
      short_addr TEXT NOT NULL,
      device_id TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (batch_id, pic, short_addr, device_id)
    );
    -- One row per (batch, pic, short_addr, addr, kbn) — a specific part
    -- counted at a specific address. Re-submitting the same key overwrites
    -- (operator correcting a mistake), it does not accumulate. Carries the
    -- full part context (Supplier/Shop/Dock/S.plant/S.dock/Part no./Part
    -- name) copied from the batch's matched data at submit time, so a
    -- report never needs to re-join back to handheld_results later.
    CREATE TABLE IF NOT EXISTS handheld_stock_counts (
      batch_id TEXT NOT NULL,
      pic TEXT NOT NULL,
      short_addr TEXT NOT NULL,
      addr TEXT NOT NULL,
      kbn TEXT NOT NULL,
      part_no TEXT,
      part_name TEXT,
      supplier TEXT,
      shop TEXT,
      dock TEXT,
      s_plant TEXT,
      s_dock TEXT,
      qty INTEGER,
      box TEXT,
      pcs TEXT,
      seq TEXT,
      not_found INTEGER NOT NULL DEFAULT 0,
      device_id TEXT,
      employee_name TEXT,
      employee_phone TEXT,
      updated_at TEXT,
      PRIMARY KEY (batch_id, pic, short_addr, addr, kbn)
    );
    -- Free Zone has no part list to match against (open scan), so it only
    -- ever knows the barcode itself + a running box count. Re-submitting
    -- the same barcode ADDS to box_count rather than replacing it — unlike
    -- handheld_stock_counts above — since the device already sends its own
    -- running total per send, and a second send from the same device later
    -- represents genuinely new boxes counted since the first send.
    CREATE TABLE IF NOT EXISTS handheld_free_zone_counts (
      batch_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      box_count INTEGER NOT NULL DEFAULT 0,
      employee_name TEXT,
      updated_at TEXT,
      PRIMARY KEY (batch_id, device_id, barcode)
    );
    -- Audit log of every "เริ่มกะทำงาน" (check-in) on a handheld — who held
    -- which device, when. Append-only (no primary key beyond id) since the
    -- same person/device/batch combination can legitimately check in more
    -- than once in a day (e.g. after a break). Not shown on the web yet;
    -- this just makes sure the data exists to build that view from later.
    CREATE TABLE IF NOT EXISTS handheld_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT,
      device_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      employee_phone TEXT NOT NULL,
      checked_in_at TEXT NOT NULL
    );
    -- Whole-factory part master, uploaded periodically from a single
    -- Excel export (Getsudo / ad-hoc counting — pick any part numbers on
    -- demand instead of going through the TBOS/Address-matching pipeline).
    -- key0 is the file's own composite key, but real exports have genuine
    -- duplicate key0 rows — so it's NOT the primary key here (a plain
    -- auto-increment id is). Every row from the file is kept exactly as
    -- uploaded, duplicates and all; when matching a part number against
    -- this table, only the first matching row is used (see
    -- matchPartNumbersAgainstMaster in getsudoRoute.js) — the data itself
    -- stays untouched either way. Full replace on every upload.
    -- monthly_forecast / daily_usage: not used anywhere yet (kept for
    -- future use) — the file's own forecast columns (7 dynamic month
    -- labels like "Jun-26", plus DMax/D01-D31/N01-N31 daily usage), stored
    -- as JSON objects since the month labels shift every time the file is
    -- regenerated and don't map to fixed table columns.
    CREATE TABLE IF NOT EXISTS getsudo_master_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key0 TEXT,
      source TEXT,
      dock TEXT,
      supplier TEXT,
      s_plant TEXT,
      s_dock TEXT,
      pno TEXT,
      part_no TEXT,
      part_name TEXT,
      kbn TEXT,
      qty TEXT,
      pc_addr TEXT,
      addr01 TEXT,
      monthly_forecast TEXT,
      daily_usage TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_getsudo_part_no ON getsudo_master_parts(part_no);
    -- Every NQC upload is kept as its own revision (never deleted) instead
    -- of replacing the previous one — matching/preview always use the
    -- MOST RECENT revision (MAX(id)), but older ones stay in the database
    -- for the upload-history view. row_count is a cached copy of how many
    -- parts that revision had, so listing history doesn't need to COUNT(*)
    -- against getsudo_master_parts for every past revision.
    CREATE TABLE IF NOT EXISTS getsudo_master_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_month TEXT,
      uploaded_at TEXT,
      row_count INTEGER
    );
  `);
  // ปรับ schema ของตารางเดิมให้มี group_prefix โดยไม่กระทบข้อมูลเดิม
  const uploadBatchesColumns = await db.all(`PRAGMA table_info(upload_batches)`);
  if (!uploadBatchesColumns.some((col) => col.name === 'group_prefix')) {
    await db.exec(`ALTER TABLE upload_batches ADD COLUMN group_prefix TEXT`);
  }
  if (!uploadBatchesColumns.some((col) => col.name === 'is_active')) {
    await db.exec(`ALTER TABLE upload_batches ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0`);
  }
  if (!uploadBatchesColumns.some((col) => col.name === 'is_baseline')) {
    await db.exec(`ALTER TABLE upload_batches ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0`);
  }
  // Getsudo's own "active batch", independent of is_active above (TBOS's).
  // Same table, separate flag, so the newest Getsudo batch can be "the one
  // in focus" for Getsudo's own Assign flow without ever touching what
  // TBOS considers active — see setGetsudoActiveBatch in lib/batches.js.
  if (!uploadBatchesColumns.some((col) => col.name === 'is_getsudo_active')) {
    await db.exec(`ALTER TABLE upload_batches ADD COLUMN is_getsudo_active INTEGER NOT NULL DEFAULT 0`);
  }

  // Same auto-migration approach for getsudo_master_parts — any new column
  // added here in the future just needs a line added below, never a manual
  // DROP TABLE. The very first version of this table used key0 as its
  // PRIMARY KEY, which SQLite can't just un-set via ALTER TABLE — so if
  // that old shape is still around, rebuild the table properly (copying
  // whatever rows already exist) instead of asking for one more manual drop.
  let getsudoPartsColumns = await db.all(`PRAGMA table_info(getsudo_master_parts)`);
  if (getsudoPartsColumns.length > 0 && !getsudoPartsColumns.some((col) => col.name === 'id')) {
    await db.exec(`ALTER TABLE getsudo_master_parts RENAME TO getsudo_master_parts_old`);
    await db.exec(`
      CREATE TABLE getsudo_master_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key0 TEXT, source TEXT, dock TEXT, supplier TEXT, s_plant TEXT, s_dock TEXT,
        pno TEXT, part_no TEXT, part_name TEXT, kbn TEXT, qty TEXT, pc_addr TEXT, addr01 TEXT,
        monthly_forecast TEXT, daily_usage TEXT, revision_id INTEGER, updated_at TEXT
      )
    `);
    const oldColNames = (await db.all(`PRAGMA table_info(getsudo_master_parts_old)`)).map((c) => c.name);
    const carryOverCols = ['key0', 'source', 'dock', 'supplier', 's_plant', 's_dock', 'pno', 'part_no', 'part_name', 'kbn', 'qty', 'pc_addr', 'addr01', 'updated_at']
      .filter((c) => oldColNames.includes(c));
    if (carryOverCols.length > 0) {
      const colList = carryOverCols.join(', ');
      await db.exec(`INSERT INTO getsudo_master_parts (${colList}) SELECT ${colList} FROM getsudo_master_parts_old`);
    }
    await db.exec(`DROP TABLE getsudo_master_parts_old`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_getsudo_part_no ON getsudo_master_parts(part_no)`);
    getsudoPartsColumns = await db.all(`PRAGMA table_info(getsudo_master_parts)`);
  }
  if (getsudoPartsColumns.length > 0) {
    if (!getsudoPartsColumns.some((col) => col.name === 'revision_id')) {
      await db.exec(`ALTER TABLE getsudo_master_parts ADD COLUMN revision_id INTEGER`);
    }
    if (!getsudoPartsColumns.some((col) => col.name === 'monthly_forecast')) {
      await db.exec(`ALTER TABLE getsudo_master_parts ADD COLUMN monthly_forecast TEXT`);
    }
    if (!getsudoPartsColumns.some((col) => col.name === 'daily_usage')) {
      await db.exec(`ALTER TABLE getsudo_master_parts ADD COLUMN daily_usage TEXT`);
    }
  }

  console.log("SQLite Database initialized with Batch System.");
  return db;
}

module.exports = { connectDB, initDB };