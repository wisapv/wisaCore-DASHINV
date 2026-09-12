const express = require('express');
const { connectDB } = require('../database');
const { getHandheldResults } = require('../lib/handheldResults');
const { emitEvent, EVENTS } = require('../lib/socketHub');
const { decodeLocalFreeZoneQr } = require('../lib/freeZoneQr');
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
      qty, box, pcs, seq, order, notFound, employeeName, employeePhone,
    } = req.body;

    if (!batchId || !pic || !shortAddr || !addr || !kbn) {
      return res.status(400).json({ error: 'Missing batchId, pic, shortAddr, addr, or kbn' });
    }

    const db = await connectDB();
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO handheld_stock_counts
         (batch_id, pic, short_addr, addr, kbn, part_no, part_name, supplier, shop, dock, s_plant, s_dock,
          qty, box, pcs, seq, order_no, not_found, device_id, employee_name, employee_phone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (batch_id, pic, short_addr, addr, kbn) DO UPDATE SET
         part_no = excluded.part_no, part_name = excluded.part_name, supplier = excluded.supplier,
         shop = excluded.shop, dock = excluded.dock, s_plant = excluded.s_plant, s_dock = excluded.s_dock,
         qty = excluded.qty, box = excluded.box, pcs = excluded.pcs, seq = excluded.seq,
         order_no = excluded.order_no, not_found = excluded.not_found, device_id = excluded.device_id,
         employee_name = excluded.employee_name, employee_phone = excluded.employee_phone,
         updated_at = excluded.updated_at`,
      [
        batchId, pic, shortAddr, addr, kbn, partNo || '', partName || '', supplier || '', shop || '',
        dock || '', sPlant || '', sDock || '', qty ?? null, box || '', pcs || '', seq || '', order || null,
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

// Free Zone "Send" (QR version) — every code scanned is a full, self-
// describing box (Part No, Qty, Kbn, Address, etc. all baked in — see
// backend/lib/freeZoneQr.js), so there's nothing to type. Malformed codes
// (wrong format, IMPORT parts — not decodable yet, see the design
// discussion) are collected as failures instead of silently dropped, so
// the device can show the person which scans didn't go through.
async function handleSubmitFreeZoneQr(req, res) {
  try {
    const { batchId, deviceId, employeeName, qrCodes } = req.body;
    if (!batchId || !deviceId) return res.status(400).json({ error: 'Missing batchId or deviceId' });
    if (!Array.isArray(qrCodes)) return res.status(400).json({ error: 'qrCodes must be an array' });

    const db = await connectDB();
    const now = new Date().toISOString();
    const failures = [];
    let savedCount = 0;

    await db.run('BEGIN TRANSACTION');
    try {
      for (const raw of qrCodes) {
        const decoded = decodeLocalFreeZoneQr(raw);
        if (!decoded.ok) { failures.push({ raw, error: decoded.error }); continue; }

        await db.run(
          `INSERT INTO handheld_free_zone_scans
             (batch_id, order_number, part_no, box_seq, total_boxes, qty, dock, plant, supplier,
              s_plant, s_dock, arrival_date, arrival_time, lane_no, kbn, conveyance, address,
              raw_qr, device_id, employee_name, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (batch_id, order_number, part_no, box_seq) DO UPDATE SET
             total_boxes = excluded.total_boxes, qty = excluded.qty, dock = excluded.dock,
             plant = excluded.plant, supplier = excluded.supplier, s_plant = excluded.s_plant,
             s_dock = excluded.s_dock, arrival_date = excluded.arrival_date,
             arrival_time = excluded.arrival_time, lane_no = excluded.lane_no, kbn = excluded.kbn,
             conveyance = excluded.conveyance, address = excluded.address, raw_qr = excluded.raw_qr,
             device_id = excluded.device_id, employee_name = excluded.employee_name,
             updated_at = excluded.updated_at`,
          [
            batchId, decoded.orderNumber, decoded.partNo, decoded.boxSeq, decoded.totalBoxes, decoded.qty,
            decoded.dock, decoded.plant, decoded.supplier, decoded.sPlant, decoded.sDock,
            decoded.arrivalDate, decoded.arrivalTime, decoded.laneNo, decoded.kbn, decoded.conveyance,
            decoded.address, decoded.raw, deviceId, employeeName || '', now,
          ]
        );
        savedCount += 1;
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    if (savedCount > 0) emitEvent(EVENTS.HANDHELD_UPDATED, { batchId });
    res.json({ success: true, savedCount, failures });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save free zone scans' });
  }
}

// GET /api/handheld-assign/free-zone-detail?batchId=X — the Free Zone view
// on Stock Tracking Detail (see the Fix/Free toggle design discussion).
// Every decoded scan, with which zone it belongs to (resolved the same way
// as handleGetMonitor's Free zone section — via which device scanned it
// and which zone that device is assigned to) and whether its Part No shows
// up anywhere in this batch's own target list at all — a scan can be a
// real box that's just outside what this batch is tracking.
async function handleGetFreeZoneDetail(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const scans = await db.all(
      `SELECT * FROM handheld_free_zone_scans WHERE batch_id = ? ORDER BY updated_at DESC`,
      batchId
    );

    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];
    // Part Name by Part No — prefer this batch's own target list (it's the
    // more trustworthy, currently-in-scope source), falling back to NQC
    // Master (factory-wide, so it can name a part even if this batch never
    // targeted it — see the Free Zone / NQC Master design discussion).
    const partNameByNo = {};
    for (const row of finalData) {
      const no = (row['Part no.'] || '').trim();
      if (no && !partNameByNo[no]) partNameByNo[no] = row['Part name'] || '';
    }
    const knownPartNos = new Set(Object.keys(partNameByNo));

    const scannedPartNos = [...new Set(scans.map((s) => s.part_no).filter((p) => p && !partNameByNo[p]))];
    if (scannedPartNos.length > 0) {
      const placeholders = scannedPartNos.map(() => '?').join(',');
      const nqcRows = await db.all(
        `SELECT part_no, part_name FROM getsudo_master_parts WHERE part_no IN (${placeholders})`,
        scannedPartNos
      );
      for (const r of nqcRows) if (!partNameByNo[r.part_no]) partNameByNo[r.part_no] = r.part_name || '';
    }

    const assignments = await db.all(
      'SELECT pic AS dock, short_addr AS code, device_id FROM handheld_assignments WHERE batch_id = ?',
      batchId
    );
    const zoneByDevice = {};
    for (const a of assignments) zoneByDevice[a.device_id] = `${a.code}`; // short_addr IS the zone code for Free zone assignments — see zoneDefinitionRoute.js

    const data = scans.map((s) => ({
      zone: zoneByDevice[s.device_id] || 'Unassigned',
      dock: s.dock,
      partNo: s.part_no,
      partName: partNameByNo[s.part_no] || '',
      qty: s.qty,
      totalBoxes: s.total_boxes,
      orderNumber: s.order_number,
      arrivalDate: s.arrival_date,
      kbn: s.kbn,
      address: s.address,
      inBatchList: knownPartNos.has(s.part_no.trim()),
      updatedAt: s.updated_at,
    }));

    // Parts that ARE in this batch's own list surface first — that's the
    // more actionable information (these are the ones this batch actually
    // needs), with most-recently-scanned first within each group.
    data.sort((a, b) => {
      if (a.inBatchList !== b.inBatchList) return a.inBatchList ? -1 : 1;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    res.json({ data });
  } catch (error) {
    console.error('Get free zone detail error:', error);
    res.status(500).json({ error: 'Failed to load free zone detail' });
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

// GET /api/handheld-assign/monitor?batchId=X — the "check stock" board:
// how far along counting is, split by Fix zone (PIC-level for now — see
// the file-level comment on handleGetMonitor below) and Free zone.
//
// Fix: "total" is knowable (every row in finalData is one thing that must
// get counted), so this is a real X/Y with a percentage.
// Free: there's no "total" to count against (boxes are just wherever they
// are until someone finds and scans them), so it only reports a running
// box_count plus whether a human has manually marked that zone done (see
// free_zone_progress — POST /free-zone-progress toggles it).
async function handleGetMonitor(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();

    // --- Fix zone: group by PIC (not by the finer zone name — see the
    // "Zone Assignment Rules" backlog item; PIC is all handheld_stock_counts
    // and finalData currently carry, e.g. every W_PC/W_SEQ/W_LINE part
    // shows up under one shared "W" row until that's built) ---
    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];
    const totalByPic = {};
    for (const row of finalData) {
      const pic = row.PIC || 'Unassigned';
      totalByPic[pic] = (totalByPic[pic] || 0) + 1;
    }
    const countedRows = await db.all(
      'SELECT pic, COUNT(*) AS n FROM handheld_stock_counts WHERE batch_id = ? GROUP BY pic',
      batchId
    );
    const countedByPic = {};
    for (const r of countedRows) countedByPic[r.pic] = r.n;

    const fix = Object.keys(totalByPic).sort().map((pic) => {
      const total = totalByPic[pic];
      const counted = countedByPic[pic] || 0;
      return { pic, counted, total, percent: total > 0 ? Math.round((counted / total) * 100) : 0 };
    });

    // --- Free zone: sum box_count per zone, resolved from device_id via
    // handheld_assignments (pic=dock, shortAddr=zone code — see
    // zoneDefinitionRoute.js / AssignHandheld.jsx). A device assigned to
    // more than one Free zone at once has its full running total shown
    // under each — there's no way to split a single running scan total
    // back out per zone, so this is a known approximation until devices
    // are limited to one Free zone at a time. ---
    const zones = await db.all("SELECT id, code, dock FROM zone_definitions WHERE status = 'active'");
    const progressRows = await db.all('SELECT zone_id, marked_done FROM free_zone_progress WHERE batch_id = ?', batchId);
    const doneByZone = {};
    for (const r of progressRows) doneByZone[r.zone_id] = Boolean(r.marked_done);

    const free = [];
    for (const zone of zones) {
      const devices = await db.all(
        'SELECT device_id FROM handheld_assignments WHERE batch_id = ? AND pic = ? AND short_addr = ?',
        [batchId, zone.dock, zone.code]
      );
      let boxCount = 0;
      if (devices.length > 0) {
        const placeholders = devices.map(() => '?').join(',');
        const sumRow = await db.get(
          `SELECT COALESCE(SUM(box_count), 0) AS total FROM handheld_free_zone_counts WHERE batch_id = ? AND device_id IN (${placeholders})`,
          [batchId, ...devices.map((d) => d.device_id)]
        );
        boxCount = sumRow.total;
      }
      free.push({ zoneId: zone.id, code: zone.code, dock: zone.dock, boxCount, markedDone: doneByZone[zone.id] || false });
    }
    free.sort((a, b) => a.code.localeCompare(b.code));

    res.json({ fix, free });
  } catch (error) {
    console.error('Get monitor error:', error);
    res.status(500).json({ error: 'Failed to load monitor data' });
  }
}

// POST /api/handheld-assign/free-zone-progress — manual "I've counted this
// zone" toggle (see handleGetMonitor above for why Free zone has no
// automatic way to know it's done).
async function handleSetFreeZoneProgress(req, res) {
  try {
    const { batchId, zoneId, markedDone } = req.body;
    if (!batchId || !zoneId) return res.status(400).json({ error: 'Missing batchId or zoneId' });

    const db = await connectDB();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO free_zone_progress (batch_id, zone_id, marked_done, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(batch_id, zone_id) DO UPDATE SET marked_done = excluded.marked_done, updated_at = excluded.updated_at`,
      [batchId, zoneId, markedDone ? 1 : 0, now]
    );
    emitEvent(EVENTS.HANDHELD_UPDATED, { batchId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update zone progress' });
  }
}

// GET /api/handheld-assign/overview?batchId=X — powers the Overview page's
// real sections (Shop cards, Overall Progress, Local/Import/Inhouse,
// Shop Progress by zone, Device Status). See handleGetMonitor above for
// the same Fix/Free distinction — this endpoint only covers Fix zone (the
// "Overall Progress" card is explicitly Fix-only per the design) plus the
// composition/device sections that don't fit the per-PIC monitor shape.
async function handleGetOverview(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];

    // --- Shop cards + Overall Progress: total from finalData, counted from
    // handheld_stock_counts, both grouped by Shop (not PIC — Shop is the
    // coarser of the two fields, matches the 6 cards: A/W/T/K/R/TTAT) ---
    const totalByShop = {};
    for (const row of finalData) {
      const shop = row.Shop || 'Unassigned';
      totalByShop[shop] = (totalByShop[shop] || 0) + 1;
    }
    const countedShopRows = await db.all(
      'SELECT shop, COUNT(*) AS n FROM handheld_stock_counts WHERE batch_id = ? GROUP BY shop',
      batchId
    );
    const countedByShop = {};
    for (const r of countedShopRows) countedByShop[r.shop] = r.n;

    const shopProgress = Object.keys(totalByShop).sort().map((shop) => ({
      shop, counted: countedByShop[shop] || 0, total: totalByShop[shop],
    }));
    const overallTotal = shopProgress.reduce((s, r) => s + r.total, 0);
    const overallCounted = shopProgress.reduce((s, r) => s + r.counted, 0);
    const overallProgress = {
      counted: overallCounted,
      total: overallTotal,
      percent: overallTotal > 0 ? Math.round((overallCounted / overallTotal) * 100) : 0,
    };

    // --- Shop Progress by zone: PIC-level real data, with PIC "W" shown as
    // three mock rows (W_PC/W_SEQ/W_LINE) carrying W's own numbers
    // duplicated — a placeholder until Zone Assignment Rules can actually
    // tell them apart (see the backlog item). Every other PIC shows as one
    // real bar since splitting it further isn't needed for INV mapping
    // (see the Inv01-11 mapping discussion — only W loses information by
    // staying PIC-level). ---
    // --- Shop Progress by zone: PIC-level real data, relabeled to the zone
    // name your PIC→zone table maps each PIC to (see the "W_LINE W SW,S9 /
    // T_LINE T ST / ..." mapping from the design discussion) — PIC "W" is
    // the one exception, shown as three mock rows (W_PC/W_SEQ/W_LINE)
    // carrying W's own numbers duplicated, a placeholder until Zone
    // Assignment Rules can actually tell them apart (see the backlog item).
    const PIC_TO_ZONE_LABEL = {
      A: 'A_LINE', T: 'T_LINE', K: 'K_LINE', S4: 'S4_S-LANE', TTAT: 'S6_SEQ',
      R: 'R_LINE', PC: 'WH3_PC', S5: 'S5_SEQ', ALS: 'SEQ1',
    };
    const totalByPic = {};
    for (const row of finalData) {
      const pic = row.PIC || 'Unassigned';
      totalByPic[pic] = (totalByPic[pic] || 0) + 1;
    }
    const countedPicRows = await db.all(
      'SELECT pic, COUNT(*) AS n FROM handheld_stock_counts WHERE batch_id = ? GROUP BY pic',
      batchId
    );
    const countedByPic = {};
    for (const r of countedPicRows) countedByPic[r.pic] = r.n;

    const zoneProgress = [];
    for (const pic of Object.keys(totalByPic).sort()) {
      const total = totalByPic[pic];
      const counted = countedByPic[pic] || 0;
      if (pic === 'W') {
        ['W_PC', 'W_SEQ', 'W_LINE'].forEach((label) => zoneProgress.push({ zone: label, counted, total, isMock: true }));
      } else {
        zoneProgress.push({ zone: PIC_TO_ZONE_LABEL[pic] || pic, counted, total, isMock: false });
      }
    }

    // --- Local / Import / Inhouse: composition of the target list itself
    // (not a counting-progress figure) — 1=Local, 2 or 4=Import, 3=Inhouse
    // per the business rule (see Source field on createFinalRow). ---
    let local = 0, imported = 0, inhouse = 0, unknownSource = 0;
    for (const row of finalData) {
      const src = String(row.Source || '').trim();
      if (src === '1') local += 1;
      else if (src === '2' || src === '4') imported += 1;
      else if (src === '3') inhouse += 1;
      else unknownSource += 1;
    }
    const sourceComposition = [
      { label: 'Local', count: local },
      { label: 'Import', count: imported },
      { label: 'Inhouse', count: inhouse },
    ];
    if (unknownSource > 0) sourceComposition.push({ label: 'Unknown', count: unknownSource });

    // --- Detail by address: same idea as shopProgress/zoneProgress above
    // but at ShortAddr granularity (the "Detail by address" table shows
    // individual addresses, not just a Shop/PIC-level rollup) ---
    const addrKey = (shop, addr) => `${shop}::${addr}`;
    const totalByAddr = {};
    for (const row of finalData) {
      const shop = row.Shop || 'Unassigned';
      const addr = row.ShortAddr || 'Unk';
      const key = addrKey(shop, addr);
      if (!totalByAddr[key]) totalByAddr[key] = { shop, address: addr, total: 0 };
      totalByAddr[key].total += 1;
    }
    const countedAddrRows = await db.all(
      'SELECT shop, short_addr, COUNT(*) AS n FROM handheld_stock_counts WHERE batch_id = ? GROUP BY shop, short_addr',
      batchId
    );
    const countedByAddr = {};
    for (const r of countedAddrRows) countedByAddr[addrKey(r.shop, r.short_addr)] = r.n;

    const addressProgress = Object.keys(totalByAddr).sort().map((key) => {
      const { shop, address, total } = totalByAddr[key];
      const counted = countedByAddr[key] || 0;
      const status = counted === 0 ? 'Pending' : counted >= total ? 'Done' : 'Checking';
      return { shop, address, counted, total, status };
    });

    // --- Device Status: real device registry + most recent activity
    // (either a Fix count or a Free zone scan) as a stand-in for "last
    // sync". No battery % — the Android app doesn't report that to the
    // backend at all right now (see the Overview design discussion), and
    // no per-device progress % — a device's own "share" of a shared,
    // multi-device pool isn't a meaningful total to divide by.
    //
    // Two aggregate queries (one per source table) instead of a per-device
    // loop doing 2 awaited queries each — that N+1 pattern was fine for a
    // handful of devices but adds up, and this endpoint already does
    // several passes over a batch that can have thousands of rows. ---
    const devices = await db.all("SELECT id, name, status FROM handheld_devices WHERE status = 'active'");
    const lastFixByDevice = await db.all(
      `SELECT device_id, shop, short_addr, MAX(updated_at) AS updated_at
       FROM handheld_stock_counts WHERE batch_id = ? GROUP BY device_id`,
      batchId
    );
    const lastFreeByDevice = await db.all(
      `SELECT device_id, MAX(updated_at) AS updated_at
       FROM handheld_free_zone_counts WHERE batch_id = ? GROUP BY device_id`,
      batchId
    );
    const lastFixMap = {};
    for (const r of lastFixByDevice) lastFixMap[r.device_id] = r;
    const lastFreeMap = {};
    for (const r of lastFreeByDevice) lastFreeMap[r.device_id] = r;

    const deviceStatus = devices.map((d) => {
      const lastFix = lastFixMap[d.id];
      const lastFree = lastFreeMap[d.id];
      let lastActivity = null;
      let currentLabel = 'Unassigned';
      if (lastFix && (!lastFree || lastFix.updated_at >= lastFree.updated_at)) {
        lastActivity = lastFix.updated_at;
        currentLabel = `${lastFix.shop} / ${lastFix.short_addr}`;
      } else if (lastFree) {
        lastActivity = lastFree.updated_at;
        currentLabel = 'Free zone';
      }
      return { deviceId: d.id, name: d.name, currentLabel, lastActivity, status: lastActivity ? 'active' : 'idle' };
    });
    deviceStatus.sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));

    res.json({ shopProgress, overallProgress, zoneProgress, sourceComposition, addressProgress, deviceStatus });
  } catch (error) {
    console.error('Get overview error:', error);
    res.status(500).json({ error: 'Failed to load overview data' });
  }
}

// GET /api/handheld-assign/detail?batchId=X — the "Stock Tracking Detail"
// table: every expected part+address (from finalData) left-joined against
// whatever's actually been counted (handheld_stock_counts), matched on the
// exact same key as that table's own primary key (pic, short_addr, addr,
// kbn) so the join is exact, not a fuzzy guess. Parts with no matching row
// yet show as Pending with blank count fields — this is deliberately the
// full expected list, not just what's been counted so far.
async function handleGetDetail(req, res) {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const results = await getHandheldResults(db, batchId);
    const finalData = results ? results.finalData : [];

    const countRows = await db.all(
      `SELECT pic, short_addr, addr, kbn, qty, box, pcs, seq, order_no, not_found
       FROM handheld_stock_counts WHERE batch_id = ?`,
      batchId
    );
    const countMap = {};
    for (const r of countRows) countMap[`${r.pic}::${r.short_addr}::${r.addr}::${r.kbn}`] = r;

    // SUM STOCK: total counted qty across every address a given Part No +
    // Kbn combination shows up at in this batch (the same part can appear
    // at more than one address — see the Process Stock / zone-summing
    // discussion) — not just the one row's own qty.
    const sumByPart = {};
    for (const r of countRows) {
      if (r.qty == null) continue;
      const partKey = `${r.kbn}`; // kbn already uniquely identifies a part within a batch here
      sumByPart[partKey] = (sumByPart[partKey] || 0) + Number(r.qty || 0);
    }

    const detail = finalData.map((row) => {
      const key = `${row.PIC}::${row.ShortAddr}::${row.Addr}::${row.kbn}`;
      const counted = countMap[key];
      let status = 'Pending';
      if (counted) status = counted.not_found ? 'Not Found' : 'Done';
      return {
        pic: row.PIC || '',
        shortAddr: row.ShortAddr || '',
        shop: row.Shop || '',
        dock: row.Dock || '',
        partNo: row['Part no.'] || '',
        partName: row['Part name'] || '',
        kbn: row.kbn || '',
        address: row.Addr || '',
        qty: counted ? counted.qty : null,
        box: counted ? counted.box : '',
        pcs: counted ? counted.pcs : '',
        seq: counted ? counted.seq : '',
        order: counted ? counted.order_no : null, // always null until the handheld app itself sends one — see the order_no migration comment in database.js
        sumStock: sumByPart[row.kbn] || 0,
        status,
      };
    });

    res.json({ data: detail });
  } catch (error) {
    console.error('Get detail error:', error);
    res.status(500).json({ error: 'Failed to load detail data' });
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
router.get('/monitor', handleGetMonitor);
router.post('/free-zone-progress', express.json({ limit: '1mb' }), handleSetFreeZoneProgress);
router.get('/overview', handleGetOverview);
router.get('/detail', handleGetDetail);
router.post('/submit-free-zone-qr', express.json({ limit: '5mb' }), handleSubmitFreeZoneQr);
router.get('/free-zone-detail', handleGetFreeZoneDetail);

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
module.exports.handleSubmitFreeZoneQr = handleSubmitFreeZoneQr;
module.exports.handleGetMonitor = handleGetMonitor;
module.exports.handleSetFreeZoneProgress = handleSetFreeZoneProgress;
module.exports.handleGetOverview = handleGetOverview;
module.exports.handleGetDetail = handleGetDetail;
module.exports.handleGetFreeZoneDetail = handleGetFreeZoneDetail;
module.exports.handleLogCheckIn = handleLogCheckIn;