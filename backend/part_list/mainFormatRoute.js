const express = require('express');
const { connectDB } = require('../database');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver'); 

const router = express.Router();

const generateExcelBuffer = (header, dataRows) => {
  const finalContent = [...header, ...dataRows, ["END"]];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(finalContent);
  xlsx.utils.book_append_sheet(wb, ws, "Part List");
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

function parseExcelDate(excelDate) {
  if (!excelDate) return new Date('invalid');
  if (typeof excelDate === 'number') return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  const cleanStr = String(excelDate).replace(/\s/g, '');
  if (/^\d{8}$/.test(cleanStr)) return new Date(cleanStr.slice(0, 4), parseInt(cleanStr.slice(4, 6)) - 1, cleanStr.slice(6, 8));
  return new Date(cleanStr);
}

router.get('/download-main', async (req, res) => {
  try {
    const templatePath = path.join(__dirname, '../templates/MainFormat.xlsx');
    if (!fs.existsSync(templatePath)) return res.status(400).json({ error: 'Template file not found.' });

    const { batchId, groups } = req.query; 
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });
    const selectedGroups = groups ? groups.split(',') : [];

    const db = await connectDB();
    const tgRows = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
    const ppRows = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

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
      p['Dock Comb.'] = dockComb;
      p['Suffix No'] = partNo.slice(-2);
      
      const keyPP = (dockComb + partNo).replace(/[\s-]/g, '');
      ppMap.set(keyPP, p);
    }

    const validRows = [];
    for (const r of tgRows) {
      const t = JSON.parse(r.data);
      const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
      const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
      const partNo = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();
      const source = String(t['Source'] || t['Source '] || '').trim();

      if (!partNo) continue;
      if (supplier === 'TTAT') continue; // Drop TTAT
      if (tgDock !== '' && tgDock === supplier) continue; // Drop Dock=Supplier

      const keyTG = (tgDock + partNo).replace(/[\s-]/g, '');
      const p = ppMap.get(keyTG); 

      if (p) {
        if (String(p['PART DESC'] || '').trim().toUpperCase() === 'WHEEL ASSY') continue;

        const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
        let shop = 'A';
        if (ppDock === 'SW' || ppDock === 'S9') shop = 'W';
        else if (ppDock === 'SK') shop = 'K';

        if (shop === 'K') continue; 

        t['Group'] = 'SR481D' + shop + source;
        validRows.push({ target_data: t, proc_data: p });
      }
    }

    const wbTemplate = xlsx.readFile(templatePath);
    const wsTemplate = wbTemplate.Sheets[wbTemplate.SheetNames[0]];
    const header = xlsx.utils.sheet_to_json(wsTemplate, { header: 1 }).slice(0, 5);

    const generateDataRow = (t, p) => [
      "AA", "B", t['Group'] || "", "6", String(p['PART #'] || p['PART # '] || "").substring(0, 10), 
      p['Suffix No'] || "", p['COMP'] || "", "S", p['Production Routing'] || p['Production Routing '] || "", 
      p['DOCK'] || p['DOCK '] || "", p['SUPL'] || "", p['PLANT'] || "", p['S.DOCK'] || "", 
      "", "", p['KBN'] || "", t['Source'] || t['Source '] || "", p['Dock Comb.'] || "", 
      String(p['Model Name'] || "").substring(0, 4), p['Life Cycle Code'] || p['Life cycle code'] || "", 
      p['V.SHARE FLG[SYS L/O DATE BASIS]'] || "", p['V.SHARE VALUE'] || "", 
      p['ORD Method'] || "", p['QTY /CONT'] || "", p['PACK QTY/CONT'] || "", 
      "3", p['PART DESC'] || ""
    ];

    if (selectedGroups.length === 1) {
      const groupName = selectedGroups[0];
      const dataRows = validRows.filter(r => r.target_data['Group'] === groupName).map(r => generateDataRow(r.target_data, r.proc_data));
      res.setHeader('Content-Disposition', `attachment; filename=PartList_${groupName}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(generateExcelBuffer(header, dataRows));
    } else {
      res.setHeader('Content-Disposition', `attachment; filename=PartList_Batches_${batchId}.zip`);
      res.setHeader('Content-Type', 'application/zip');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      const folderName = `PartList_${batchId}`; 
      for (const groupName of selectedGroups) {
        const dataRows = validRows.filter(r => r.target_data['Group'] === groupName).map(r => generateDataRow(r.target_data, r.proc_data));
        if (dataRows.length > 0) archive.append(generateExcelBuffer(header, dataRows), { name: `${folderName}/PartList_${groupName}.xlsx` });
      }
      await archive.finalize(); 
    }
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/preview-main', async (req, res) => {
  try {
    const { batchId } = req.query; 
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    const db = await connectDB();
    const tgRows = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
    const ppRows = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ppMap = new Map();
    const allPpMap = new Map(); // 🔴 เพิ่ม Map เพื่อเช็ค Remind
    
    for (const r of ppRows) {
      const p = JSON.parse(r.data);
      const tcToDate = p['T/C TO (UNL)'] || p['T/C TO (UNL) '] || p['T/C TO(UNL)'] || '';
      const rowDate = parseExcelDate(tcToDate);

      const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
      const prodRouting = String(p['Production Routing'] || p['Production Routing '] || p['Production process routing'] || '').trim();
      const partNo = String(p['PART #'] || p['PART # '] || '').trim();
      
      const dockComb = prodRouting !== '' ? prodRouting : ppDock;
      p['Dock Comb.'] = dockComb;
      p['Suffix No'] = partNo.slice(-2);
      
      const keyPP = (dockComb + partNo).replace(/[\s-]/g, '');
      
      allPpMap.set(keyPP, p); // 🔴 เก็บทุกข้อมูลเพื่ออ้างอิง

      if (isNaN(rowDate) || rowDate <= today) continue; 
      ppMap.set(keyPP, p);
    }

    const previewData = [];
    const remindData = []; // 🔴 สร้าง Array สำหรับข้อมูล Remind

    for (const r of tgRows) {
      const t = JSON.parse(r.data);
      const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
      const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
      const partNo = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();
      const source = String(t['Source'] || t['Source '] || '').trim();

      if (!partNo) continue;
      if (supplier === 'TTAT') continue; // 🔴 Drop TTAT
      if (tgDock !== '' && tgDock === supplier) continue; // 🔴 Drop Dock=Supplier

      const keyTG = (tgDock + partNo).replace(/[\s-]/g, '');
      const p = ppMap.get(keyTG); 

      if (p) {
        if (String(p['PART DESC'] || '').trim().toUpperCase() === 'WHEEL ASSY') continue;

        const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
        let shop = 'A';
        if (ppDock === 'SW' || ppDock === 'S9') shop = 'W';
        else if (ppDock === 'SK') shop = 'K';

        if (shop === 'K') continue; 

        t['Group'] = 'SR481D' + shop + source;

        previewData.push({
          "Company*": "AA",
          "Company plant code*": "B",
          "Group ID*": t['Group'] || "",
          "CTL flag*": "6",
          "Part No.*": String(p['PART #'] || p['PART # '] || "").substring(0, 10),
          "Suffix*": p['Suffix No'] || "",
          "Receiving company*": p['COMP'] || "",
          "Receiving company plant code*": "S",
          "Production process routing": p['Production Routing'] || p['Production Routing '] || "",
          "Dock code*": p['DOCK'] || p['DOCK '] || "",
          "Supplier*": p['SUPL'] || "",
          "Supplier plant code*": p['PLANT'] || "",
          "Supplier shipping dock": p['S.DOCK'] || "",
          "Previous process routing": "",
          "Dummy": "",
          "Kanban No.*": p['KBN'] || "",
          "Source code*": t['Source'] || t['Source '] || "",
          "Hikiate matching key*": p['Dock Comb.'] || "",
          "Model 1": String(p['Model Name'] || "").substring(0, 4),
          "Life cycle code*": p['Life cycle code'] || p['Life Cycle Code'] || "",
          "Vender share type": p['V.SHARE FLG[SYS L/O DATE BASIS]'] || "",
          "Vender share value": p['V.SHARE VALUE'] || "",
          "Order method*": p['ORD Method'] || "",
          "Order lot*": p['QTY /CONT'] || "",
          "Order lot size*": p['PACK QTY/CONT'] || "",
          "Round up flag*": "3",
          "Part name*": p['PART DESC'] || ""
        });
      } else {
        // 🔴 ถ้าไม่มีข้อมูลใน Part Procure ให้เอามาใส่ Remind (เงื่อนไขเดียวกับ Handheld)
        if (!allPpMap.has(keyTG)) {
            remindData.push({
                "Dock IH": tgDock,
                "Supplier": supplier,
                "Part No": partNo,
                "Source": source,
                "Reason": "Missing in Part Procurement"
            });
        }
      }
    }
    // 🔴 ส่งข้อมูล remind กลับไปพร้อมกัน
    res.json({ message: 'Success', count: previewData.length, data: previewData, remind: remindData });
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;