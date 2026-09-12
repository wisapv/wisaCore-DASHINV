// ไฟล์: backend/handheld_part_list/assignAddrRoute.js
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');
const { buildPpIndex, cleanTargetRow, dedupeDockEqualsSupplierRows, createFirstOccurrenceTracker } = require('../lib/partMatching');
const { buildMatchKey } = require('../lib/keyUtils');
const { parseExcelDate } = require('../lib/dateUtils');
const { getField } = require('../lib/fieldAliases');
const { getStoredGroupPrefix } = require('../lib/groupPrefix');
const { saveHandheldResults, saveFinalData, getHandheldResults } = require('../lib/handheldResults');
const { emitEvent, EVENTS } = require('../lib/socketHub');
const { blankOrTrim, toExcelCellValue } = require('../lib/textUtils');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const evaluatePicAndShop = (addrStr, dock, supplier) => {
    if (!addrStr) return { pic: 'A', shop: 'A', shouldDup: false };

    const addr = addrStr.trim().toUpperCase();
    const cleanAddr = addr.replace(/\s/g, '');
    const supl = supplier.trim().toUpperCase();

    // 1. W
    if (dock === 'SW' || dock === 'S9') return { pic: 'W', shop: 'W', shouldDup: true };
    // 2. T
    if (dock === 'ST') return { pic: 'T', shop: 'T', shouldDup: true };
    // 3. K
    if (dock === 'SK') return { pic: 'K', shop: 'K', shouldDup: false };

    // 4. TTAT
    if (dock === 'S6') {
        if (addr.startsWith('SS') && supl === 'TBAS') {
            return { pic: 'S4', shop: 'A', shouldDup: false };
        }
        if (addr.startsWith('SS') || addr.startsWith('TUSHO')) {
            return { pic: 'TTAT', shop: 'TTAT', shouldDup: false };
        }
    }

    // 5. R
    if (addr.startsWith('R.')) return { pic: 'R', shop: 'R', shouldDup: false };

    // 6. Shop A
    const shop = 'A';
    if (addr.startsWith('PC') || addr.startsWith('WH') || cleanAddr.length === 4) return { pic: 'PC', shop, shouldDup: true };
    if (/^(SBP|BP1|CH1|CH2|DO1|EG1|FA1|FN1|FN2|FN3|FN4|FR1|FR2|IP1|TR1|TR2|FA|SQ|SK)/.test(addr)) return { pic: 'A', shop, shouldDup: false };
    if (addr.startsWith('S4') || addr.startsWith('SS')) return { pic: 'S4', shop, shouldDup: false };
    if (/^(RA1|S5|SJ|SL|SM|SN|SO|SP)/.test(addr)) return { pic: 'S5', shop, shouldDup: false };
    // ALS parts are counted once at the Kanban Print Address only — no Lineside duplicate.
    if (addr.startsWith('S') && !/^(S5|S4|SJ|SL|SM|SN|SO|SP|SBP|SQ|SK)/.test(addr)) return { pic: 'ALS', shop, shouldDup: false };

    return { pic: 'A', shop, shouldDup: false };
};

// Pure row builder — no closures over per-part loop state — so Pass 1
// (direct match) and Pass 2 (name-based fallback, see below) can reuse the
// exact same shape without duplicating it.
function createFinalRow({ address, picType, finalShop, isLineside = false, ppDock, groupPrefix, source, p }) {
    // 🔴 จุดแก้ไข: เช็คว่าถ้า PIC เป็น A, R, K ให้ตัด 3 ตัวเลย
    let shortAddrLength = 2; // ค่าเริ่มต้น 2 ตัว

    if (['A', 'R', 'K'].includes(picType)) {
        shortAddrLength = 3; // PIC A, R, K ใช้ 3 ตัว
    } else if (isLineside) {
        shortAddrLength = 3; // Lineside อื่นๆ ใช้ 3 ตัวตามเดิม
    }

    const shortAddr = address.substring(0, shortAddrLength);

    return {
        Shop: finalShop,
        Group: groupPrefix + finalShop + source,
        Dock: ppDock,
        Supplier: blankOrTrim(p['SUPL'] || p['SUPL ']),
        "S.plant": blankOrTrim(p['PLANT'] || p['PLANT ']),
        "S.dock": blankOrTrim(p['S.DOCK'] || p['S.DOCK ']),
        "Part no.": blankOrTrim(p['PART #'] || p['PART # ']),
        "Part name": blankOrTrim(p['PART DESC'] || p['PART DESC ']),
        kbn: blankOrTrim(p['KBN'] || p['KBN ']),
        "Q'ty": blankOrTrim(p['QTY /CONT'] || p['QTY /CONT ']),
        Addr: address,
        ShortAddr: shortAddr, // 🔴 นำความยาวใหม่ที่คำนวณได้ไปใช้
        PIC: picType,
        // Exposed as its own field (was previously only folded into Group
        // above) for the Overview page's Local/Import/Inhouse breakdown —
        // see Overview.jsx. Raw value from Target R/O's own Source column,
        // untouched — 1=Local, 2 or 4=Import, 3=Inhouse per the business rule.
        Source: source
    };
}

// Address Master can have multiple time-overlapping valid rows for the same
// part (genuinely different physical delivery/kanban points, not sequential
// revisions) — each is processed independently, so one part can produce more
// than one Kanban(+Lineside) pair of output rows. Candidates accumulate
// locally first so they can go through a final per-part Addr dedup: two
// different valid Address Master entries can share the same Kanban Print
// Address while differing only in Lineside Address, which the per-entry
// check below (Kanban vs Lineside within the same entry) doesn't catch.
// Scoped strictly to this one part's own candidate rows — never across
// different parts, since two unrelated parts coincidentally sharing an
// address is normal and must not be collapsed. Shared as-is by both Pass 1
// (direct match) and Pass 2 (name-based fallback) below.
function buildPartRows(addrInfoList, { ppDock, ppSupplier, groupPrefix, source, p }) {
    const partRows = [];
    for (const addrInfo of addrInfoList) {
        const kanbanAddrRaw = String(addrInfo['Kanban Print Address'] || '').trim().toUpperCase();
        const linesideAddrRaw = String(addrInfo['Lineside Address'] || '').trim().toUpperCase();

        const kanbanEval = evaluatePicAndShop(kanbanAddrRaw, ppDock, ppSupplier);

        if (kanbanAddrRaw) {
            partRows.push(createFinalRow({ address: kanbanAddrRaw, picType: kanbanEval.pic, finalShop: kanbanEval.shop, isLineside: false, ppDock, groupPrefix, source, p }));
        }

        // Only duplicate into a Lineside row when the group calls for it AND
        // the Lineside Address genuinely differs from the Kanban Print
        // Address for this same entry — otherwise it's the same physical
        // point counted twice.
        if (kanbanEval.shouldDup && linesideAddrRaw && linesideAddrRaw !== kanbanAddrRaw) {
            const linesideEval = evaluatePicAndShop(linesideAddrRaw, ppDock, ppSupplier);
            partRows.push(createFinalRow({ address: linesideAddrRaw, picType: linesideEval.pic, finalShop: linesideEval.shop, isLineside: true, ppDock, groupPrefix, source, p }));
        }
    }

    const seenAddr = new Set();
    const deduped = [];
    for (const row of partRows) {
        const normalizedAddr = row.Addr.trim().toUpperCase();
        if (seenAddr.has(normalizedAddr)) continue;
        seenAddr.add(normalizedAddr);
        deduped.push(row);
    }
    return deduped;
}

// json_to_sheet has the same '' vs null quirk as aoa_to_sheet (see
// toExcelCellValue), so this is the write boundary for the Handheld export:
// dataRows here is whatever the client posts back (built from this route's
// own blankOrTrim(...) preview data), so '' needs converting to null right
// before it reaches json_to_sheet.
const toExcelRow = (row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, toExcelCellValue(value)])
);

const generateExcelBuffer = (dataRows) => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(dataRows.map(toExcelRow));
    xlsx.utils.book_append_sheet(wb, ws, "Handheld_Format");
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

router.post('/export-excel', express.json({ limit: '50mb' }), (req, res) => {
    try {
        const { data, fileName } = req.body;
        if (!data) return res.status(400).json({ error: "No data provided" });

        const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
        const buffer = generateExcelBuffer(jsonData);
        
        res.setHeader('Content-Disposition', `attachment; filename=${fileName || 'Handheld_Data'}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error("Export Excel Error:", err);
        res.status(500).send("Export Failed");
    }
});

async function handleProcessAssignAddr(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { batchId } = req.body;

        const db = await connectDB();
        const groupPrefix = await getStoredGroupPrefix(db, batchId);
        const tgRaw = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
        const ppRaw = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

        const today = new Date(); today.setHours(0, 0, 0, 0);

        const { ppMap, allPpMap, duplicateKeys } = buildPpIndex(ppRaw, { excludePartDesc: ['WHEEL ASSY'] });

        const addrWorkbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const addrSheet = addrWorkbook.Sheets[addrWorkbook.SheetNames[0]];
        const addrRaw = xlsx.utils.sheet_to_json(addrSheet);
        
        // Unlike Part Procurement (single active row per key), Address Master can
        // legitimately have multiple time-overlapping valid rows for the same
        // Dock+PartNo — genuinely different physical delivery/kanban points, not
        // sequential revisions. So addrMap is key -> row[], not key -> row; every
        // row whose [T/C FROM, T/C TO] window contains today is kept, not just the
        // last one parsed.
        const addrMap = new Map();
        const partNameAddrLookup = new Map();

        addrRaw.forEach(row => {
            const fromDate = parseExcelDate(getField(row, 'TC_FROM_UNL'));
            const toDate = parseExcelDate(getField(row, 'TC_TO_UNL'));
            const isActive = !isNaN(fromDate) && !isNaN(toDate) && fromDate <= today && today <= toDate;
            if (!isActive) return;

            const dock = String(row['DOCK'] || '').replace(/\s/g, '');
            const partNo = String(row['PART #'] || '').replace(/\s/g, '');
            const keyAddr = (dock + partNo).replace(/-/g, '');

            if (!addrMap.has(keyAddr)) addrMap.set(keyAddr, []);
            addrMap.get(keyAddr).push(row);

            // Same key -> row[] treatment as addrMap above: multiple valid rows
            // can legitimately share a part name, and overwriting would silently
            // drop all but the last one parsed.
            const partNameKey = String(row['PART DESC'] || row['PART NAME'] || '').trim().toUpperCase();
            if (partNameKey) {
                if (!partNameAddrLookup.has(partNameKey)) partNameAddrLookup.set(partNameKey, []);
                partNameAddrLookup.get(partNameKey).push(row);
            }
        });

        const finalData = [];
        const holdData = [];
        const remindData = []; 
        const baseDataList = [];

        const cleanedRows = [];
        tgRaw.forEach(r => {
            const t = JSON.parse(r.data);
            const { valid, isDockEqualsSupplier } = cleanTargetRow(t, { mode: 'handheld' });
            if (!valid) return;
            t.isDockEqualsSupplier = isDockEqualsSupplier;
            cleanedRows.push(t);
        });
        const dedupedRows = dedupeDockEqualsSupplierRows(cleanedRows, (row) => getField(row, 'PART_NO_TG'));

        // Additive, and runs after the Dock=Supplier-subgroup dedup above —
        // safe/idempotent for rows that step already deduped, and catches
        // the general case (e.g. two rows differing only in an unused
        // source column like "CTL routing") across the full row set.
        const isFirstOccurrence = createFirstOccurrenceTracker();

        dedupedRows.forEach(t => {
            const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
            const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
            const partNoRaw = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();

            const keyTG = buildMatchKey(tgDock, partNoRaw);
            if (!isFirstOccurrence(keyTG)) return;

            const p = ppMap.get(keyTG);

            if (p) {
                baseDataList.push({ t, p, keyTG });
            } else {
                if (!allPpMap.has(keyTG)) {
                    remindData.push({
                        "Dock IH": tgDock,
                        "Supplier": supplier,
                        "Part No": partNoRaw,
                        "Source": blankOrTrim(t['Source'] || t['Source ']),
                        "Reason": "Missing in Part Procurement"
                    });
                }
            }
        });

        // Address Master's real file has no part-name column of its own (its
        // header is SUPL/PLANT/COMP/DOCK/PART #/KBN/T-C dates/addresses/... —
        // no "PART DESC"/"PART NAME"), so partNameAddrLookup above is always
        // empty in practice; kept as a legacy fallback rather than removed.
        // The real name-based fallback source is Part Procurement's own
        // PART DESC: a part with no direct Address Master match borrows the
        // resolved address entries of another part that shares its PART DESC
        // and DID match directly. Two passes make that possible without
        // depending on baseDataList's iteration order: Pass 1 resolves every
        // direct match first (and records what it resolved, keyed by PART
        // DESC); Pass 2 then lets every non-matching part look up siblings
        // resolved in Pass 1, regardless of which one happened to come first.
        const resolvedByName = new Map();
        // Third fallback layer, keyed by the first 5 characters of Part
        // Procurement's own PART # (e.g. '779160K05000' -> '77916') — parts
        // that share a manufacturing series/prefix are commonly stored at the
        // same address even when their full part numbers and PART DESC both
        // differ. Populated ONLY from genuine Pass 1 direct addrMap matches
        // below, never from Pass 2's name-fallback resolutions — otherwise a
        // borrowed address could be borrowed again, one step further removed
        // from anything Address Master actually said.
        const resolvedByPartPrefix = new Map();
        const pendingFallback = [];

        baseDataList.forEach(item => {
            const { t, p } = item;
            const ppDockValue = String(p['DOCK'] || p['DOCK '] || '').replace(/\s/g, '');
            const ppPartNo = String(p['PART #'] || p['PART # '] || '').replace(/\s/g, '');
            const addrLookupKey = (ppDockValue + ppPartNo).replace(/-/g, '');

            const directAddrMatch = addrMap.get(addrLookupKey);
            let addrInfoList = directAddrMatch;

            if (!addrInfoList || addrInfoList.length === 0) {
                const legacyPartNameKey = String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase();
                addrInfoList = partNameAddrLookup.get(legacyPartNameKey) || [];
            }

            const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
            const source = String(t['Source'] || t['Source '] || '').trim();
            const ppSupplier = String(p['SUPL'] || p['SUPL '] || '').trim();
            const partDescKey = String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase();
            const partPrefixKey = String(p['PART #'] || p['PART # '] || '').trim().slice(0, 5);
            const ctx = { ppDock, ppSupplier, groupPrefix, source, p, partDescKey, partPrefixKey };

            if (addrInfoList.length > 0) {
                finalData.push(...buildPartRows(addrInfoList, ctx));

                if (partDescKey) {
                    if (!resolvedByName.has(partDescKey)) resolvedByName.set(partDescKey, []);
                    resolvedByName.get(partDescKey).push(...addrInfoList);
                }

                if (partPrefixKey && directAddrMatch && directAddrMatch.length > 0) {
                    if (!resolvedByPartPrefix.has(partPrefixKey)) resolvedByPartPrefix.set(partPrefixKey, []);
                    resolvedByPartPrefix.get(partPrefixKey).push(...directAddrMatch);
                }
            } else {
                pendingFallback.push(ctx);
            }
        });

        pendingFallback.forEach(ctx => {
            const { ppDock, p, partDescKey, partPrefixKey } = ctx;
            const entries = partDescKey ? (resolvedByName.get(partDescKey) || []) : [];

            if (entries.length > 0) {
                finalData.push(...buildPartRows(entries, ctx));
                return;
            }

            const prefixEntries = partPrefixKey ? (resolvedByPartPrefix.get(partPrefixKey) || []) : [];

            if (prefixEntries.length > 0) {
                finalData.push(...buildPartRows(prefixEntries, ctx));
                return;
            }

            // Still genuinely unresolved by all three passes: goes to Hold
            // exactly as before this task — no output row is added for it
            // here (that's a separate, deferred piece of work, out of scope
            // here).
            holdData.push({
                "Dock": ppDock,
                "Supplier": blankOrTrim(p['SUPL'] || p['SUPL ']),
                "Part No": blankOrTrim(p['PART #'] || p['PART # ']),
                "Part Name": blankOrTrim(p['PART DESC'] || p['PART DESC ']),
                "Reason": "Missing in Address Master"
            });
        });

        // Persisted so a full page reload (or another user landing on this
        // batch) can restore the fully-assigned Handheld view directly,
        // instead of only the base preview — see handleGetFinalData below.
        // Doesn't change the response shape returned to the caller.
        await saveHandheldResults(db, batchId, { finalData, holdData, remindData });

        emitEvent(EVENTS.HANDHELD_UPDATED, { batchId });
        res.json({ success: true, data: finalData, hold: holdData, remind: remindData, duplicateKeys });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Process Failed' });
    }
}

router.post('/process-assign-addr', upload.single('file'), handleProcessAssignAddr);

// Restores the persisted address-assigned result for a batch — what a full
// page reload uses to skip straight back to the fully-assigned Handheld
// view instead of the "please upload Address Master" prompt. A clear 404
// (not an empty success) when process-assign-addr has never been run for
// this batch, so the frontend can tell "nothing yet" apart from "empty".
async function handleGetFinalData(req, res) {
    try {
        const { batchId } = req.query;
        if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

        const db = await connectDB();
        const results = await getHandheldResults(db, batchId);
        if (!results) return res.status(404).json({ error: 'Not yet processed for this batch' });

        res.json({ success: true, data: results.finalData, hold: results.holdData, remind: results.remindData, updatedAt: results.updatedAt });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load persisted handheld data' });
    }
}

router.get('/final-data', handleGetFinalData);

// Saves a manual PIC drag-and-drop reassignment — same save-an-edit pattern
// as the Group Prefix work (groupPrefixHistoryRoute.js): a POST to the same
// path the GET reads from, body carries the full updated value. Only
// final_data changes here; Hold/Remind are untouched.
async function handleSaveFinalData(req, res) {
    try {
        const { batchId, data } = req.body;
        if (!batchId) return res.status(400).json({ error: 'Missing batchId' });
        if (!Array.isArray(data)) return res.status(400).json({ error: 'data must be an array' });

        const db = await connectDB();
        const saved = await saveFinalData(db, batchId, data);
        if (!saved) return res.status(404).json({ error: 'Not yet processed for this batch' });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save handheld data' });
    }
}

router.post('/final-data', express.json({ limit: '50mb' }), handleSaveFinalData);

module.exports = router;
module.exports.evaluatePicAndShop = evaluatePicAndShop;
module.exports.handleProcessAssignAddr = handleProcessAssignAddr;
module.exports.handleGetFinalData = handleGetFinalData;
module.exports.handleSaveFinalData = handleSaveFinalData;
module.exports.generateExcelBuffer = generateExcelBuffer;