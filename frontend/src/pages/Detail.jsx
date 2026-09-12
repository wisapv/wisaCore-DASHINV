import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, Loader2, Pencil, X } from 'lucide-react';
import Sparkle from '../components/Sparkle';
import { API_BASE } from '../hooks/useActiveBatch';

// Same storage key AssignHandheld.jsx / Overview.jsx use.
const SELECTED_BATCH_STORAGE_KEY = 'wisa:assignHandheld:selectedBatchId';
function readStoredBatchId() {
  try { return localStorage.getItem(SELECTED_BATCH_STORAGE_KEY) || ''; } catch { return ''; }
}

const statusStyle = (status) => {
  if (status === 'Done') return { bg: 'bg-accent', text: 'text-ink', border: 'border-l-accent' };
  if (status === 'Not Found') return { bg: 'bg-red-100', text: 'text-red-600', border: 'border-l-red-400' };
  return { bg: 'bg-ink/[0.06]', text: 'text-[#B5B2A8]', border: 'border-l-ink/[0.15]' };
};

const ROWS_LIMIT = 150;

const Detail = ({ currentBatchId, subscribeToEvent, onGoToSummary }) => {
  const [selectedBatchId, setSelectedBatchId] = useState(() => readStoredBatchId() || currentBatchId || '');
  // Adjusting state when a prop changes — done during render (not in an
  // effect) per React's own guidance, so it doesn't cause an extra
  // cascading re-render. currentBatchId can arrive after this component's
  // first render (it comes from an async fetch higher up), so this can't
  // just be the useState initializer above.
  const [lastSeenBatchId, setLastSeenBatchId] = useState(currentBatchId);
  if (currentBatchId !== lastSeenBatchId) {
    setLastSeenBatchId(currentBatchId);
    if (!readStoredBatchId() && currentBatchId) setSelectedBatchId(currentBatchId);
  }

  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const hasLoadedOnceRef = useRef(false);
  const loadRequestIdRef = useRef(0);

  // Fix vs Free — two completely different data shapes (Fix is per-address
  // part-list rows; Free is per-scanned-box QR data with no address
  // matching), so they're separate views rather than one merged table.
  const [view, setView] = useState('Fix');
  const [freeRows, setFreeRows] = useState([]);
  const [isFreeLoading, setIsFreeLoading] = useState(true);
  const [freeLoadError, setFreeLoadError] = useState('');
  const hasFreeLoadedOnceRef = useRef(false);
  const freeLoadRequestIdRef = useRef(0);

  const loadFree = () => {
    if (!selectedBatchId) { setFreeRows([]); setIsFreeLoading(false); return; }
    if (!hasFreeLoadedOnceRef.current) setIsFreeLoading(true);
    setFreeLoadError('');
    const requestId = ++freeLoadRequestIdRef.current;
    fetch(`${API_BASE}/api/handheld-assign/free-zone-detail?batchId=${encodeURIComponent(selectedBatchId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((result) => { if (freeLoadRequestIdRef.current === requestId) setFreeRows(result.data || []); })
      .catch(() => { if (freeLoadRequestIdRef.current === requestId) setFreeLoadError('Could not load Free Zone data for this batch.'); })
      .finally(() => {
        if (freeLoadRequestIdRef.current === requestId) { setIsFreeLoading(false); hasFreeLoadedOnceRef.current = true; }
      });
  };
  useEffect(() => { hasFreeLoadedOnceRef.current = false; }, [selectedBatchId]);
  useEffect(() => { if (view === 'Free') loadFree(); }, [selectedBatchId, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!subscribeToEvent) return undefined;
    return subscribeToEvent('handheld:updated', (payload) => {
      if (view === 'Free' && (!payload || !payload.batchId || payload.batchId === selectedBatchId)) loadFree();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeToEvent, selectedBatchId, view]);

  // Per-zone "mark done" — Free zone has no total to compare counted
  // against (see /monitor's own comment), so completion is a manual call.
  // This also gates the "Go to Summary" check below — without it there'd
  // be no way to ever mark a Free zone complete since Check Stock (which
  // used to own this control) was removed.
  const [zoneDoneMap, setZoneDoneMap] = useState({}); // zoneId -> boolean
  const [togglingZoneId, setTogglingZoneId] = useState(null);
  const loadZoneDone = () => {
    if (!selectedBatchId) { setZoneDoneMap({}); return; }
    fetch(`${API_BASE}/api/handheld-assign/monitor?batchId=${encodeURIComponent(selectedBatchId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        const map = {};
        (result?.free || []).forEach((z) => { map[z.zoneId] = z.markedDone; });
        setZoneDoneMap(map);
      })
      .catch(() => {});
  };
  useEffect(() => { if (view === 'Free') loadZoneDone(); }, [selectedBatchId, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleZoneDone = async (zoneCode) => {
    if (!selectedBatchId) return;
    setTogglingZoneId(zoneCode);
    try {
      const res = await fetch(`${API_BASE}/api/handheld-assign/free-zone-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: selectedBatchId, zoneId: zoneCode, markedDone: !zoneDoneMap[zoneCode] }),
      });
      if (res.ok) setZoneDoneMap((prev) => ({ ...prev, [zoneCode]: !prev[zoneCode] }));
    } catch {
      // best-effort — a failed toggle just leaves the button as it was
    } finally {
      setTogglingZoneId(null);
    }
  };

  // Edit modal — Box/Pcs/Seq/Order only (Qty and Status aren't editable here;
  // saving re-sends the row's existing Qty unchanged so submit-count's
  // upsert doesn't wipe it — see the save handler below).
  const [editingRow, setEditingRow] = useState(null);
  const [editForm, setEditForm] = useState({ box: '', pcs: '', seq: '', order: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const openEdit = (row) => {
    setEditingRow(row);
    setEditForm({ box: row.box || '', pcs: row.pcs || '', seq: row.seq || '', order: row.order || '' });
    setSaveError('');
  };
  const closeEdit = () => setEditingRow(null);

  const saveEdit = async () => {
    if (!editingRow) return;
    setIsSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${API_BASE}/api/handheld-assign/submit-count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: selectedBatchId,
          pic: editingRow.pic,
          shortAddr: editingRow.shortAddr,
          addr: editingRow.address,
          kbn: editingRow.kbn,
          shop: editingRow.shop,
          dock: editingRow.dock,
          partNo: editingRow.partNo,
          partName: editingRow.partName,
          qty: editingRow.qty, // unchanged — this modal only edits box/pcs/seq/order
          box: editForm.box,
          pcs: editForm.pcs,
          seq: editForm.seq,
          order: editForm.order,
          notFound: editingRow.status === 'Not Found',
          employeeName: 'Web Edit',
        }),
      });
      if (!res.ok) { setSaveError('Save failed. Try again.'); return; }
      setRows((prev) => prev.map((r) => (
        r === editingRow ? { ...r, ...editForm, status: r.status === 'Pending' ? 'Done' : r.status } : r
      )));
      setEditingRow(null);
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setIsSaving(false);
    }
  };

  const [filterShop, setFilterShop] = useState('All');
  const [filterDock, setFilterDock] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  // Free Zone has its own filter set — Zone instead of Shop, and In List?
  // instead of Status — kept separate from the Fix ones above so switching
  // views doesn't reset filters you'd already set on the other one.
  // Free Zone's own filter/search state — Dock filter dropped per request
  // (Zone is specific enough on its own), and Zone options come from the
  // zone_definitions registry (see zoneList below) rather than only zones
  // that already have scan data, so the dropdown isn't empty just because
  // nobody's scanned into a zone yet.
  const [filterFreeZone, setFilterFreeZone] = useState('All');
  const [filterFreeInList, setFilterFreeInList] = useState('All');
  const [zoneList, setZoneList] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/api/zone-definitions`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => setZoneList(result ? result.data.filter((z) => z.status === 'active') : []))
      .catch(() => {});
  }, []);
  // Typed value updates instantly (so the input feels responsive), but only
  // "search" (committed on button click / Enter) drives the actual filter —
  // filtering on every keystroke against a large table was what felt laggy.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const runSearch = () => setSearch(searchInput);
  const clearSearch = () => { setSearchInput(''); setSearch(''); };

  const load = () => {
    if (!selectedBatchId) { setRows([]); setIsLoading(false); return; }
    if (!hasLoadedOnceRef.current) setIsLoading(true);
    setLoadError('');
    const requestId = ++loadRequestIdRef.current;
    fetch(`${API_BASE}/api/handheld-assign/detail?batchId=${encodeURIComponent(selectedBatchId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((result) => { if (loadRequestIdRef.current === requestId) setRows(result.data || []); })
      .catch(() => { if (loadRequestIdRef.current === requestId) setLoadError('Could not load detail for this batch.'); })
      .finally(() => {
        if (loadRequestIdRef.current === requestId) { setIsLoading(false); hasLoadedOnceRef.current = true; }
      });
  };

  useEffect(() => { hasLoadedOnceRef.current = false; }, [selectedBatchId]);
  useEffect(() => { load(); }, [selectedBatchId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!subscribeToEvent) return undefined;
    return subscribeToEvent('handheld:updated', (payload) => {
      if (!payload || !payload.batchId || payload.batchId === selectedBatchId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeToEvent, selectedBatchId]);

  const shopOptions = useMemo(() => [...new Set(rows.map((r) => r.shop).filter(Boolean))].sort(), [rows]);
  const dockOptions = useMemo(() => [...new Set(rows.map((r) => r.dock).filter(Boolean))].sort(), [rows]);
  const freeZoneOptions = useMemo(() => zoneList.map((z) => z.code).sort(), [zoneList]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterShop !== 'All' && r.shop !== filterShop) return false;
      if (filterDock !== 'All' && r.dock !== filterDock) return false;
      if (filterStatus !== 'All' && r.status !== filterStatus) return false;
      // KBN stays exact match, but Part No matches by PREFIX — typing the
      // first 5 digits of a Part No should show every part number that
      // starts with them, not just one exact one.
      if (term && r.kbn.toLowerCase() !== term && !r.partNo.toLowerCase().startsWith(term)) return false;
      return true;
    });
  }, [rows, filterShop, filterDock, filterStatus, search]);

  const visibleRows = filteredRows.slice(0, ROWS_LIMIT);
  const hiddenCount = filteredRows.length - visibleRows.length;

  const filteredFreeRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return freeRows.filter((r) => {
      if (filterFreeZone !== 'All' && r.zone !== filterFreeZone) return false;
      if (filterFreeInList !== 'All' && (filterFreeInList === 'In list') !== r.inBatchList) return false;
      if (term && r.kbn.toLowerCase() !== term && !r.partNo.toLowerCase().startsWith(term)) return false;
      return true;
    });
  }, [freeRows, filterFreeZone, filterFreeInList, search]);

  const visibleFreeRows = filteredFreeRows.slice(0, ROWS_LIMIT);
  const hiddenFreeCount = filteredFreeRows.length - visibleFreeRows.length;

  const selectClass = 'border border-ink/10 bg-[#FAFAF7] rounded-xl px-3 py-2.5 text-[11.5px] font-semibold text-ink outline-none appearance-none cursor-pointer';

  // "Go to Summary" — always checks completion first (see the hand-drawn
  // flow: check stock → sum). Fix zone % comes from /overview,
  // Free zone "done" comes from /monitor's per-zone markedDone (there's no
  // automatic way to know Free zone is done — see that endpoint's own
  // comment) — both fetched fresh on click rather than reusing whatever
  // Overview/Check-Stock last loaded, so the check reflects right now.
  const [isCheckingSummary, setIsCheckingSummary] = useState(false);
  const [summaryWarning, setSummaryWarning] = useState(null); // { percent, incompleteFreeZones }

  const goToSummary = async () => {
    if (!selectedBatchId) return;
    setIsCheckingSummary(true);
    try {
      const [overviewRes, monitorRes] = await Promise.all([
        fetch(`${API_BASE}/api/handheld-assign/overview?batchId=${encodeURIComponent(selectedBatchId)}`),
        fetch(`${API_BASE}/api/handheld-assign/monitor?batchId=${encodeURIComponent(selectedBatchId)}`),
      ]);
      const overview = overviewRes.ok ? await overviewRes.json() : null;
      const monitor = monitorRes.ok ? await monitorRes.json() : null;

      const percent = overview?.overallProgress?.percent ?? 0;
      const incompleteFreeZones = (monitor?.free || []).filter((z) => !z.markedDone).length;

      if (percent >= 100 && incompleteFreeZones === 0) {
        onGoToSummary && onGoToSummary();
      } else {
        setSummaryWarning({ percent, incompleteFreeZones });
      }
    } catch {
      // Couldn't check — safest is to warn rather than silently let an
      // unverified batch through.
      setSummaryWarning({ percent: null, incompleteFreeZones: null });
    } finally {
      setIsCheckingSummary(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full animate-in fade-in duration-500 pb-10">

      <div className="flex items-center gap-3.5 mb-1">
        <div className="flex flex-col">
          <span className="text-xs text-muted font-semibold tracking-wide">Piece Count Detail</span>
          <h1 className="font-display text-[34px] font-bold tracking-tight leading-none mt-0.5 text-ink">Stock Tracking Detail</h1>
        </div>
        <div className="w-[34px] h-[34px] bg-accent rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkle size={16} className="!bg-ink" delay=".2s" />
        </div>
        <select
          value={selectedBatchId}
          onChange={(e) => setSelectedBatchId(e.target.value)}
          className="ml-auto bg-white border border-ink/10 rounded-xl px-3 py-2 text-[11px] font-bold text-ink outline-none shadow-sm"
        >
          {!selectedBatchId && <option value="">Select a batch…</option>}
          {selectedBatchId && <option value={selectedBatchId}>{selectedBatchId}</option>}
        </select>
      </div>

      {selectedBatchId && (
        <div className="flex items-center gap-1 border-b border-ink/10 -mb-1">
          {['Fix', 'Free'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-2 px-4 py-3 font-bold text-sm transition-all border-b-2 ${
                view === v ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'
              }`}
            >
              {v} Zone
            </button>
          ))}
        </div>
      )}

      {!selectedBatchId ? (
        <div className="bg-white border-2 border-dashed border-ink/10 rounded-[28px] p-16 text-center text-[12px] text-muted font-semibold">
          Select a batch (or pick one on Assign Handheld / Overview) to see part-level detail.
        </div>
      ) : view === 'Free' ? (
        isFreeLoading ? (
          <div className="bg-white border border-ink/10 rounded-[28px] p-16 flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-muted" />
          </div>
        ) : freeLoadError ? (
          <div className="bg-white border border-red-100 rounded-[28px] p-16 text-center text-[12px] text-red-500 font-semibold">{freeLoadError}</div>
        ) : (
          <>
            {zoneList.length > 0 && (
              <div className="bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5">
                <p className="text-[13px] font-bold text-ink mb-3.5">Zone Completion</p>
                <div className="flex flex-wrap gap-2.5">
                  {zoneList.map((z) => {
                    const done = Boolean(zoneDoneMap[z.code]);
                    return (
                      <button
                        key={z.id}
                        onClick={() => toggleZoneDone(z.code)}
                        disabled={togglingZoneId === z.code}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-extrabold transition-colors ${
                          done ? 'bg-accent/20 text-ink' : 'bg-ink/[0.05] text-muted hover:text-ink'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${done ? 'bg-accent' : 'bg-ink/20'}`}></span>
                        {z.code}
                        {done ? ' · Done' : ' · Mark done'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-col lg:flex-row gap-5 items-stretch">
              <div className="flex-[2.2] min-w-[300px] bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 relative overflow-hidden">
                <div className="absolute top-3.5 right-4.5 pointer-events-none">
                  <Sparkle size={10} className="!opacity-60" delay=".5s" />
                </div>
                <p className="text-[13px] font-bold text-ink mb-3.5">Filters</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="relative w-full">
                    <select className={`w-full pr-8 ${selectClass}`} value={filterFreeZone} onChange={(e) => setFilterFreeZone(e.target.value)}>
                      <option value="All">All Zones</option>
                      {freeZoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                    <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
                  </div>
                  <div className="relative w-full">
                    <select className={`w-full pr-8 ${selectClass}`} value={filterFreeInList} onChange={(e) => setFilterFreeInList(e.target.value)}>
                      <option value="All">All (In List?)</option>
                      <option value="In list">In list</option>
                      <option value="Not in list">Not in list</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
                  </div>
                </div>
              </div>

              <div className="flex-[1.4] min-w-[260px] bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 flex flex-col justify-center">
                <p className="text-[13px] font-bold text-ink mb-3.5">Search Data</p>
                <div className="flex gap-2.5">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                    placeholder="Type KBN, Part No..."
                    className="flex-1 border border-ink/10 bg-[#FAFAF7] rounded-xl px-3.5 py-2.5 text-xs outline-none text-ink"
                  />
                  <button onClick={runSearch} className="bg-ink text-accent px-[22px] py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap hover:opacity-90 transition-opacity flex items-center gap-1.5">
                    <Search size={13} /> Search
                  </button>
                  <button onClick={clearSearch} title="Clear search" className="border border-ink/10 text-muted hover:text-ink px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1">
                    <X size={13} /> Clear
                  </button>
                </div>
              </div>
            </div>

          <div className="bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 overflow-hidden mt-1">
            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs whitespace-nowrap border-collapse">
                <thead>
                  <tr className="bg-ink">
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-accent">ZONE</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">DOCK</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">PART NO</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">PART NAME</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">KBN</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">QTY</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">ADDRESS</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">TOTAL BOX</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">IN LIST?</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFreeRows.length === 0 ? (
                    <tr><td colSpan={9} className="py-14 text-center text-muted font-semibold">No Free Zone scans yet</td></tr>
                  ) : (
                    visibleFreeRows.map((row, idx) => (
                      <tr key={idx} className={`border-t border-ink/5 border-l-4 ${row.inBatchList ? 'border-l-accent' : 'border-l-ink/[0.15]'}`}>
                        <td className="px-3.5 py-3.5 font-extrabold text-ink">{row.zone}</td>
                        <td className="px-3.5 py-3.5 font-bold text-ink">{row.dock}</td>
                        <td className="px-3.5 py-3.5 font-bold text-[#5C5A52]">{row.partNo}</td>
                        <td className="px-3.5 py-3.5 font-bold text-ink">{row.partName || '—'}</td>
                        <td className="px-3.5 py-3.5">
                          <span className="bg-accent text-ink font-extrabold px-2.5 py-0.5 rounded-lg text-[10.5px]">{row.kbn}</span>
                        </td>
                        <td className="px-3.5 py-3.5 font-bold text-ink">{row.qty ?? '—'}</td>
                        <td className="px-3.5 py-3.5 text-[#5C5A52] font-semibold">{row.address}</td>
                        <td className="px-3.5 py-3.5 font-bold text-ink">{row.totalBoxes ?? '—'}</td>
                        <td className="px-3.5 py-3.5">
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${row.inBatchList ? 'bg-accent text-ink' : 'bg-ink/[0.06] text-[#B5B2A8]'}`}>
                            {row.inBatchList ? 'In list' : 'Not in list'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {hiddenFreeCount > 0 && (
              <p className="text-[10px] text-muted font-semibold text-center py-3 border-t border-ink/5">
                โชว์ {visibleFreeRows.length} จาก {filteredFreeRows.length} แถว — ใช้ filter หรือ search ด้านบนเพื่อดูที่เหลือ
              </p>
            )}
          </div>
          </>
        )
      ) : isLoading ? (
        <div className="bg-white border border-ink/10 rounded-[28px] p-16 flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-muted" />
        </div>
      ) : loadError ? (
        <div className="bg-white border border-red-100 rounded-[28px] p-16 text-center text-[12px] text-red-500 font-semibold">{loadError}</div>
      ) : (
        <>
          <div className="flex flex-col lg:flex-row gap-5 items-stretch">
            <div className="flex-[2.2] min-w-[300px] bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 relative overflow-hidden">
              <div className="absolute top-3.5 right-4.5 pointer-events-none">
                <Sparkle size={10} className="!opacity-60" delay=".5s" />
              </div>
              <p className="text-[13px] font-bold text-ink mb-3.5">Filters</p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                <div className="relative w-full">
                  <select className={`w-full pr-8 ${selectClass}`} value={filterShop} onChange={(e) => setFilterShop(e.target.value)}>
                    <option value="All">All Shops</option>
                    {shopOptions.map((s) => <option key={s} value={s}>Shop {s}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
                </div>
                <div className="relative w-full">
                  <select className={`w-full pr-8 ${selectClass}`} value={filterDock} onChange={(e) => setFilterDock(e.target.value)}>
                    <option value="All">All Docks</option>
                    {dockOptions.map((d) => <option key={d} value={d}>Dock {d}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
                </div>
                <div className="relative w-full">
                  <select className={`w-full pr-8 ${selectClass}`} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="All">All Status</option>
                    <option value="Done">Done</option>
                    <option value="Not Found">Not Found</option>
                    <option value="Pending">Pending</option>
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
                </div>
              </div>
            </div>

            <div className="flex-[1.4] min-w-[260px] bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 flex flex-col justify-center">
              <p className="text-[13px] font-bold text-ink mb-3.5">Search Data</p>
              <div className="flex gap-2.5">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="Type KBN, Part No..."
                  className="flex-1 border border-ink/10 bg-[#FAFAF7] rounded-xl px-3.5 py-2.5 text-xs outline-none text-ink"
                />
                <button onClick={runSearch} className="bg-ink text-accent px-[22px] py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap hover:opacity-90 transition-opacity flex items-center gap-1.5">
                  <Search size={13} /> Search
                </button>
                <button onClick={clearSearch} title="Clear search" className="border border-ink/10 text-muted hover:text-ink px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1">
                  <X size={13} /> Clear
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 overflow-hidden mt-1">
            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs whitespace-nowrap border-collapse">
                <thead>
                  <tr className="bg-ink">
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-accent">SHOP</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">DOCK</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">PART NO</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">PART NAME</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">KBN</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">ADDRESS</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">QTY</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">BOX</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">PCS</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">SEQ</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">ORDER</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">SUM STOCK</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">STATUS</th>
                    <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">EDIT</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr><td colSpan={14} className="py-14 text-center text-muted font-semibold">No data</td></tr>
                  ) : (
                    visibleRows.map((row, idx) => {
                      const s = statusStyle(row.status);
                      return (
                        <tr key={idx} className={`border-t border-ink/5 border-l-4 ${s.border}`}>
                          <td className="px-3.5 py-3.5 font-extrabold text-ink">Shop {row.shop}</td>
                          <td className="px-3.5 py-3.5 font-bold text-ink">{row.dock}</td>
                          <td className="px-3.5 py-3.5 font-bold text-[#5C5A52]">{row.partNo}</td>
                          <td className="px-3.5 py-3.5 font-bold text-ink">{row.partName}</td>
                          <td className="px-3.5 py-3.5">
                            <span className="bg-accent text-ink font-extrabold px-2.5 py-0.5 rounded-lg text-[10.5px]">{row.kbn}</span>
                          </td>
                          <td className="px-3.5 py-3.5 text-[#5C5A52] font-semibold">{row.address}</td>
                          <td className="px-3.5 py-3.5 font-bold text-ink">{row.qty ?? '—'}</td>
                          <td className="px-3.5 py-3.5 font-bold text-ink">{row.box || '—'}</td>
                          <td className="px-3.5 py-3.5 font-bold text-ink">{row.pcs || '—'}</td>
                          <td className="px-3.5 py-3.5 text-[#5C5A52]">{row.seq || '—'}</td>
                          {/* Always N/A for now — no handheld input sends this yet, see the order_no migration comment in database.js */}
                          <td className="px-3.5 py-3.5 text-[#B5B2A8] text-[10.5px]">{row.order || 'N/A'}</td>
                          <td className="px-3.5 py-3.5 font-bold text-ink">{row.sumStock || 0}</td>
                          <td className="px-3.5 py-3.5">
                            <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${s.bg} ${s.text}`}>{row.status}</span>
                          </td>
                          <td className="px-3.5 py-3.5">
                            <button
                              onClick={() => openEdit(row)}
                              title="Edit Box/Pcs/Seq/Order"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-ink/5 transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {hiddenCount > 0 && (
              <p className="text-[10px] text-muted font-semibold text-center py-3 border-t border-ink/5">
                โชว์ {visibleRows.length} จาก {filteredRows.length} แถว — ใช้ filter หรือ search ด้านบนเพื่อดูที่เหลือ
              </p>
            )}
          </div>
        </>
      )}

      {selectedBatchId && (
        <div className="flex justify-end mt-2">
          <button
            onClick={goToSummary}
            disabled={isCheckingSummary}
            className="flex items-center gap-2 bg-ink text-accent px-8 py-3.5 rounded-xl font-bold text-sm shadow-[0_8px_20px_rgba(20,20,15,0.15)] hover:opacity-90 hover:-translate-y-0.5 transition-all disabled:opacity-60"
          >
            {isCheckingSummary && <Loader2 size={16} className="animate-spin" />}
            {isCheckingSummary ? 'Checking…' : 'Go to Summary'}
          </button>
        </div>
      )}

      {summaryWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[24px] p-8 w-[420px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={() => setSummaryWarning(null)} className="absolute top-6 right-6 text-gray-400 hover:text-ink transition-colors"><X size={20} /></button>
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-ink text-lg font-black mb-4">!</div>
            <h3 className="text-lg font-bold text-ink mb-2">Counting isn't complete yet</h3>
            <p className="text-sm text-muted font-semibold mb-6">
              {summaryWarning.percent === null
                ? "Couldn't check completion status for this batch."
                : `Fix zone is ${summaryWarning.percent}% counted${
                    summaryWarning.incompleteFreeZones > 0
                      ? `, and ${summaryWarning.incompleteFreeZones} Free zone${summaryWarning.incompleteFreeZones > 1 ? 's are' : ' is'} not marked done`
                      : ''
                  }. Do you still want to proceed to Summary?`}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setSummaryWarning(null)} className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm">Cancel</button>
              <button
                onClick={() => { setSummaryWarning(null); onGoToSummary && onGoToSummary(); }}
                className="bg-ink text-accent px-6 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity"
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[24px] p-8 w-[380px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={closeEdit} className="absolute top-6 right-6 text-gray-400 hover:text-ink transition-colors"><X size={20} /></button>
            <p className="text-[10px] font-bold text-muted mb-1">{editingRow.kbn} · {editingRow.address}</p>
            <h3 className="text-lg font-bold text-ink mb-5">{editingRow.partName || editingRow.partNo}</h3>

            <div className="grid grid-cols-2 gap-3.5 mb-4">
              <div>
                <label className="text-[10px] font-bold text-muted mb-1.5 block">Box</label>
                <input
                  type="text"
                  value={editForm.box}
                  onChange={(e) => setEditForm((f) => ({ ...f, box: e.target.value }))}
                  className="w-full bg-[#FAFAF7] border border-ink/10 rounded-xl px-3 py-2.5 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted mb-1.5 block">Pcs</label>
                <input
                  type="text"
                  value={editForm.pcs}
                  onChange={(e) => setEditForm((f) => ({ ...f, pcs: e.target.value }))}
                  className="w-full bg-[#FAFAF7] border border-ink/10 rounded-xl px-3 py-2.5 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted mb-1.5 block">Seq</label>
                <input
                  type="text"
                  value={editForm.seq}
                  onChange={(e) => setEditForm((f) => ({ ...f, seq: e.target.value }))}
                  className="w-full bg-[#FAFAF7] border border-ink/10 rounded-xl px-3 py-2.5 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted mb-1.5 block">Order</label>
                <input
                  type="text"
                  value={editForm.order}
                  onChange={(e) => setEditForm((f) => ({ ...f, order: e.target.value }))}
                  className="w-full bg-[#FAFAF7] border border-ink/10 rounded-xl px-3 py-2.5 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>

            {saveError && <p className="text-xs font-semibold text-red-500 mb-3">{saveError}</p>}

            <div className="flex justify-end gap-3">
              <button onClick={closeEdit} className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm">Cancel</button>
              <button
                onClick={saveEdit}
                disabled={isSaving}
                className="bg-ink text-accent px-6 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-2"
              >
                {isSaving && <Loader2 size={14} className="animate-spin" />}
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Detail;