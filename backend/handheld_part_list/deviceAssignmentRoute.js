const express = require('express');
const { connectDB } = require('../database');
const { getHandheldResults } = require('../lib/handheldResults');
const { emitEvent, EVENTS } = require('../lib/socketHub');
const { getActiveBatchId } = require('../lib/batches');

const router = express.Router();

// GET /api/handheld-assign/my-work-modes — a device can have assignments
// in the Part Runout active batch AND/OR one or more Getsudo batches at
// the same time (they're separate batches, never merged) — this tells the
// Android app which of those actually apply to THIS device, so it can skip
// the "which one?" screen when only one applies, and show it when both do.
async function handleGetWorkModes(req, res) {
  try {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

    const db = await connectDB();
    const activeBatchId = await getActiveBatchId(db);

    let tbos = null;
    if (activeBatchId) {
      const owns = await db.get(
        'SELECT 1 FROM handheld_assignments WHERE batch_id = ? AND device_id = ? LIMIT 1',
        [activeBatchId, deviceId]
      );
      if (owns) tbos = { batchId: activeBatchId };
    }

    const getsudoRows = await db.all(
      `SELECT DISTINCT batch_id FROM handheld_assignments WHERE device_id = ? AND batch_id LIKE 'GETSUDO-%'`,
      deviceId
    );

    res.json({
      tbos,
      getsudo: getsudoRows.map((r) => ({ batchId: r.batch_id })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load work modes' });
  }
}

// Restore state for the web's AssignHandheld page (which group is on which
// device for this batch) — same "restore on mount" pattern as final-data.
async function handleGetAssignments(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const rows = await db.all(
      'SELECT pic, short_addr AS shortAddr, device_id AS deviceId FROM handheld_assignments WHERE batch_id = ?',
      batchId
    );
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load device assignments' });
  }
}

// Replace-all-for-batch: the web always sends its full current mapping
// (assignments state), so the simplest correct write is delete-then-insert
// inside one transaction rather than diffing.
async function handleSaveAssignments(req, res) {
  try {
    const { batchId, assignments } = req.body;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });
    if (!Array.isArray(assignments)) return res.status(400).json({ error: 'assignments must be an array' });

    const db = await connectDB();
    const now = new Date().toISOString();

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM handheld_assignments WHERE batch_id = ?', batchId);
      for (const a of assignments) {
        if (!a.pic || !a.shortAddr || !a.deviceId) continue;
        await db.run(
          `INSERT INTO handheld_assignments (batch_id, pic, short_addr, device_id, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [batchId, a.pic, a.shortAddr, a.deviceId, now]
        );
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    emitEvent(EVENTS.HANDHELD_UPDATED, { batchId });
    res.json({ success: true, count: assignments.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save device assignments' });
  }
}

// What the Android app asks on Home/Part list: "what am I (this device)
// assigned to for the current batch?" Joins the assignment table against
// the batch's real PIC/Addr-matched rows (handheld_results.final_data),
// and subtracts anything already in handheld_stock_counts — itemCount is
// the REMAINING count, same "remain" principle as job-addresses/
// job-address-detail, so switching who's holding the device (เปลี่ยนคน)
// never re-shows work someone already finished.
async function handleGetMyJobs(req, res) {
  try {
    const { batchId, deviceId } = req.query;
    if (!batchId || !deviceId) return res.status(400).json({ error: 'Missing batchId or deviceId' });

    const db = await connectDB();
    const assignedGroups = await db.all(
      'SELECT pic, short_addr AS shortAddr FROM handheld_assignments WHERE batch_id = ? AND device_id = ?',
      [batchId, deviceId]
    );

    if (assignedGroups.length === 0) return res.json({ data: [] });

    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];

    const countedRows = await db.all(
      'SELECT pic, short_addr AS shortAddr, addr, kbn FROM handheld_stock_counts WHERE batch_id = ?',
      batchId
    );
    const countedKeys = new Set(countedRows.map((r) => `${r.pic}::${r.shortAddr}::${r.addr}::${r.kbn}`));

    const wanted = new Set(assignedGroups.map((g) => `${g.pic}::${g.shortAddr}`));
    const counts = new Map(); // key -> { code, pic, itemCount }

    finalData.forEach((row) => {
      const pic = row.PIC || 'Unassigned';
      const shortAddr = row.ShortAddr || 'Unk';
      const key = `${pic}::${shortAddr}`;
      if (!wanted.has(key)) return;
      const addr = row.Addr || row.ShortAddr || 'Unk';
      const kbn = row.kbn || row['Part no.'] || '';
      if (countedKeys.has(`${key}::${addr}::${kbn}`)) return; // already counted — not part of remain
      if (!counts.has(key)) counts.set(key, { code: shortAddr, pic, itemCount: 0 });
      counts.get(key).itemCount += 1;
    });

    res.json({ data: Array.from(counts.values()) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load jobs for device' });
  }
}

// The distinct physical addresses (Addr) inside one assigned zone
// (PIC + ShortAddr) — this is what Select Address on the device shows.
// Confirms the zone is actually assigned to this device first, so a
// device can't browse another zone just by guessing pic/shortAddr.
// remain = rows at that address NOT YET in handheld_stock_counts —
// counted rows disappear from the remaining total as they're submitted.
async function handleGetJobAddresses(req, res) {
  try {
    const { batchId, deviceId, pic, shortAddr } = req.query;
    if (!batchId || !deviceId || !pic || !shortAddr) {
      return res.status(400).json({ error: 'Missing batchId, deviceId, pic, or shortAddr' });
    }

    const db = await connectDB();
    const owned = await db.get(
      'SELECT 1 FROM handheld_assignments WHERE batch_id = ? AND device_id = ? AND pic = ? AND short_addr = ?',
      [batchId, deviceId, pic, shortAddr]
    );
    if (!owned) return res.status(403).json({ error: 'This zone is not assigned to this device' });

    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];

    const countedRows = await db.all(
      'SELECT addr, kbn FROM handheld_stock_counts WHERE batch_id = ? AND pic = ? AND short_addr = ?',
      [batchId, pic, shortAddr]
    );
    const countedKeys = new Set(countedRows.map((r) => `${r.addr}::${r.kbn}`));

    const totals = new Map(); // addr -> total row count
    const remaining = new Map(); // addr -> not-yet-counted row count
    finalData.forEach((row) => {
      if ((row.PIC || 'Unassigned') !== pic) return;
      if ((row.ShortAddr || 'Unk') !== shortAddr) return;
      const addr = row.Addr || row.ShortAddr || 'Unk';
      const kbn = row.kbn || row['Part no.'] || '';
      totals.set(addr, (totals.get(addr) || 0) + 1);
      if (!countedKeys.has(`${addr}::${kbn}`)) {
        remaining.set(addr, (remaining.get(addr) || 0) + 1);
      }
    });

    const data = Array.from(totals.keys())
      .map((addr) => ({ addr, remain: remaining.get(addr) || 0, done: (remaining.get(addr) || 0) === 0 }))
      .sort((a, b) => a.addr.localeCompare(b.addr));
    res.json({ data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load addresses for job' });
  }
}

// The part rows still remaining at one specific address — already-counted
// rows (present in handheld_stock_counts) are excluded, same "remain"
// principle as job-addresses above. Returns the full part context
// (Supplier/Shop/Dock/S.plant/S.dock/Part no./Part name/kbn/Q'ty) so
// Input Stock has everything it needs without a second round-trip.
async function handleGetJobAddressDetail(req, res) {
  try {
    const { batchId, deviceId, pic, shortAddr, addr } = req.query;
    if (!batchId || !deviceId || !pic || !shortAddr || !addr) {
      return res.status(400).json({ error: 'Missing required query params' });
    }

    const db = await connectDB();
    const owned = await db.get(
      'SELECT 1 FROM handheld_assignments WHERE batch_id = ? AND device_id = ? AND pic = ? AND short_addr = ?',
      [batchId, deviceId, pic, shortAddr]
    );
    if (!owned) return res.status(403).json({ error: 'This zone is not assigned to this device' });

    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];

    const countedRows = await db.all(
      'SELECT kbn FROM handheld_stock_counts WHERE batch_id = ? AND pic = ? AND short_addr = ? AND addr = ?',
      [batchId, pic, shortAddr, addr]
    );
    const countedKbns = new Set(countedRows.map((r) => r.kbn));

    const rows = finalData
      .filter((row) => (row.PIC || 'Unassigned') === pic)
      .filter((row) => (row.ShortAddr || 'Unk') === shortAddr)
      .filter((row) => (row.Addr || row.ShortAddr || 'Unk') === addr)
      .filter((row) => !countedKbns.has(row.kbn || row['Part no.'] || ''))
      .map((row) => ({
        supplier: row.Supplier || '',
        shop: row.Shop || '',
        dock: row.Dock || '',
        sPlant: row['S.plant'] || '',
        sDock: row['S.dock'] || '',
        kbn: row.kbn || row['Part no.'] || '',
        address: addr,
        partName: row['Part name'] || '',
        partNo: row['Part no.'] || '',
        qty: row["Q'ty"] || '',
      }));

    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load address detail' });
  }
}

// Input Stock "Send" — one submission = one part counted at one address.
// Upserts (overwrites) keyed by batch+pic+shortAddr+addr+kbn, so correcting
// a mistake is just submitting again with the same key. Carries the full
// part context copied in at submit time (see table comment in database.js).
async function handleSubmitCount(req, res) {
  try {
    const {
      batchId, deviceId, pic, shortAddr, addr, kbn,
      partNo, partName, supplier, shop, dock, sPlant, sDock,
      qty, box, pcs, seq, notFound, employeeName, employeePhone,
    } = req.body;

    if (!batchId || !pic || !shortAddr || !addr || !kbn) {
      return res.status(400).json({ error: 'Missing batchId, pic, shortAddr, addr, or kbn' });
    }

    const db = await connectDB();
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO handheld_stock_counts
         (batch_id, pic, short_addr, addr, kbn, part_no, part_name, supplier, shop, dock, s_plant, s_dock,
          qty, box, pcs, seq, not_found, device_id, employee_name, employee_phone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (batch_id, pic, short_addr, addr, kbn) DO UPDATE SET
         part_no = excluded.part_no, part_name = excluded.part_name, supplier = excluded.supplier,
         shop = excluded.shop, dock = excluded.dock, s_plant = excluded.s_plant, s_dock = excluded.s_dock,
         qty = excluded.qty, box = excluded.box, pcs = excluded.pcs, seq = excluded.seq,
         not_found = excluded.not_found, device_id = excluded.device_id,
         employee_name = excluded.employee_name, employee_phone = excluded.employee_phone,
         updated_at = excluded.updated_at`,
      [
        batchId, pic, shortAddr, addr, kbn, partNo || '', partName || '', supplier || '', shop || '',
        dock || '', sPlant || '', sDock || '', qty ?? null, box || '', pcs || '', seq || '',
        notFound ? 1 : 0, deviceId || '', employeeName || '', employeePhone || '', now,
      ]
    );

    emitEvent(EVENTS.HANDHELD_UPDATED, { batchId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save count' });
  }
}

// Free Zone "Send" — no part list to match, so only barcode + box count.
// ADDS to any existing box_count for that barcode (see table comment in
// database.js) rather than replacing it.
async function handleSubmitFreeZone(req, res) {
  try {
    const { batchId, deviceId, employeeName, items } = req.body;
    if (!batchId || !deviceId) return res.status(400).json({ error: 'Missing batchId or deviceId' });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

    const db = await connectDB();
    const now = new Date().toISOString();

    await db.run('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        if (!item.barcode || !item.boxCount) continue;
        await db.run(
          `INSERT INTO handheld_free_zone_counts (batch_id, device_id, barcode, box_count, employee_name, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (batch_id, device_id, barcode) DO UPDATE SET
             box_count = box_count + excluded.box_count,
             employee_name = excluded.employee_name,
             updated_at = excluded.updated_at`,
          [batchId, deviceId, item.barcode, item.boxCount, employeeName || '', now]
        );
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ success: true, count: items.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save free zone count' });
  }
}

// The whole zone flat — every part across every address, no per-address
// grouping (replaces the old Select Address → Address Detail two-step).
// Each row carries `counted` + whatever was previously submitted for it,
// so a re-scan of an already-counted item can open Input Stock pre-filled
// for correction instead of a blank form.
async function handleGetJobZoneParts(req, res) {
  try {
    const { batchId, deviceId, pic, shortAddr } = req.query;
    if (!batchId || !deviceId || !pic || !shortAddr) {
      return res.status(400).json({ error: 'Missing batchId, deviceId, pic, or shortAddr' });
    }

    const db = await connectDB();
    const owned = await db.get(
      'SELECT 1 FROM handheld_assignments WHERE batch_id = ? AND device_id = ? AND pic = ? AND short_addr = ?',
      [batchId, deviceId, pic, shortAddr]
    );
    if (!owned) return res.status(403).json({ error: 'This zone is not assigned to this device' });

    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];

    const countedRows = await db.all(
      'SELECT addr, kbn, qty, box, pcs, seq, not_found FROM handheld_stock_counts WHERE batch_id = ? AND pic = ? AND short_addr = ?',
      [batchId, pic, shortAddr]
    );
    const countedMap = new Map(countedRows.map((r) => [`${r.addr}::${r.kbn}`, r]));

    const rows = finalData
      .filter((row) => (row.PIC || 'Unassigned') === pic)
      .filter((row) => (row.ShortAddr || 'Unk') === shortAddr)
      .map((row) => {
        const addr = row.Addr || row.ShortAddr || 'Unk';
        const kbn = row.kbn || row['Part no.'] || '';
        const counted = countedMap.get(`${addr}::${kbn}`);
        return {
          supplier: row.Supplier || '',
          shop: row.Shop || '',
          dock: row.Dock || '',
          sPlant: row['S.plant'] || '',
          sDock: row['S.dock'] || '',
          kbn,
          address: addr,
          partName: row['Part name'] || '',
          partNo: row['Part no.'] || '',
          qty: row["Q'ty"] || '',
          counted: !!counted,
          countedQty: counted ? counted.qty : null,
          countedBox: counted ? counted.box : null,
          countedPcs: counted ? counted.pcs : null,
          countedSeq: counted ? counted.seq : null,
          countedNotFound: counted ? !!counted.not_found : false,
        };
      });

    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load zone parts' });
  }
}

// Audit log — "who held this device, when." Fire-and-forget from the
// Android app right after a successful check-in; failure here should
// never block the operator from getting to Home.
async function handleLogCheckIn(req, res) {
  try {
    const { batchId, deviceId, employeeId, employeePhone } = req.body;
    if (!deviceId || !employeeId || !employeePhone) {
      return res.status(400).json({ error: 'Missing deviceId, employeeId, or employeePhone' });
    }

    const db = await connectDB();
    const now = new Date().toISOString();
    await db.run(
      'INSERT INTO handheld_checkins (batch_id, device_id, employee_id, employee_phone, checked_in_at) VALUES (?, ?, ?, ?, ?)',
      [batchId || null, deviceId, employeeId, employeePhone, now]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log check-in' });
  }
}

router.get('/device-assignments', handleGetAssignments);
router.get('/my-work-modes', handleGetWorkModes);
router.post('/device-assignments', express.json({ limit: '5mb' }), handleSaveAssignments);
router.get('/my-jobs', handleGetMyJobs);
router.get('/job-addresses', handleGetJobAddresses);
router.get('/job-address-detail', handleGetJobAddressDetail);
router.get('/job-zone-parts', handleGetJobZoneParts);
router.post('/submit-count', express.json({ limit: '1mb' }), handleSubmitCount);
router.post('/submit-free-zone', express.json({ limit: '1mb' }), handleSubmitFreeZone);
router.post('/checkin', express.json({ limit: '1mb' }), handleLogCheckIn);

module.exports = router;
module.exports.handleGetAssignments = handleGetAssignments;
module.exports.handleGetWorkModes = handleGetWorkModes;
module.exports.handleSaveAssignments = handleSaveAssignments;
module.exports.handleGetMyJobs = handleGetMyJobs;
module.exports.handleGetJobAddresses = handleGetJobAddresses;
module.exports.handleGetJobAddressDetail = handleGetJobAddressDetail;
module.exports.handleGetJobZoneParts = handleGetJobZoneParts;
module.exports.handleSubmitCount = handleSubmitCount;
module.exports.handleSubmitFreeZone = handleSubmitFreeZone;
module.exports.handleLogCheckIn = handleLogCheckIn;