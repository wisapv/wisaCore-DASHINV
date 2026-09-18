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
// IMPORTANT — Part No. is NOT a fixed 12 characters. Real scans off a
// printed Kanban label showed the gap between Order Number and Part No.
// can be 1 OR 2 blank characters (some orders reserve a short suffix
// there, blank-padded when unused) — a strict fixed-offset read misreads
// this entirely, shifting Box Seq/Qty/Supplier/etc. by one character and
// rejecting an otherwise perfectly valid scan. Confirmed against 3 real
// samples (one verified against the physical printed label itself):
//
//   SS12026013006  126010E010000001/000500000061PITAI1 30/01/202607:3011A001IFN4  - R00
//   SS12026091601  445400KD60000001/00010000006ADVSIE1 16/09/202603:0002M164EIP1  - C01
//
// Every OTHER field here genuinely is fixed-width (confirmed against all
// samples above), so instead of assuming Part No.'s width, anchor on the
// "/" that always immediately follows Box Seq (Box Seq is always exactly
// 4 digits) and take everything between the order-number separator and
// those 4 digits as Part No., trimmed of whatever leftover padding lands
// in it, however long it actually is:
//
//   plant(1) dock(2) orderNumber(10) " " partNo(variable) boxSeq(4) "/" totalBoxes(4)
//   qty(7) supplier(4) sPlant(1) sDock(2) " " arrivalDate(10) arrivalTime(5)
//   laneNo(2) kbn(4) conveyance(1) address(rest)
//
// This assumes Part No. itself never contains a "/" (true of every real
// sample seen so far — alphanumeric only) and that the "/" found is the
// FIRST one in the string, which is always the Box Seq separator since
// Arrival Date's own "/" characters come much later positionally.

const FIELD_WIDTHS = {
  plant: 1,
  dock: 2,
  orderNumber: 10,
  // — space —
  // partNo: variable width, see decodeLocalFreeZoneQr
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

// Sanity bound on Part No.'s length — NOT meant to catch a subtle one-
// character-off scan (that's genuinely indistinguishable from a real Part
// No. one character longer/shorter, now that width varies), only to reject
// obviously-wrong input where the "/" search latched onto something that
// isn't really this field at all (e.g. garbage text, or a "/" appearing
// absurdly early/late).
const MIN_PART_NO_LENGTH = 4;
const MAX_PART_NO_LENGTH = 20;

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

    // Anchor on the first "/" from here — Box Seq is always the 4 digits
    // immediately before it, Part No. is everything before THAT (variable
    // length, see the file-level comment).
    const partNoStart = pos;
    const slashIndex = s.indexOf('/', pos);
    if (slashIndex === -1) throw new Error('No "/" found for the Box Seq / Total Boxes separator');
    if (slashIndex - partNoStart < FIELD_WIDTHS.boxSeq) {
      throw new Error('Not enough characters before "/" to hold Box Seq');
    }
    const partNo = s.slice(partNoStart, slashIndex - FIELD_WIDTHS.boxSeq).trim();
    if (partNo.length < MIN_PART_NO_LENGTH || partNo.length > MAX_PART_NO_LENGTH) {
      throw new Error(`Part No. length (${partNo.length}) outside expected range — likely not a real Kanban QR`);
    }
    const boxSeq = s.slice(slashIndex - FIELD_WIDTHS.boxSeq, slashIndex);
    pos = slashIndex;
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