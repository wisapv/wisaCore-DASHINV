function parseExcelDate(excelDate) {
  if (!excelDate) return new Date('invalid');
  if (typeof excelDate === 'number') return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  const cleanStr = String(excelDate).replace(/\s/g, '');
  if (/^\d{8}$/.test(cleanStr)) return new Date(cleanStr.slice(0, 4), parseInt(cleanStr.slice(4, 6)) - 1, cleanStr.slice(6, 8));
  return new Date(cleanStr);
}

module.exports = { parseExcelDate };
