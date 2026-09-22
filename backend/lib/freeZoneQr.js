// Decodes the fixed-width QR string scanned in a Free Zone. This layout is
// shared by every "Kanban tag" order type — Normal, Emergency, and
// Sequential all use the exact same byte offsets, they just differ in what
// ends up in each field (e.g. Order No. can contain letters for Emergency/
// Sequential, MROS Lane reads as the literal "0-" when not applicable).
// Import Part and Special Order are a DIFFERENT, much shorter format (just
// a bare Part No., no order/qty/box/date encoded at all) — see
// decodeImportOrSpecialPart below, not handled by this function.
//
// Field layout (1-indexed character positions, as given — converted to
// 0-indexed slices below), confirmed against real samples of all three
// order types:
//   1        Plant (always "S" = Samrong)
//   2-3      Dock
//   4-15     Order No. (12 chars — CAN contain letters, e.g. an "E1"
//            emergency suffix or a sequential order's own lettering;
//            space-padded on the right when shorter, never assume digits-only)
//   16-27    Part No. (12 chars)
//   28-36    Box Seq / Total Boxes ("0001/0002" — 9 chars, "/" included)
//   37-43    Qty per box (7 digits)
//   44-47    Supplier
//   48       S.Plant
//   49-50    S.Dock
//   51       (blank separator)
//   52-66    Arrival Date & Time (15 chars — "DD/MM/YYYY" + "HH:MM" back to back, no separator)
//   67-68    MROS No. (Lane) — 2 chars; literally "0-" when not applicable, not just absent
//   69-72    KBN
//   73       Conveyance
//   74-83    Address
//
// Total fixed length: 83 characters exactly, confirmed against all three
// order-type samples (Normal, Emergency, Sequential all measured 83 chars).

const FIELD_RANGES = {
  plant: [0, 1],
  dock: [1, 3],
  orderNumber: [3, 15],
  partNo: [15, 27],
  boxSeqTotal: [27, 36], // "0001/0002" — split further below
  qty: [36, 43],
  supplier: [43, 47],
  sPlant: [47, 48],
  sDock: [48, 50],
  // [50, 51] — blank separator, not captured as a field
  arrivalDateTime: [51, 66], // "DD/MM/YYYY" + "HH:MM", 15 chars, no internal separator
  laneNo: [66, 68], // literally "0-" when not applicable — never assume 2 digits
  kbn: [68, 72],
  conveyance: [72, 73],
  address: [73, 83],
};

const FIXED_LENGTH = 83;

function decodeLocalFreeZoneQr(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Not a string' };
  if (raw.length < FIXED_LENGTH) {
    return { ok: false, error: `Too short for the Kanban tag layout (${raw.length} chars, need ${FIXED_LENGTH})`, raw };
  }

  try {
    const take = ([start, end]) => raw.slice(start, end);

    const plant = take(FIELD_RANGES.plant);
    const dock = take(FIELD_RANGES.dock);
    const orderNumber = take(FIELD_RANGES.orderNumber).trim();
    const partNo = take(FIELD_RANGES.partNo).trim();

    const boxSeqTotal = take(FIELD_RANGES.boxSeqTotal); // "0001/0002"
    const slashIndex = boxSeqTotal.indexOf('/');
    if (slashIndex === -1) throw new Error(`Expected "/" inside Box Seq/Total Boxes ("${boxSeqTotal}")`);
    const boxSeq = parseInt(boxSeqTotal.slice(0, slashIndex), 10);
    const totalBoxes = parseInt(boxSeqTotal.slice(slashIndex + 1), 10);

    const qty = parseInt(take(FIELD_RANGES.qty), 10);
    const supplier = take(FIELD_RANGES.supplier).trim();
    const sPlant = take(FIELD_RANGES.sPlant).trim();
    const sDock = take(FIELD_RANGES.sDock).trim();

    const arrivalDateTime = take(FIELD_RANGES.arrivalDateTime); // "DD/MM/YYYY" + "HH:MM"
    const arrivalDate = arrivalDateTime.slice(0, 10);
    const arrivalTime = arrivalDateTime.slice(10);

    const laneNo = take(FIELD_RANGES.laneNo); // NOT trimmed — "0-" is a real, meaningful value here
    const kbn = take(FIELD_RANGES.kbn).trim();
    const conveyance = take(FIELD_RANGES.conveyance).trim();
    const address = take(FIELD_RANGES.address).trim();

    if (!partNo) throw new Error('Part No. is blank');

    return {
      ok: true,
      raw,
      plant,
      dock,
      orderNumber,
      partNo,
      boxSeq: Number.isNaN(boxSeq) ? null : boxSeq,
      totalBoxes: Number.isNaN(totalBoxes) ? null : totalBoxes,
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

// Import Part and Special Order tags are a completely different, much
// shorter format — just a bare Part No., nothing else encoded (no order,
// no box/qty, no date). Confirmed by the business owner:
//   Import Part:    exactly 12 digits, e.g. "166043501000"
//   Special Order:  12 digits + 1 trailing letter that carries no meaning
//                    and is simply discarded, e.g. "53293KK17000P" is NOT
//                    12 digits + letter — this example is 12 CHARACTERS
//                    (digits and letters mixed) + a trailing "P" to drop,
//                    so the rule is "12 characters, then optionally one
//                    more character to ignore" rather than "12 DIGITS".
// Since neither carries a quantity, handleSubmitFreeZoneQr looks the Qty/
// Pack up from that batch's Part Procurement data (QTY_CONT / PACK_QTY_CONT)
// by Part No. instead — see the design discussion for why that lookup
// lives server-side rather than on the device.
function decodeBarePartNo(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Not a string' };
  const trimmed = raw.trim();

  if (trimmed.length === 12) {
    return { ok: true, raw, partNo: trimmed, orderType: 'import' };
  }
  if (trimmed.length === 13) {
    return { ok: true, raw, partNo: trimmed.slice(0, 12), orderType: 'special' };
  }
  return { ok: false, error: `Not a recognized bare Part No. length (${trimmed.length} chars, need 12 or 13)`, raw };
}

module.exports = { decodeLocalFreeZoneQr, decodeBarePartNo, FIELD_RANGES, FIXED_LENGTH };