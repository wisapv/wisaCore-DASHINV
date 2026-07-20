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

function cleanTargetRow(t) {
  const partNo = getField(t, 'PART_NO_TG');
  const supplier = getField(t, 'SUPPLIER');
  const dockIH = getField(t, 'DOCK_IH');

  if (!partNo) return { valid: false, reason: 'empty part no' };
  if (partNo.toUpperCase() === 'N/A') return { valid: false, reason: 'N/A part no' };
  if (supplier === 'TTAT') return { valid: false, reason: 'TTAT supplier' };
  if (dockIH !== '' && dockIH === supplier) return { valid: false, reason: 'dock equals supplier' };

  return { valid: true };
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

module.exports = { buildPpIndex, cleanTargetRow, computeShop };
