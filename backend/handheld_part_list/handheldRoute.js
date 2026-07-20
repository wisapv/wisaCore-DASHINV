const express = require('express');
const { connectDB } = require('../database');
const { buildPpIndex, cleanTargetRow, computeShop } = require('../lib/partMatching');
const { buildMatchKey } = require('../lib/keyUtils');
const router = express.Router();

router.get('/preview-handheld', async (req, res) => {
  try {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const tgRows = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
    const ppRows = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

    if (tgRows.length === 0 || ppRows.length === 0) return res.status(404).json({ error: 'No Raw Data found.' });

    const { ppMap, duplicateKeys } = buildPpIndex(ppRows, { excludePartDesc: ['WHEEL ASSY'] });

    const previewData = [];

    for (const r of tgRows) {
      const t = JSON.parse(r.data);
      const { valid } = cleanTargetRow(t);
      if (!valid) continue;

      const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
      const partNo = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();

      const keyTG = buildMatchKey(tgDock, partNo);
      const p = ppMap.get(keyTG);

      if (p) {
        const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
        const shop = computeShop(ppDock, { mode: 'handheld' });

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

    res.json({ message: 'Success', count: previewData.length, data: previewData, duplicateKeys });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate handheld preview' });
  }
});

module.exports = router;
