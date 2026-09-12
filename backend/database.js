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
    -- Free Zone has no fixed "total" to count against (unlike Fix zone,
    -- which can compare counted rows against the known address list) — so
    -- "done" for a Free zone is a manual call, tracked per batch+zone here.
    -- Not part of zone_definitions itself since that table is a batch-
    -- independent master list; this is batch-scoped progress.
    CREATE TABLE IF NOT EXISTS free_zone_progress (
      batch_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      marked_done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (batch_id, zone_id)
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
    -- Free Zone scans, decoded (see backend/lib/freeZoneQr.js) — replaces
    -- the earlier barcode+box_count model, which assumed a person typed
    -- the box count in manually. Now the whole QR encodes everything
    -- (Part No, Qty, Kbn, Address, etc.) so nothing needs typing — see the
    -- Free Zone QR design discussion. Primary key is (order_number,
    -- part_no, box_seq): the same physical box scanned twice by mistake
    -- (or by two different devices) just overwrites the same row instead
    -- of counting it again.
    CREATE TABLE IF NOT EXISTS handheld_free_zone_scans (
      batch_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      part_no TEXT NOT NULL,
      box_seq INTEGER NOT NULL,
      total_boxes INTEGER,
      qty INTEGER,
      dock TEXT,
      plant TEXT,
      supplier TEXT,
      s_plant TEXT,
      s_dock TEXT,
      arrival_date TEXT,
      arrival_time TEXT,
      lane_no TEXT,
      kbn TEXT,
      conveyance TEXT,
      address TEXT,
      raw_qr TEXT,
      device_id TEXT,
      employee_name TEXT,
      updated_at TEXT,
      PRIMARY KEY (batch_id, order_number, part_no, box_seq)
    );
    CREATE INDEX IF NOT EXISTS idx_getsudo_part_no ON getsudo_master_parts(part_no);
    -- LTBO1021 List Report import (see the RUN OUT Summary design discussion)
    -- — its own batch, separate from the TBOS/Getsudo batch that actually
    -- did the counting, linked to it via linked_batch_id so a later
    -- Process Stock step knows which handheld_stock_counts/
    -- handheld_free_zone_scans rows to compare this master list against.
    CREATE TABLE IF NOT EXISTS ltbo_import_batches (
      batch_id TEXT PRIMARY KEY,
      linked_batch_id TEXT,
      file_count INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT
    );
    -- One row per real data row (row 6 onward, stops at the "END" sentinel)
    -- from an uploaded LTBO1021 List Report file — every file uploaded in
    -- the same import merges into the same batch_id here (see GentFile()'s
    -- old role of merging several Raw_File exports into one Template).
    -- row_signature is every field concatenated — two rows only collapse
    -- into one if they're identical in EVERY column, not just a handful of
    -- "identifying" ones (see the design discussion: matching on just
    -- Group ID+Part No+Dock+Supplier silently merged rows that actually
    -- differed elsewhere, e.g. Suffix).
    CREATE TABLE IF NOT EXISTS ltbo_master_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      company TEXT,
      company_plant_code TEXT,
      group_id TEXT,
      no_of_inventory TEXT,
      part_no TEXT,
      suffix TEXT,
      receiving_company TEXT,
      receiving_company_plant_code TEXT,
      production_process_routing TEXT,
      dock_code TEXT,
      supplier TEXT,
      supplier_plant_code TEXT,
      supplier_shipping_dock TEXT,
      previous_process_routing TEXT,
      dummy TEXT,
      out_of_calculation_flg TEXT,
      out_of_check_flg TEXT,
      min_bc_seq TEXT,
      attachment_point_1 TEXT,
      attachment_point_2 TEXT,
      attachment_point_3 TEXT,
      inv_result_1 TEXT, inv_result_2 TEXT, inv_result_3 TEXT, inv_result_4 TEXT,
      inv_result_5 TEXT, inv_result_6 TEXT, inv_result_7 TEXT, inv_result_8 TEXT,
      inv_result_9 TEXT, inv_result_10 TEXT, inv_result_11 TEXT, inv_result_12 TEXT,
      inv_result_13 TEXT,
      stock_in_transit_system TEXT,
      stock_in_transit_adjust_qty TEXT,
      comments TEXT,
      match_key TEXT,
      row_signature TEXT,
      source_file TEXT,
      UNIQUE (batch_id, row_signature)
    );
    CREATE INDEX IF NOT EXISTS idx_ltbo_master_match_key ON ltbo_master_rows(batch_id, match_key);
    -- Process Stock's computed output — kept separate from ltbo_master_rows
    -- (the raw import) so re-running Process Stock never mutates the
    -- original import, and so a batch can be recomputed freely after fixing
    -- counts. One row per RAW master row (ltbo_row_id), not per unique
    -- match_key — two rows sharing a match_key get identical computed
    -- values but both still need their own line in the final export, and
    -- the person needs "total parts" here to equal the import's own row
    -- count, not a deduplicated count (see the design discussion).
    -- status='not_found' rows are what block export (a hard block on
    -- unmatched parts, not a silent partial export).
    CREATE TABLE IF NOT EXISTS process_stock_results (
      ltbo_batch_id TEXT NOT NULL,
      ltbo_row_id INTEGER NOT NULL,
      match_key TEXT NOT NULL,
      part_no TEXT,
      group_id TEXT,
      inv_result_1 INTEGER NOT NULL DEFAULT 0, inv_result_2 INTEGER NOT NULL DEFAULT 0,
      inv_result_3 INTEGER NOT NULL DEFAULT 0, inv_result_4 INTEGER NOT NULL DEFAULT 0,
      inv_result_5 INTEGER NOT NULL DEFAULT 0, inv_result_6 INTEGER NOT NULL DEFAULT 0,
      inv_result_7 INTEGER NOT NULL DEFAULT 0, inv_result_8 INTEGER NOT NULL DEFAULT 0,
      inv_result_9 INTEGER NOT NULL DEFAULT 0, inv_result_10 INTEGER NOT NULL DEFAULT 0,
      inv_result_11 INTEGER NOT NULL DEFAULT 0,
      seq_no_1 TEXT, seq_no_2 TEXT, seq_no_3 TEXT,
      total_qty INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_found',
      has_ambiguous_w INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT,
      PRIMARY KEY (ltbo_batch_id, ltbo_row_id)
    );
    -- Overview's /overview endpoint groups handheld_stock_counts by shop and
    -- looks up per-device activity — neither is covered by that table's own
    -- primary key (batch_id, pic, short_addr, addr, kbn), so both would
    -- otherwise be a full scan of the batch's rows on every page load.
    CREATE INDEX IF NOT EXISTS idx_stock_counts_shop ON handheld_stock_counts(batch_id, shop);
    CREATE INDEX IF NOT EXISTS idx_stock_counts_device ON handheld_stock_counts(batch_id, device_id);
    CREATE INDEX IF NOT EXISTS idx_free_zone_device ON handheld_free_zone_counts(batch_id, device_id);
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
  // Stock Tracking Detail's ORDER column — submitted by the handheld itself
  // (like qty/box/pcs/seq), but neither the TBOS/Runout nor the Getsudo
  // input screens send it yet as of this writing (checked the Android
  // source directly — see the Detail page design discussion), so this
  // stays null until that's built. Migrated the same way as the
  // upload_batches columns above, since handheld_stock_counts already has
  // real rows in it before this column existed.
  const stockCountsColumns = await db.all(`PRAGMA table_info(handheld_stock_counts)`);
  if (!stockCountsColumns.some((col) => col.name === 'order_no')) {
    await db.exec(`ALTER TABLE handheld_stock_counts ADD COLUMN order_no TEXT`);
  }

  // ltbo_master_rows's very first version used a composite primary key
  // (batch_id, group_id, part_no, dock_code, supplier) — too narrow, it
  // silently merged rows that only matched on those 4 fields but actually
  // differed elsewhere (e.g. Suffix) — see the design discussion. Anyone
  // who ran that version has the old shape on disk; drop and let the
  // CREATE TABLE IF NOT EXISTS above recreate it correctly. Safe to lose
  // this table's data specifically — it's freshly-added and re-populated
  // by re-uploading the same source files, unlike every other table here.
  const ltboColumns = await db.all(`PRAGMA table_info(ltbo_master_rows)`);
  if (ltboColumns.length > 0 && !ltboColumns.some((col) => col.name === 'row_signature')) {
    await db.exec(`DROP TABLE ltbo_master_rows`);
    await db.exec(`
      CREATE TABLE ltbo_master_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        company TEXT, company_plant_code TEXT, group_id TEXT, no_of_inventory TEXT,
        part_no TEXT, suffix TEXT, receiving_company TEXT, receiving_company_plant_code TEXT,
        production_process_routing TEXT, dock_code TEXT, supplier TEXT, supplier_plant_code TEXT,
        supplier_shipping_dock TEXT, previous_process_routing TEXT, dummy TEXT,
        out_of_calculation_flg TEXT, out_of_check_flg TEXT, min_bc_seq TEXT,
        attachment_point_1 TEXT, attachment_point_2 TEXT, attachment_point_3 TEXT,
        inv_result_1 TEXT, inv_result_2 TEXT, inv_result_3 TEXT, inv_result_4 TEXT,
        inv_result_5 TEXT, inv_result_6 TEXT, inv_result_7 TEXT, inv_result_8 TEXT,
        inv_result_9 TEXT, inv_result_10 TEXT, inv_result_11 TEXT, inv_result_12 TEXT,
        inv_result_13 TEXT, stock_in_transit_system TEXT, stock_in_transit_adjust_qty TEXT,
        comments TEXT, match_key TEXT, row_signature TEXT, source_file TEXT,
        UNIQUE (batch_id, row_signature)
      )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_ltbo_master_match_key ON ltbo_master_rows(batch_id, match_key)`);
  }

  // process_stock_results is a pure computed cache (see its table comment)
  // — always safe to drop and let CREATE TABLE IF NOT EXISTS above rebuild
  // it with the current shape, since Process Stock just needs to be re-run.
  const processStockColumns = await db.all(`PRAGMA table_info(process_stock_results)`);
  if (processStockColumns.length > 0 && !processStockColumns.some((col) => col.name === 'ltbo_row_id')) {
    await db.exec(`DROP TABLE process_stock_results`);
    await db.exec(`
      CREATE TABLE process_stock_results (
        ltbo_batch_id TEXT NOT NULL, ltbo_row_id INTEGER NOT NULL, match_key TEXT NOT NULL, part_no TEXT, group_id TEXT,
        inv_result_1 INTEGER NOT NULL DEFAULT 0, inv_result_2 INTEGER NOT NULL DEFAULT 0,
        inv_result_3 INTEGER NOT NULL DEFAULT 0, inv_result_4 INTEGER NOT NULL DEFAULT 0,
        inv_result_5 INTEGER NOT NULL DEFAULT 0, inv_result_6 INTEGER NOT NULL DEFAULT 0,
        inv_result_7 INTEGER NOT NULL DEFAULT 0, inv_result_8 INTEGER NOT NULL DEFAULT 0,
        inv_result_9 INTEGER NOT NULL DEFAULT 0, inv_result_10 INTEGER NOT NULL DEFAULT 0,
        inv_result_11 INTEGER NOT NULL DEFAULT 0,
        seq_no_1 TEXT, seq_no_2 TEXT, seq_no_3 TEXT,
        total_qty INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'not_found',
        has_ambiguous_w INTEGER NOT NULL DEFAULT 0, computed_at TEXT,
        PRIMARY KEY (ltbo_batch_id, ltbo_row_id)
      )
    `);
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