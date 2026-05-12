// ไฟล์: backend/handheld_part_list/assignAddrRoute.js
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { connectDB } = require('../database');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const generateExcelBuffer = (dataRows) => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(dataRows);
    xlsx.utils.book_append_sheet(wb, ws, "Handheld_Format");
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

function parseExcelDate(excelDate) {
    if (!excelDate) return new Date('invalid');
    if (typeof excelDate === 'number') return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    const cleanStr = String(excelDate).replace(/\s/g, '');
    if (/^\d{8}$/.test(cleanStr)) return new Date(cleanStr.slice(0, 4), parseInt(cleanStr.slice(4, 6)) - 1, cleanStr.slice(6, 8));
    return new Date(cleanStr);
}

router.post('/export-excel', express.json({ limit: '50mb' }), (req, res) => {
    try {
        const { data, fileName } = req.body;
        if (!data) return res.status(400).json({ error: "No data provided" });

        const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
        const buffer = generateExcelBuffer(jsonData);
        
        res.setHeader('Content-Disposition', `attachment; filename=${fileName || 'Handheld_Data'}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error("Export Excel Error:", err);
        res.status(500).send("Export Failed");
    }
});

router.post('/process-assign-addr', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { batchId } = req.body;
        
        const db = await connectDB();
        const tgRaw = await db.all('SELECT data FROM target_ro WHERE batch_id = ?', batchId);
        const ppRaw = await db.all('SELECT data FROM part_procurement WHERE batch_id = ?', batchId);

        const today = new Date(); today.setHours(0, 0, 0, 0);
        
        const ppMap = new Map();
        const allPpMap = new Map(); 

        ppRaw.forEach(r => {
            const p = JSON.parse(r.data);
            const tcToDate = p['T/C TO (UNL)'] || p['T/C TO (UNL) '] || p['T/C TO(UNL)'] || '';
            const rowDate = parseExcelDate(tcToDate);
            
            const ppDock = String(p['DOCK'] || p['DOCK '] || '').trim();
            const routing = String(p['Production Routing'] || p['Production Routing '] || p['Production process routing'] || '').trim();
            const partNo = String(p['PART #'] || p['PART # '] || '').trim();
            
            const dockComb = routing !== '' ? routing : ppDock;
            const keyPP = (dockComb + partNo).replace(/[\s-]/g, '');
            
            allPpMap.set(keyPP, p); 

            if (rowDate > today) {
                if (String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase() !== 'WHEEL ASSY') {
                    ppMap.set(keyPP, p);
                }
            }
        });

        const addrWorkbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const addrSheet = addrWorkbook.Sheets[addrWorkbook.SheetNames[0]];
        const addrRaw = xlsx.utils.sheet_to_json(addrSheet);
        
        const addrMap = new Map();
        const partNameAddrLookup = new Map();

        addrRaw.forEach(row => {
            const toDate = parseExcelDate(row['T/C TO (UNL)']);
            if (toDate > today) {
                const dock = String(row['DOCK'] || '').replace(/\s/g, '');
                const partNo = String(row['PART #'] || '').replace(/\s/g, '');
                const keyAddr = (dock + partNo).replace(/-/g, ''); 
                
                addrMap.set(keyAddr, row);

                const partNameKey = String(row['PART DESC'] || row['PART NAME'] || '').trim().toUpperCase();
                if (partNameKey) {
                    partNameAddrLookup.set(partNameKey, row);
                }
            }
        });

        const finalData = [];
        const holdData = [];
        const remindData = []; 
        const baseDataList = [];

        tgRaw.forEach(r => {
            const t = JSON.parse(r.data);
            const tgDock = String(t['Dock IH routing'] || t['Dock IH routing '] || '').trim();
            const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
            const partNoRaw = String(t['Part No 12 Digits'] || t['Part No 12 Digits '] || '').trim();
            
            if (!partNoRaw) return; 
            if (supplier === 'TTAT') return;
            if (tgDock !== '' && tgDock === supplier) return; 

            const keyTG = (tgDock + partNoRaw).replace(/[\s-]/g, '');
            const p = ppMap.get(keyTG); 

            if (p) {
                baseDataList.push({ t, p, keyTG });
            } else {
                if (!allPpMap.has(keyTG)) {
                    remindData.push({
                        "Dock IH": tgDock,
                        "Supplier": supplier,
                        "Part No": partNoRaw,
                        "Source": t['Source'] || t['Source '] || "",
                        "Reason": "Missing in Part Procurement"
                    });
                }
            }
        });

        const evaluatePicAndShop = (addrStr, dock, supplier) => {
            if (!addrStr) return { pic: 'A', shop: 'A', shouldDup: false };
            
            const addr = addrStr.trim().toUpperCase();
            const cleanAddr = addr.replace(/\s/g, ''); 
            const supl = supplier.trim().toUpperCase();

            // 1. W
            if (dock === 'SW' || dock === 'S9') return { pic: 'W', shop: 'W', shouldDup: true };
            // 2. T
            if (dock === 'ST') return { pic: 'T', shop: 'T', shouldDup: true };
            // 3. K
            if (dock === 'SK') return { pic: 'K', shop: 'K', shouldDup: true };
            
            // 4. TTAT
            if (dock === 'S6') {
                if (addr.startsWith('SS') && supl === 'TBAS') {
                    return { pic: 'S4', shop: 'A', shouldDup: false };
                }
                if (addr.startsWith('SS') || addr.startsWith('TUSHO')) {
                    return { pic: 'TTAT', shop: 'TTAT', shouldDup: false };
                }
            }

            // 5. R
            if (addr.startsWith('R.')) return { pic: 'R', shop: 'R', shouldDup: false };

            // 6. Shop A
            const shop = 'A';
            if (addr.startsWith('PC') || addr.startsWith('WH') || cleanAddr.length === 4) return { pic: 'PC', shop, shouldDup: true };
            if (/^(SBP|BP1|CH1|CH2|DO1|EG1|FA1|FN1|FN2|FN3|FN4|FR1|FR2|IP1|TR1|TR2|FA|SQ|SK)/.test(addr)) return { pic: 'A', shop, shouldDup: false };
            if (addr.startsWith('S4') || addr.startsWith('SS')) return { pic: 'S4', shop, shouldDup: false };
            if (/^(RA1|S5|SJ|SL|SM|SN|SO|SP)/.test(addr)) return { pic: 'S5', shop, shouldDup: false };
            if (addr.startsWith('S') && !/^(S5|S4|SJ|SL|SM|SN|SO|SP|SBP|SQ|SK)/.test(addr)) return { pic: 'ALS', shop, shouldDup: true };

            return { pic: 'A', shop, shouldDup: false };
        };

        baseDataList.forEach(item => {
            const { t, p } = item;
            const ppDockValue = String(p['DOCK'] || p['DOCK '] || '').replace(/\s/g, '');
            const ppPartNo = String(p['PART #'] || p['PART # '] || '').replace(/\s/g, '');
            const addrLookupKey = (ppDockValue + ppPartNo).replace(/-/g, '');
            
            let addrInfo = addrMap.get(addrLookupKey);
            
            if (!addrInfo) {
                const partNameKey = String(p['PART DESC'] || p['PART DESC '] || '').trim().toUpperCase();
                addrInfo = partNameAddrLookup.get(partNameKey);
            }

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

            const source = String(t['Source'] || t['Source '] || '').trim();
            const ppSupplier = String(p['SUPL'] || p['SUPL '] || '').trim();
            
            const kanbanAddrRaw = String(addrInfo['Kanban Print Address'] || '').trim().toUpperCase();
            const linesideAddrRaw = String(addrInfo['Lineside Address'] || '').trim().toUpperCase();

            const kanbanEval = evaluatePicAndShop(kanbanAddrRaw, ppDock, ppSupplier);

            const createFinalRow = (address, picType, finalShop, isLineside = false) => {
                // 🔴 จุดแก้ไข: เช็คว่าถ้า PIC เป็น A, R, K ให้ตัด 3 ตัวเลย
                let shortAddrLength = 2; // ค่าเริ่มต้น 2 ตัว
                
                if (['A', 'R', 'K'].includes(picType)) {
                    shortAddrLength = 3; // PIC A, R, K ใช้ 3 ตัว
                } else if (isLineside) {
                    shortAddrLength = 3; // Lineside อื่นๆ ใช้ 3 ตัวตามเดิม
                }

                const shortAddr = address.substring(0, shortAddrLength);

                return {
                    Shop: finalShop,
                    Group: 'SR481D' + finalShop + source,
                    Dock: ppDock,
                    Supplier: p['SUPL'] || p['SUPL '] || "",
                    "S.plant": p['PLANT'] || p['PLANT '] || "",             
                    "S.dock": p['S.DOCK'] || p['S.DOCK '] || "",             
                    "Part no.": p['PART #'] || p['PART # '] || "",           
                    "Part name": p['PART DESC'] || p['PART DESC '] || "",
                    kbn: p['KBN'] || p['KBN '] || "",
                    "Q'ty": p['QTY /CONT'] || p['QTY /CONT '] || "",
                    Addr: address,
                    ShortAddr: shortAddr, // 🔴 นำความยาวใหม่ที่คำนวณได้ไปใช้
                    PIC: picType
                };
            };

            if (kanbanAddrRaw) {
                finalData.push(createFinalRow(kanbanAddrRaw, kanbanEval.pic, kanbanEval.shop, false));
            }
            
            if (kanbanEval.shouldDup && linesideAddrRaw) {
                const linesideEval = evaluatePicAndShop(linesideAddrRaw, ppDock, ppSupplier);
                finalData.push(createFinalRow(linesideAddrRaw, linesideEval.pic, kanbanEval.shop, true));
            }
        });

        res.json({ success: true, data: finalData, hold: holdData, remind: remindData });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Process Failed' });
    }
});

module.exports = router;