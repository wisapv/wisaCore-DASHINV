# Zone Assignment & Address Matching — Business Rules Reference

สรุปเงื่อนไข/business rule ทั้งหมดที่แก้ไปในรอบนี้ (Zone Assignment Rules backlog + จุดที่เกี่ยวข้อง) เขียนไว้ละเอียดสำหรับเผื่อกลับมาแก้ทีหลัง หรือให้คนอื่นมา improve ต่อ

ทุกจุดผ่านการทดสอบจริง (ไม่ใช่แค่ syntax check) ด้วยข้อมูลจริงหรือจำลองใกล้เคียงข้อมูลจริงแล้วทั้งหมด — ดูตัวอย่าง test case แนบท้ายแต่ละหัวข้อ

---

## 1. Target R/O — Clean step (`cleanTargetRow`)

**ไฟล์:** `backend/lib/partMatching.js`

มี 2 mode: `'main'` (ใช้โดย TBOS Main Format / SAP output) และ `'handheld'` (ใช้โดย Handheld assign flow)

| เงื่อนไข | mode `'main'` | mode `'handheld'` |
|---|---|---|
| Part No ว่าง หรือ = "N/A" | ❌ Invalid (drop) | ❌ Invalid (drop) |
| `Dock IH routing = Supplier` | ❌ Invalid (drop) | ❌ Invalid (drop) **← เพิ่งแก้ ก่อนหน้านี้ handheld เก็บไว้** |
| `Supplier = TTAT` | ❌ Invalid (drop) | ✅ **เก็บไว้** (spec บอกชัดว่า "ครั้งนี้เราไม่ลบ TTAT") |

**ที่มา:** spec ต้นฉบับของสาย Handheld (คนละ process กับ TBOS Main Format โดยเจตนา) เขียนไว้ว่า:
> "if Dock IH routing = Supplier delete (ครั้งนี้เราไม่ลบ TTAT)"

**เคสที่ยืนยันด้วยข้อมูลจริง:** Part `52110-0K410-A3` (Dock IH routing = Supplier = `AAS1S`/`AAS1U`) — แม้จะมีที่อยู่จริงในโกดัง (พบผ่าน Part Procurement's Production Routing) ก็ยัง drop ตาม spec เพราะ spec ไม่มีข้อยกเว้น

**ผลกระทบ:** part ที่ Dock=Supplier จะไม่ถูกนับทางกายภาพผ่าน Handheld อีกต่อไป ต้อง re-assign handheld ใหม่ทุก batch ที่ assign ไปแล้วก่อนหน้านี้ถึงจะมีผล

**⚠️ ข้อควรระวัง:** ฟังก์ชัน `findNewPartsSinceBatch` (ใช้เช็ค "New Parts" เทียบ baseline) **ห้ามผูกกับ `cleanTargetRow(mode:'handheld')`** อีก เพราะจะโดนกฎ Dock=Supplier ไปด้วยโดยไม่ตั้งใจ (New Parts เป็นฟีเจอร์คนละเรื่อง ควรเห็น part ใหม่ทุกตัวแม้จะเป็น Dock=Supplier) — ตอนนี้แยกเป็น validity check ของตัวเอง (เช็คแค่ part no ว่าง/N-A) แล้ว

---

## 2. Part Procurement — Clean step (`buildPpIndex`)

**ไฟล์:** `backend/lib/partMatching.js`

1. Sort by `T/C TO (UNL)` เป็นวันที่ → เลือกเฉพาะแถวที่วันหมดอายุอยู่**หลัง**วันนี้ (`rowDate > today`)
2. **`Dock Comb.`** = `Production Routing` ถ้ามีค่า (ไม่ว่าง) **ไม่งั้นใช้ `DOCK`** ← นี่คือกลไกสำคัญที่ทำให้ routing-code (เช่น `AAS1S`) เชื่อมกับ Dock จริงทางกายภาพ (เช่น `S1`) ได้
3. `Key matching PP` = `Dock Comb. + Part No` (ลบ space/ตัด `-`)
4. `Suffix No` = 2 ตัวท้ายของ `PART #`
5. Drop `PART DESC = 'WHEEL ASSY'`

**เคสที่ยืนยันด้วยข้อมูลจริง:** Part `52110-0K410-A3` — Part Procurement มี `DOCK=S1` แต่ `Production Routing=AAS1S` → matching key ที่แท้จริงคือ `AAS1S` ไม่ใช่ `S1` เพราะ Production Routing มีค่า

---

## 3. PIC/Zone Assignment — `evaluatePicAndShop` (Assign Handheld / Fix Zone)

**ไฟล์:** `backend/handheld_part_list/assignAddrRoute.js`

เดิม Dock=SW/S9 ทั้งหมดถูกยัดเป็น PIC=`'W'` ตัวเดียว (ไม่แยกย่อย) ตอนนี้แยกเป็น 4 กลุ่ม:

### 3.1 P-exception (Dock=SW/S9 + Supplier=AAP1/AAS1)
```
PIC = 'P', Shop = 'W', Zone = 'P_SEQ', → INV12
shouldDup = true  ← เพิ่งแก้ (เดิม false)
```
**dup เป็น 2 บรรทัดเหมือนกลุ่ม W ปกติ:** บรรทัด Kanban Print Address และบรรทัด Lineside Address — **ทั้ง 2 บรรทัดเป็น PIC='P' เหมือนกัน** (ไม่มีแยกย่อยแบบ W_PC/W_SEQ/W_LINE เพราะ spec กำหนด Zone เดียวคือ P_SEQ)

**เคสจริงที่ยืนยัน:** Part `55111KK22000` — Kanban=`P    -  SR`, Lineside=`EC2RS- 01.` → ได้ 2 บรรทัด ทั้งคู่ PIC=P

### 3.2 W group ปกติ (Dock=SW/S9, Supplier อื่น)
แยกตาม**บรรทัดที่กำลังสร้าง** (ไม่ใช่แยกจาก evaluatePicAndShop โดยตรง เพราะฟังก์ชันนั้นไม่รู้บริบทว่ากำลังสร้างบรรทัด kanban หรือ lineside — การแยกเกิดใน `buildPartRows`):

| บรรทัด | เงื่อนไข | PIC | → INV |
|---|---|---|---|
| Kanban Print Address | เสมอ (ถ้ามีค่า) | `W_PC` | INV7 |
| Lineside Address | มีค่า + shouldDup=true | เช็ค **digit ที่ 5** (index 4, หลังตัด space) ของ Lineside Address | — |
| ..."S" | | `W_SEQ` | INV8 |
| ...อื่นๆ | | `W_LINE` | INV9 |
| Lineside Address ว่าง | — | **ไม่สร้างบรรทัดที่ 2** (เหลือแค่ W_PC บรรทัดเดียว) | — |

**ฟังก์ชัน:** `resolveWSubZone(linesideAddrRaw)`
```js
const clean = linesideAddrRaw.replace(/\s/g, '');
return clean[4] === 'S' ? 'W_SEQ' : 'W_LINE';
```

**ตัวอย่างที่ยืนยันจากข้อมูลจริง 5 ตัวอย่าง (ตัด space ก่อนนับ):**
| Address | ตัวที่ 5 | ผล |
|---|---|---|
| EC2RI-10. | I | W_LINE |
| **EC2RS-01.** | **S** | **W_SEQ** |
| FF2LI-02. | I | W_LINE |
| SF2RC-02. | C | W_LINE |
| SF2LI-06. | I | W_LINE |

**เคส blank lineside ที่ยืนยัน:** Dock=SW ไม่มี Lineside Address → เหลือ 1 บรรทัด (W_PC เท่านั้น) — **ยืนยันแล้วว่าถูกต้องตามที่ต้องการ** ไม่ต้อง duplicate จาก kanban ซ้ำ

### 3.3 PIC อื่นๆ ที่ไม่เกี่ยวกับ W (ไม่ได้แก้ในรอบนี้ แต่แสดงไว้เพื่อครบภาพ)
`T`(dock ST) / `K`(dock SK) / `R`(addr ขึ้นต้น R.) / `ALS` / `PC` / `S4` / `S5` / `TTAT` / else=`A`

---

## 4. PIC → INV bucket mapping

**ไฟล์:** `backend/processStock/processStockRoute.js` — `PIC_TO_INV`

```js
const PIC_TO_INV = {
  A: [5], T: [11], K: [10], S4: [3], TTAT: [3], R: [6], PC: [2], S5: [3], ALS: [4],
  W_PC: [7], W_SEQ: [8], W_LINE: [9], P: [12],
};
```

**หมายเหตุสำคัญ:** เดิม PIC='W' ใช้ hack duplicate ค่าเดียวกันใส่ทั้ง INV7/8/9 (บวกกันจะเกิน 3 เท่าของจริง) — **hack นี้ถูกลบไปแล้ว** เพราะตอนนี้ PIC แยกจริงตั้งแต่ต้นทาง (ข้อ 3) ทุก PIC จึงแมพ 1-ต่อ-1 กับ INV bucket ปกติเหมือนตัวอื่นๆ

**Schema:** `process_stock_results.inv_result_12` เป็นคอลัมน์ใหม่ (additive migration ใน `database.js`) — `ltbo_master_rows` มี `inv_result_1` ถึง `13` เตรียมไว้แล้วตั้งแต่ต้น (ยังไม่มีกฎสำหรับ 13)

---

## 5. Address fallback chain — ลำดับการหา address ให้ part (`handleProcessAssignAddr`)

**ไฟล์:** `backend/handheld_part_list/assignAddrRoute.js`

เมื่อ part หนึ่งไม่มี address ตรงในไฟล์ Address Master (Dock+PartNo ไม่ตรงกับแถวไหนเลย) ระบบจะลองหาทดแทนตามลำดับนี้ **หยุดที่ชั้นแรกที่เจอ**:

| ลำดับ | ชื่อ | เงื่อนไข donor | ขอบเขตการค้นหา |
|---|---|---|---|
| 1 | Direct match | Dock+PartNo ตรงเป๊ะ | `addrMap` (ทุกแถว Address Master ที่ยัง valid วันที่) |
| 2 | Name-based fallback (`resolvedByName`) | donor ต้อง match TG+PP สำเร็จใน batch นี้ | เฉพาะ part ที่ **Part Name (PART DESC) เดียวกัน** และ **direct-match ได้เอง** |
| 3 | Prefix-based fallback (`resolvedByPartPrefix`) | donor ต้อง match TG+PP สำเร็จใน batch นี้ | เฉพาะ part ที่ **5 ตัวอักษรแรกของ Part No เหมือนกัน** และ **direct-match ได้เอง** |
| 4 | **Raw Address Master fallback (`addrByPartPrefix`)** ← ใหม่ | **ไม่ต้อง match TG/PP เลย** แค่ต้องมี**แถวใน Address Master ที่ยัง valid วันที่** ("ยังมีชีวิต") | ทุกแถว Address Master ที่ **5 ตัวอักษรแรกของ Part No เหมือนกัน** ไม่สนว่าเจ้าของ part นั้นจะมี Target R/O ใน batch นี้หรือไม่ |
| — | เหลือไม่เจอเลย | — | → **Hold** ("Missing in Address Master") |

**กฎร่วมของทุกชั้น fallback (2/3/4):** ยืมมาแค่ **address แรกที่เจอเท่านั้น** ไม่ยืมมาทั้งหมด (เดิมชั้น 2/3 เคย `.push(...)` สะสมทุก address จากทุก donor ที่ match ได้ ทำให้ part เดียว dup ออกมาหลายบรรทัดผิดๆ — แก้แล้วให้เก็บแค่ `[donor[0]]` และ `set` ครั้งเดียว ไม่ overwrite)

**เคสจริงที่ยืนยัน ชั้น 2/3 (dedup):** Part A (direct match, 3 address), Part B (direct match, 1 address, ชื่อ/prefix เดียวกับ A), Part C (ไม่มี address เลย) → Part C ได้แค่ **1** address (ตัวแรกที่เจอ) ไม่ใช่ 4 แถวรวมกัน

**เคสจริงที่ยืนยัน ชั้น 4:** Part `58311KK03000` มี Target R/O + Part Procurement ครบ แต่ไม่มี address ตรงของตัวเอง ส่วน Part `58311KK01000` (prefix `58311` เหมือนกัน) มี address จริงใน Address Master แต่**ไม่มี Target R/O ใน batch นี้เลย** — เดิมจะติด Hold เพราะชั้น 2/3 มองไม่เห็น donor ที่ไม่ผ่าน TG/PP; ตอนนี้ชั้น 4 ดึงตรงจาก Address Master ให้แทน → หลุดจาก Hold

**เคสจริงที่ยืนยัน — expired ไม่ยืม:** Address Master row ที่ `T/C TO (UNL)` ผ่านมาแล้ว (ไม่ valid วันที่) → ชั้น 4 **ไม่ยืมให้** ยังติด Hold เหมือนเดิม (ถูกต้อง)

---

## 6. Assign Handheld UI — bundling W_PC/W_SEQ/W_LINE/P (frontend เท่านั้น)

**ไฟล์:** `frontend/src/pages/AssignHandheld.jsx`

เพราะข้อ 3 ทำให้ PIC ของกลุ่ม W แตกเป็น 4 ค่า → รายการ "Unassigned" ในหน้า Assign Handheld มี tile ย่อยเยอะเกินไป (แยกตาม ShortAddr ด้วย) จึงเพิ่ม layer "bundling" ที่ **frontend อย่างเดียว**:

- `realGroups` = ข้อมูลจริงแบบเดิม (per-ShortAddr) — ผูกกับ `assignments` state จริงเสมอ
- `displayGroups` = รวบ 4 PIC นี้เป็น 1 tile ต่อ PIC **เฉพาะตอนสถานะเดียวกันหมด** (unassigned ทั้งหมด หรือ assign device เดียวกันหมด) — ถ้ากระจายคนละ device จะ fallback โชว์แยกจริง กันข้อมูลเพี้ยน
- กด assign/ลาก tile ที่ถูกรวบ → fan-out เขียนกลับเป็น real id ทั้งหมดเสมอ (ไม่เคยเขียนด้วย fake id)
- **`sendToHandheld` (payload ที่ยิงไป backend จริง) ใช้ `realGroups` เท่านั้น ไม่ใช้ `displayGroups`** — กันไม่ให้ shortAddr ปลอม (ชื่อ PIC) หลุดไปที่ backend

**ไม่กระทบ schema/backend เลย** — `handheld_assignments` ยัง granular แบบเดิมทุกประการ

---

## 7. Android Handheld app — ไม่ต้องแก้อะไรเลยจากงานนี้

เช็คซอร์สจริงแล้ว (`wisaCore-HANDHELD` repo) — `pic` เป็นแค่ string pass-through ทุกจุด (แสดงผล/ส่ง query param) ไม่มี hardcode เทียบ `"W"` เลยสักที่ พอ backend ส่ง `W_PC`/`W_SEQ`/`W_LINE`/`P` มาแทน `"W"` แอปทำงานถูกทันทีโดยไม่ต้อง build ใหม่

---

## ไฟล์ที่แก้ทั้งหมดในรอบนี้ (เรียงตามลำดับ)

| ไฟล์ | เกี่ยวข้องกับข้อ |
|---|---|
| `backend/handheld_part_list/assignAddrRoute.js` | 1, 3, 5, 6(ไม่เกี่ยว-ฝั่ง frontend) |
| `backend/processStock/processStockRoute.js` | 4 |
| `backend/database.js` | 4 (migration inv_result_12) |
| `backend/handheld_part_list/deviceAssignmentRoute.js` | 3 (zone label, ลบ mock) |
| `backend/lib/partMatching.js` | 1 |
| `backend/lib/partMatching.test.js` | 1 (test) |
| `backend/part_list/mainFormatRoute.test.js` | 1 (test) |
| `frontend/src/pages/Summary.jsx` | 4 (โชว์ Inv1-12) |
| `frontend/src/pages/AssignHandheld.jsx` | 6 |

## บั๊กที่ยังไม่ได้แก้ (นอก scope รอบนี้)
- **QR format IMPORT** — ยังไม่มี ทั้ง backend (`freeZoneQr.js`) และแอป (`KbnQr.kt`) รองรับแค่ LOCAL
- **Android FreeZoneScreen.kt** — ยังเป็น demo/fake scan ทั้งหมด ไม่ได้เชื่อม endpoint `/submit-free-zone-qr` ใหม่ (ยอด Free Zone ที่สแกนจาก build ปัจจุบันไม่เข้า Process Stock เลย)
- **Stock in Transit (SYSTEM/Adjust Qty)** — ยังปล่อยผ่านจาก master ตรงๆ ไม่รู้จะดึงจากไหน
- **GETSUDO summary format** — ยังไม่เคยกำหนด
- **`resolvedByPartPrefix` ไม่กรองด้วย dock** — ยืมข้าม dock ได้ถ้า prefix ตรงกัน (ไม่แน่ใจว่าตั้งใจหรือไม่ ยังไม่ได้ถาม)
