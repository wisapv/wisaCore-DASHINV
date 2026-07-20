// Canonical field name -> known raw Excel header variants.
// Audited from the `||` chains previously duplicated across
// part_list/mainFormatRoute.js, handheld_part_list/handheldRoute.js
// and handheld_part_list/assignAddrRoute.js.
const FIELD_ALIASES = {
  // Part Procurement columns
  TC_TO_UNL: ['T/C TO (UNL)', 'T/C TO (UNL) ', 'T/C TO(UNL)'],
  DOCK: ['DOCK', 'DOCK '],
  PROD_ROUTING: ['Production Routing', 'Production Routing ', 'Production process routing'],
  PART_NO_PP: ['PART #', 'PART # '],
  PART_DESC: ['PART DESC', 'PART DESC '],
  COMP: ['COMP'],
  SUPL: ['SUPL', 'SUPL '],
  PLANT: ['PLANT', 'PLANT '],
  S_DOCK: ['S.DOCK', 'S.DOCK '],
  KBN: ['KBN', 'KBN '],
  MODEL_NAME: ['Model Name'],
  LIFE_CYCLE_CODE: ['Life Cycle Code', 'Life cycle code'],
  V_SHARE_FLG: ['V.SHARE FLG[SYS L/O DATE BASIS]'],
  V_SHARE_VALUE: ['V.SHARE VALUE'],
  ORD_METHOD: ['ORD Method'],
  QTY_CONT: ['QTY /CONT', 'QTY /CONT '],
  PACK_QTY_CONT: ['PACK QTY/CONT'],

  // Target R/O columns
  SUPPLIER: ['Supplier', 'Supplier '],
  DOCK_IH: ['Dock IH routing', 'Dock IH routing '],
  PART_NO_TG: ['Part No 12 Digits', 'Part No 12 Digits '],
  SOURCE: ['Source', 'Source '],
};

function getField(row, canonicalName) {
  const aliases = FIELD_ALIASES[canonicalName] || [];
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

module.exports = { FIELD_ALIASES, getField };
