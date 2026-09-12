// Decodes the fixed-width QR string scanned in a Free Zone (LOCAL parts
// only — IMPORT uses a different layout that hasn't been specified yet,
// see the Free Zone / NQC Master design discussion). Every field's exact
// character width was verified against a real sample:
//
//   SS12026090301 335040K270C00001/00020000028DAIWGD3 03/09/202609:4011A610ASD - R03
//
// which decodes to Plant=S, Dock=S1, Order=2026090301, PartNo=335040K270C0,
// BoxSeq/Total=0001/0002 (this is box 1 of 2 for that order), Qty=28,
// Supplier=DAIW, S.plant=G, S.dock=D3, ArrivalDate=03/09/2026,
// ArrivalTime=09:40, LaneNo=11, Kbn=A610, Conveyance=A, Address="SD - R03".
//
// Layout (fixed widths, two single-space separators at fixed points):
//   plant(1) dock(2) orderNumber(10) " " partNo(12) boxSeq(4) "/" totalBoxes(4)
//   qty(7) supplier(4) sPlant(1) sDock(2) " " arrivalDate(10) arrivalTime(5)
//   laneNo(2) kbn(4) conveyance(1) address(rest)

const FIELD_WIDTHS = {
  plant: 1,
  dock: 2,
  orderNumber: 10,
  // — space —
  partNo: 12,
  boxSeq: 4,
  // — "/" —
  totalBoxes: 4,
  qty: 7,
  supplier: 4,
  sPlant: 1,
  sDock: 2,
  // — space —
  arrivalDate: 10,
  arrivalTime: 5,
  laneNo: 2,
  kbn: 4,
  conveyance: 1,
  // address takes whatever's left
};

// Total fixed-width length before the free-form address tail, including
// the two literal separator characters (spaces) but not the "/" inside
// boxSeq/totalBoxes (that's consumed explicitly below).
function decodeLocalFreeZoneQr(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Not a string' };
  const s = raw; // deliberately not trimmed — leading/trailing content would shift every fixed-width offset

  let pos = 0;
  const take = (n) => { const v = s.slice(pos, pos + n); pos += n; return v; };
  const expect = (ch, label) => {
    const got = s[pos];
    if (got !== ch) throw new Error(`Expected "${ch}" (${label}) at position ${pos}, got "${got || ''}"`);
    pos += 1;
  };

  try {
    const plant = take(FIELD_WIDTHS.plant);
    const dock = take(FIELD_WIDTHS.dock);
    const orderNumber = take(FIELD_WIDTHS.orderNumber);
    expect(' ', 'separator after order number');
    const partNo = take(FIELD_WIDTHS.partNo);
    const boxSeq = take(FIELD_WIDTHS.boxSeq);
    expect('/', 'separator inside box sequence');
    const totalBoxes = take(FIELD_WIDTHS.totalBoxes);
    const qtyRaw = take(FIELD_WIDTHS.qty);
    const supplier = take(FIELD_WIDTHS.supplier);
    const sPlant = take(FIELD_WIDTHS.sPlant);
    const sDock = take(FIELD_WIDTHS.sDock);
    expect(' ', 'separator after s.dock');
    const arrivalDate = take(FIELD_WIDTHS.arrivalDate);
    const arrivalTime = take(FIELD_WIDTHS.arrivalTime);
    const laneNo = take(FIELD_WIDTHS.laneNo);
    const kbn = take(FIELD_WIDTHS.kbn);
    const conveyance = take(FIELD_WIDTHS.conveyance);
    const address = s.slice(pos); // everything left, e.g. "SD - R03"

    if (!address) throw new Error('Nothing left for address — string too short for this layout');

    const qty = parseInt(qtyRaw, 10);
    const boxSeqNum = parseInt(boxSeq, 10);
    const totalBoxesNum = parseInt(totalBoxes, 10);

    return {
      ok: true,
      raw,
      plant,
      dock,
      orderNumber,
      partNo,
      boxSeq: Number.isNaN(boxSeqNum) ? null : boxSeqNum,
      totalBoxes: Number.isNaN(totalBoxesNum) ? null : totalBoxesNum,
      qty: Number.isNaN(qty) ? null : qty,
      supplier,
      sPlant,
      sDock,
      arrivalDate,
      arrivalTime,
      laneNo,
      kbn,
      conveyance,
      address,
    };
  } catch (err) {
    return { ok: false, error: err.message, raw };
  }
}

module.exports = { decodeLocalFreeZoneQr, FIELD_WIDTHS };
