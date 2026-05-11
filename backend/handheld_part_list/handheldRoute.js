const express = require('express');
const { connectDB } = require('../database');
const router = express.Router();

function parseExcelDate(excelDate) {
  if (!excelDate) return new Date('invalid');
  if (typeof excelDate === 'number') return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  const cleanStr = String(excelDate).replace(/\s/g, '');
  if (/^\d{8}$/.test(cleanStr)) return new Date(cleanStr.slice(0, 4), parseInt(cleanStr.slice(4, 6)) - 1, cleanStr.slice(6, 8));
  return new Date(cleanStr);
}

router.get('/preview-handheld', async (req, res) => {
  try {
    const { batchId } = req.query; 
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const tgRows = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
    const ppRows = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

    if (tgRows.length === 0 || ppRows.length === 0) return res.status(404).json({ error: 'No Raw Data found.' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ppMap = new Map();

    for (const r of ppRows) {
      const p = JSON.parse(r.data);
      const tcToDate = p['T/C TO (UNL)'] || p['T/C TO (UNL) '] || p['T/C TO(UNL)'] || '';
      const rowDate = parseExcelDate(tcToDate);
      
      if (isNaN(rowDate) || rowDate <= today) continue; 

      const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
      const prodRouting = String(p['Production Routing'] || p['Production Routing '] || p['Production process routing'] || '').trim();
      const partNo = String(p['PART #'] || p['PART # '] || '').trim();
      
      const dockComb = prodRouting !== '' ? prodRouting : ppDock;
      const keyPP = (dockComb + partNo).replace(/[\s-]/g, '');
      
      if (String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase() !== 'WHEEL ASSY') {
        ppMap.set(keyPP, p);
      }
    }

    const previewData = [];

    for (const r of tgRows) {
      const t = JSON.parse(r.data);
      const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
      const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
      const partNo = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();

      if (tgDock !== '' && tgDock === supplier && supplier !== 'TTAT') continue;

      const keyTG = (tgDock + partNo).replace(/[\s-]/g, '');
      const p = ppMap.get(keyTG);

      if (p) {
        const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
        
        let shop = 'A';
        if (supplier === 'TTAT') shop = 'TTAT';
        else if (ppDock === 'SW' || ppDock === 'S9') shop = 'W';
        else if (ppDock === 'SK') shop = 'K';
        else if (ppDock === 'ST') shop = 'T';

        previewData.push({
          "Shop": shop,
          "Dock": ppDock,
          "Supplier": p['SUPL'] || p['SUPL '] || "",
          "S.plant": p['PLANT'] || p['PLANT '] || "",
          "S.dock": p['S.DOCK'] || p['S.DOCK '] || "",
          "Part no.": p['PART #'] || p['PART # '] || "",
          "Part name": p['PART DESC'] || p['PART DESC '] || "",
          "kbn": p['KBN'] || p['KBN '] || "",
          "Q'ty": p['QTY /CONT'] || p['QTY /CONT '] || ""
        });
      }
    }

    res.json({ message: 'Success', count: previewData.length, data: previewData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate handheld preview' });
  }
});

module.exports = router;