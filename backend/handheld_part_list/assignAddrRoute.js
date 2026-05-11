const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function parseExcelDate(excelDate) {
    if (!excelDate) return new Date('invalid');
    if (typeof excelDate === 'number') return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    const cleanStr = String(excelDate).replace(/\s/g, '');
    if (/^\d{8}$/.test(cleanStr)) return new Date(cleanStr.slice(0, 4), parseInt(cleanStr.slice(4, 6)) - 1, cleanStr.slice(6, 8));
    return new Date(cleanStr);
}

router.post('/process-assign-addr', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { batchId } = req.body;
        
        const db = await connectDB();
        const tgRaw = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
        const ppRaw = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const ppMap = new Map();
        
        ppRaw.forEach(r => {
            const p = JSON.parse(r.data);
            const tcToDate = p['T/C TO (UNL)'] || p['T/C TO (UNL) '] || p['T/C TO(UNL)'] || '';
            const rowDate = parseExcelDate(tcToDate);
            if (rowDate > today) {
                const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
                const routing = String(p['Production Routing'] || p['Production Routing '] || p['Production process routing'] || '').trim();
                const partNo = String(p['PART #'] || p['PART # '] || '').trim();
                
                const dockComb = routing !== '' ? routing : ppDock;
                const keyPP = (dockComb + partNo).replace(/[\s-]/g, '');
                
                if (String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase() !== 'WHEEL ASSY') {
                    ppMap.set(keyPP, p);
                }
            }
        });

        const addrWorkbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const addrSheet = addrWorkbook.Sheets[addrWorkbook.SheetNames[0]];
        const addrRaw = xlsx.utils.sheet_to_json(addrSheet);
        const addrMap = new Map();

        addrRaw.forEach(row => {
            const toDate = parseExcelDate(row['T/C TO (UNL)']);
            if (toDate > today) {
                const dock = String(row['DOCK'] || '').replace(/\s/g, '');
                const partNo = String(row['PART #'] || '').replace(/\s/g, '');
                const keyAddr = (dock + partNo).replace(/-/g, ''); 
                addrMap.set(keyAddr, row);
            }
        });

        const finalData = [];
        const holdData = [];
        const remindData = []; 
        const baseDataList = [];
        const partNameAddrLookup = new Map();

        tgRaw.forEach(r => {
            const t = JSON.parse(r.data);
            const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
            const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
            const partNoRaw = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();
            
            if (tgDock !== '' && tgDock === supplier && supplier !== 'TTAT') return;

            const keyTG = (tgDock + partNoRaw).replace(/[\s-]/g, '');
            const p = ppMap.get(keyTG);

            if (p) {
                const addrInfo = addrMap.get(keyTG);
                const partDescKey = String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase();

                if (addrInfo && partDescKey) partNameAddrLookup.set(partDescKey, addrInfo);
                baseDataList.push({ t, p, addrInfoDirect: addrInfo, partDescKey });
            } else {
                remindData.push({
                    "Dock IH": tgDock,
                    "Supplier": supplier,
                    "Part No": partNoRaw,
                    "Source": t['Source'] || t['Source '] || "",
                    "Reason": "Missing in Part Procurement"
                });
            }
        });

        baseDataList.forEach(item => {
            const { t, p, addrInfoDirect, partDescKey } = item;
            const addrInfo = addrInfoDirect || partNameAddrLookup.get(partDescKey);
            const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();

            if (!addrInfo) {
                holdData.push({ 
                    "Dock": ppDock,
                    "Supplier": p['SUPL'] || p['SUPL '] || "",
                    "Part No": p['PART #'] || p['PART # '] || "",
                    "Part Name": p['PART DESC'] || p['PART DESC '] || "",
                    "Reason": "Missing in Address Master" 
                });
                return;
            }

            const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
            const source = String(t['Source'] || t['Source '] || '').trim();

            let shop = 'A';
            if (supplier === 'TTAT') shop = 'TTAT';
            else if (ppDock === 'SW' || ppDock === 'S9') shop = 'W';
            else if (ppDock === 'SK') shop = 'K';
            else if (ppDock === 'ST') shop = 'T';

            const kanbanAddr = String(addrInfo['Kanban Print Address'] || '').trim();
            const linesideAddr = String(addrInfo['Lineside Address'] || '').trim();

            const createFinalRow = (address, picType) => ({
                Shop: shop,
                Group: 'SR481D' + shop + source,
                Dock: ppDock,
                Supplier: p['SUPL'] || p['SUPL '] || "",
                "S.plant": p['PLANT'] || p['PLANT '] || "",             
                "S.dock": p['S.DOCK'] || p['S.DOCK '] || "",             
                "Part no.": p['PART #'] || p['PART # '] || "",           
                "Part name": p['PART DESC'] || p['PART DESC '] || "",
                kbn: p['KBN'] || p['KBN '] || "",
                "Q'ty": p['QTY /CONT'] || p['QTY /CONT '] || "",
                Addr: address,
                PIC: picType
            });

            if (shop === 'A') {
                let pic = 'A';
                let shouldDup = false;

                if (kanbanAddr.startsWith('R.')) { shop = 'R'; pic = 'R'; shouldDup = false; }
                else if (/^(SBP|BP1|CH1|CH2|DO1|EG1|FA1|FN1|FN2|FN3|FN4|FR1|FR2|IP1|TR1|TR2|FA)/.test(kanbanAddr)) { pic = 'A'; shouldDup = false; }
                else if (kanbanAddr.startsWith('PC') && kanbanAddr.length === 4) { pic = 'PC'; shouldDup = true; }
                else if (kanbanAddr.startsWith('S4') || (ppDock === 'S4' && kanbanAddr.startsWith('SS'))) { pic = 'S4'; shouldDup = false; }
                else if (/^(RA1|S5|SJ|SL|SM|SN|SO|SP)/.test(kanbanAddr)) { pic = 'S5'; shouldDup = false; }
                else if (kanbanAddr.startsWith('S')) { pic = 'ALS'; shouldDup = true; }
                else { pic = 'A'; shouldDup = false; }

                if (kanbanAddr) finalData.push(createFinalRow(kanbanAddr, pic));
                if (shouldDup && linesideAddr) finalData.push(createFinalRow(linesideAddr, pic));
            } 
            else if (['W', 'T', 'K', 'TTAT'].includes(shop)) {
                if (kanbanAddr) finalData.push(createFinalRow(kanbanAddr, shop));
                if (linesideAddr) finalData.push(createFinalRow(linesideAddr, shop));
            }
        });

        res.json({ success: true, data: finalData, hold: holdData, remind: remindData });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Process Failed' });
    }
});

module.exports = router;