const { FIELD_ALIASES } = require('./fieldAliases');

const REQUIRED_FIELDS_TARGET_RO = ['PART_NO_TG', 'SUPPLIER', 'DOCK_IH', 'SOURCE'];

const REQUIRED_FIELDS_PART_PROCUREMENT = [
  'TC_TO_UNL', 'DOCK', 'PROD_ROUTING', 'PART_NO_PP', 'PART_DESC', 'COMP', 'SUPL',
  'PLANT', 'S_DOCK', 'KBN', 'MODEL_NAME', 'LIFE_CYCLE_CODE', 'V_SHARE_FLG',
  'V_SHARE_VALUE', 'ORD_METHOD', 'QTY_CONT', 'PACK_QTY_CONT',
];

function validateRequiredColumns(headerRow, requiredCanonicalFields) {
  if (!headerRow || headerRow.length === 0) return { valid: true, missing: [] };

  const headerSet = new Set(headerRow);
  const missing = requiredCanonicalFields.filter((canonicalName) => {
    const aliases = FIELD_ALIASES[canonicalName] || [];
    return !aliases.some((alias) => headerSet.has(alias));
  });

  return { valid: missing.length === 0, missing };
}

function findDuplicateHeaders(headerRow) {
  if (!headerRow) return [];

  const seen = new Set();
  const duplicates = new Set();
  for (const header of headerRow) {
    if (header === undefined || header === null || header === '') continue;
    if (seen.has(header)) duplicates.add(header);
    else seen.add(header);
  }

  return [...duplicates];
}

module.exports = {
  validateRequiredColumns,
  findDuplicateHeaders,
  REQUIRED_FIELDS_TARGET_RO,
  REQUIRED_FIELDS_PART_PROCUREMENT,
};
