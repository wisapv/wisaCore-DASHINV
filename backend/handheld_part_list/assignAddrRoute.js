// ไฟล์: backend/handheld_part_list/assignAddrRoute.js
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

            const supplier = String(t['Supplier'] || t['Supplier '] || '').trim();
            const source = String(t['Source'] || t['Source '] || '').trim();
            
            // 🔴 1. คลีนดาต้าและแปลงเป็น "ตัวพิมพ์ใหญ่ทั้งหมด" เพื่อแก้ปัญหา r. ไม่ตรงกับ R.
            const kanbanAddrRaw = String(addrInfo['Kanban Print Address'] || '').trim().toUpperCase();
            const linesideAddrRaw = String(addrInfo['Lineside Address'] || '').trim().toUpperCase();
            
            // ลบเว้นวรรคตรงกลางออกทั้งหมด เอาไว้นับ Length=4 สำหรับ PC (เช่น F  -  01 กลายเป็น F-01)
            const kanbanAddrClean = kanbanAddrRaw.replace(/\s/g, ''); 

            let shop = 'A';
            let pic = 'A';
            let shouldDup = false;
            let linesidePic = 'A';

            // 🔴 2. เริ่มเช็คเงื่อนไข Shop หลัก
            if (ppDock === 'SW' || ppDock === 'S9') {
                shop = 'W'; pic = 'W'; shouldDup = true; linesidePic = 'W';
            } 
            else if (ppDock === 'ST') {
                shop = 'T'; pic = 'T'; shouldDup = true; linesidePic = 'T';
            } 
            else if (ppDock === 'SK') {
                shop = 'K'; pic = 'K'; shouldDup = true; linesidePic = 'K';
            } 
            else if (ppDock === 'S6' && (kanbanAddrRaw.startsWith('SS') || kanbanAddrRaw.startsWith('TUSHO')) && supplier !== 'TBOS') {
                shop = 'TTAT'; pic = 'TTAT'; shouldDup = false; 
            } 
            else if (kanbanAddrRaw.startsWith('R.')) {
                shop = 'R'; pic = 'R'; shouldDup = false; 
            } 
            else {
                // 🔴 3. กฎเฉพาะสำหรับ Shop A (เรียงลำดับใหม่ให้เป๊ะที่สุด)
                shop = 'A';
                
                // 1. ถ้าขึ้นต้นด้วย PC เป๊ะๆ
                if (kanbanAddrRaw.startsWith('PC')) {
                    pic = 'PC'; shouldDup = true; linesidePic = 'A';
                } 
                // 2. ถ้าขึ้นต้นด้วยพวกแก๊ง PIC A
                else if (/^(SBP|BP1|CH1|CH2|DO1|EG1|FA1|FN1|FN2|FN3|FN4|FR1|FR2|IP1|TR1|TR2|FA)/.test(kanbanAddrRaw)) {
                    pic = 'A'; shouldDup = false;
                } 
                // 3. แก๊ง S4
                else if (kanbanAddrRaw.startsWith('S4') || (ppDock === 'S4' && kanbanAddrRaw.startsWith('SS'))) {
                    pic = 'S4'; shouldDup = false;
                } 
                // 4. แก๊ง S5
                else if (/^(RA1|S5|SJ|SL|SM|SN|SO|SP)/.test(kanbanAddrRaw)) {
                    pic = 'S5'; shouldDup = false;
                } 
                // 5. แก๊ง ALS (ขึ้นต้นด้วย S แต่ไม่ชนกับแก๊งข้างบน)
                else if (kanbanAddrRaw.startsWith('S') && !/^(S5|S4|SJ|SL|SM|SN|SO|SP|SBP)/.test(kanbanAddrRaw)) {
                    pic = 'ALS'; shouldDup = true; linesidePic = 'A';
                } 
                // 6. 🔴 เงื่อนไขตกค้าง ถ้าสั้น 4 ตัว (เช่น F-01) ถึงจะให้เป็น PC (วางไว้ท้ายสุดจะได้ไม่แย่งซีนตัวอื่น)
                else if (kanbanAddrClean.length === 4) {
                    pic = 'PC'; shouldDup = true; linesidePic = 'A';
                }
                // 7. นอกเหนือจากนี้ โยนเข้า A หมด
                else {
                    pic = 'A'; shouldDup = false;
                }
            }

            // 🔴 4. ฟังก์ชันสร้างข้อมูล
            const createFinalRow = (address, picType, finalShop, isLineside = false) => {
                // ตัด 3 ตัว สำหรับ Lineside และตัด 2 ตัว สำหรับ Kanban ตามที่สั่ง
                const shortAddr = isLineside ? address.substring(0, 3) : address.substring(0, 2);
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
                    ShortAddr: shortAddr, 
                    PIC: picType
                };
            };

            // บรรทัดแรก (Kanban Print Addr)
            if (kanbanAddrRaw) {
                finalData.push(createFinalRow(kanbanAddrRaw, pic, shop, false));
            }
            
            // บรรทัดที่สอง (Lineside Addr) 
            // - ถ้า shouldDup เป็น true (เช่น PC, ALS, W, T, K) และมีข้อมูล Lineside ก็จะสร้าง
            // - picType ของบรรทัดนี้ จะถูกระบุมาจากตัวแปร linesidePic (ซึ่งตั้งเป็น A ไว้ให้แล้วสำหรับ PC/ALS)
            if (shouldDup && linesideAddrRaw) {
                finalData.push(createFinalRow(linesideAddrRaw, linesidePic, shop, true));
            }
        });

        res.json({ success: true, data: finalData, hold: holdData, remind: remindData });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Process Failed' });
    }
});

module.exports = router;