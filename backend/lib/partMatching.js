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

// mode 'main': TTAT and Dock=Supplier rows are dropped (not physically counted).
// mode 'handheld': those rows represent parts physically present in the warehouse
// and must be kept — only empty/N/A part numbers are ever invalid. The caller gets
// an isDockEqualsSupplier flag so it can dedupe that subgroup afterward.
function cleanTargetRow(t, { mode } = {}) {
  const partNo = getField(t, 'PART_NO_TG');
  const supplier = getField(t, 'SUPPLIER');
  const dockIH = getField(t, 'DOCK_IH');

  if (!partNo) return { valid: false, reason: 'empty part no' };
  if (partNo.toUpperCase() === 'N/A') return { valid: false, reason: 'N/A part no' };

  const isDockEqualsSupplier = dockIH !== '' && dockIH === supplier;

  if (mode === 'main') {
    if (supplier === 'TTAT') return { valid: false, reason: 'TTAT supplier' };
    if (isDockEqualsSupplier) return { valid: false, reason: 'dock equals supplier' };
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

module.exports = { buildPpIndex, cleanTargetRow, computeShop, dedupeDockEqualsSupplierRows };
