const { getField } = require('./fieldAliases');
const { parseExcelDate } = require('./dateUtils');
const { buildMatchKey } = require('./keyUtils');

function buildPpIndex(ppRows, { onlyActive = true, excludePartDesc = [] } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const excludeSet = new Set(excludePartDesc.map((d) => d.toUpperCase()));

  const ppMap = new Map();
  const allPpMap = new Map();
  const keyCounts = new Map();

  for (const row of ppRows) {
    const p = JSON.parse(row.data);

    const tcToDate = getField(p, 'TC_TO_UNL');
    const rowDate = parseExcelDate(tcToDate);

    const ppDock = getField(p, 'DOCK');
    const prodRouting = getField(p, 'PROD_ROUTING');
    const partNo = getField(p, 'PART_NO_PP');

    const dockComb = prodRouting !== '' ? prodRouting : ppDock;
    p['Dock Comb.'] = dockComb;
    p['Suffix No'] = partNo.slice(-2);

    const keyPP = buildMatchKey(dockComb, partNo);
    keyCounts.set(keyPP, (keyCounts.get(keyPP) || 0) + 1);
    allPpMap.set(keyPP, p);

    if (onlyActive && (isNaN(rowDate) || rowDate <= today)) continue;

    const partDesc = getField(p, 'PART_DESC').toUpperCase();
    if (excludeSet.has(partDesc)) continue;

    ppMap.set(keyPP, p);
  }

  const duplicateKeys = [...keyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  return { ppMap, allPpMap, duplicateKeys };
}

// mode 'main': TTAT and Dock=Supplier rows are dropped.
// mode 'handheld': per the Handheld-process spec ("if Dock IH routing =
// Supplier delete... this time we do NOT delete TTAT"), Dock=Supplier rows
// are ALSO dropped here — confirmed against a real reproduced case
// (52110-0K410-A3, Dock IH routing/Supplier "AAS1S") where Dock=Supplier
// still resolved to a real physical address via Part Procurement's own
// Production Routing; per spec it's dropped anyway, no exception. TTAT is
// the one difference from mode 'main': the spec says NOT to drop TTAT for
// Handheld, so only empty/N/A part numbers and Dock=Supplier are invalid
// here. isDockEqualsSupplier stays on the returned object for any caller
// still branching on it, though with this row now invalid, no row ever
// reaches dedupeDockEqualsSupplierRows with the flag set anymore.
function cleanTargetRow(t, { mode } = {}) {
  const partNo = getField(t, 'PART_NO_TG');
  const supplier = getField(t, 'SUPPLIER');
  const dockIH = getField(t, 'DOCK_IH');

  if (!partNo) return { valid: false, reason: 'empty part no' };
  if (partNo.toUpperCase() === 'N/A') return { valid: false, reason: 'N/A part no' };

  const isDockEqualsSupplier = dockIH !== '' && dockIH === supplier;
  if (isDockEqualsSupplier) return { valid: false, reason: 'dock equals supplier', isDockEqualsSupplier };

  if (mode === 'main') {
    if (supplier === 'TTAT') return { valid: false, reason: 'TTAT supplier' };
    return { valid: true, isDockEqualsSupplier };
  }

  if (mode === 'handheld') {
    return { valid: true, isDockEqualsSupplier };
  }

  throw new Error(`cleanTargetRow: unknown mode "${mode}"`);
}

// Within the Dock=Supplier subgroup, keep only the first occurrence per keyFn(row)
// (original order) — these tend to contain duplicate rows for the same physical
// part differing only by Source. Rows outside the subgroup pass through untouched.
function dedupeDockEqualsSupplierRows(rows, keyFn) {
  const seenKeys = new Set();
  const result = [];

  for (const row of rows) {
    if (!row.isDockEqualsSupplier) {
      result.push(row);
      continue;
    }
    const key = keyFn(row);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    result.push(row);
  }

  return result;
}

// A tiny "have I seen this key before" tracker. Some Target R/O source data
// has two rows that are identical for every purpose this system cares about
// (same Dock IH routing + Part No, i.e. the same matching key) but differ in
// some field the system never reads (e.g. an unused "CTL routing" column) —
// their outputs would be byte-for-byte identical anyway. Callers pass in
// whatever key they've already computed for matching (keyTG) rather than
// recomputing it, and keep only the first occurrence in original row order.
function createFirstOccurrenceTracker() {
  const seenKeys = new Set();
  return (key) => {
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  };
}

// mode 'main' has no 'T' branch and mode 'handheld' does: the handheld dock
// routing recognizes 'ST' as its own shop, a distinction main format never
// implemented. Kept as one function so the intentional difference is visible
// in one place instead of silently diverging across copies again.
function computeShop(ppDock, { mode }) {
  if (mode === 'main') {
    if (ppDock === 'SW' || ppDock === 'S9') return 'W';
    if (ppDock === 'SK') return 'K';
    return 'A';
  }
  if (mode === 'handheld') {
    if (ppDock === 'SW' || ppDock === 'S9') return 'W';
    if (ppDock === 'ST') return 'T';
    if (ppDock === 'SK') return 'K';
    return 'A';
  }
  throw new Error(`computeShop: unknown mode "${mode}"`);
}

// Compares two sets of already-parsed Target R/O rows by keyTG (Dock IH
// routing + Part No, built the same way as everywhere else via
// cleanTargetRow + buildMatchKey) and returns the current batch's rows whose
// keyTG isn't present among the previous batch's valid keyTGs. Uses
// cleanTargetRow's 'handheld' mode on both sides — it only rejects
// empty/N/A part numbers, so a TTAT or Dock=Supplier row (a real physical
// part) isn't wrongly excluded from "needs registering" just because the
// Main Format flow wouldn't count it. An empty previousTgRows (the
// first-ever batch, nothing to compare against) naturally makes every valid
// current row "new".
function findNewPartsSinceBatch(currentTgRows, previousTgRows) {
  // Only excludes rows with no usable Part No — deliberately NOT reusing
  // cleanTargetRow's mode='handheld' (which now also drops Dock=Supplier
  // rows for the Handheld pipeline's own business rule — see that
  // function's comment). New Parts detection is a different feature with
  // no reason to inherit that rule: a genuinely new Dock=Supplier part
  // should still surface here even though it won't appear in Handheld's
  // own output.
  const isUsablePartNo = (row) => {
    const partNo = getField(row, 'PART_NO_TG');
    return partNo !== '' && partNo.toUpperCase() !== 'N/A';
  };

  const previousKeys = new Set();
  for (const row of previousTgRows) {
    if (!isUsablePartNo(row)) continue;
    previousKeys.add(buildMatchKey(getField(row, 'DOCK_IH'), getField(row, 'PART_NO_TG')));
  }

  return currentTgRows.filter((row) => {
    if (!isUsablePartNo(row)) return false;
    const keyTG = buildMatchKey(getField(row, 'DOCK_IH'), getField(row, 'PART_NO_TG'));
    return !previousKeys.has(keyTG);
  });
}

module.exports = { buildPpIndex, cleanTargetRow, computeShop, dedupeDockEqualsSupplierRows, createFirstOccurrenceTracker, findNewPartsSinceBatch };