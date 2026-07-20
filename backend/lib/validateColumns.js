const { FIELD_ALIASES } = require('./fieldAliases');

const REQUIRED_FIELDS_TARGET_RO = ['PART_NO_TG', 'SUPPLIER', 'DOCK_IH', 'SOURCE'];

const REQUIRED_FIELDS_PART_PROCUREMENT = [
  'TC_TO_UNL', 'DOCK', 'PROD_ROUTING', 'PART_NO_PP', 'PART_DESC', 'COMP', 'SUPL',
  'PLANT', 'S_DOCK', 'KBN', 'MODEL_NAME', 'LIFE_CYCLE_CODE', 'V_SHARE_FLG',
  'V_SHARE_VALUE', 'ORD_METHOD', 'QTY_CONT', 'PACK_QTY_CONT',
];

function validateRequiredColumns(rawData, requiredCanonicalFields) {
  if (!rawData || rawData.length === 0) return { valid: true, missing: [] };

  const firstRowKeys = new Set(Object.keys(rawData[0]));
  const missing = requiredCanonicalFields.filter((canonicalName) => {
    const aliases = FIELD_ALIASES[canonicalName] || [];
    return !aliases.some((alias) => firstRowKeys.has(alias));
  });

  return { valid: missing.length === 0, missing };
}

module.exports = { validateRequiredColumns, REQUIRED_FIELDS_TARGET_RO, REQUIRED_FIELDS_PART_PROCUREMENT };
