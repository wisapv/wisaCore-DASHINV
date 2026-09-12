import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, LabelList,
} from 'recharts';
import { ChevronDown, Loader2 } from 'lucide-react';
import Sparkle from '../components/Sparkle';
import { API_BASE } from '../hooks/useActiveBatch';

// Same storage key AssignHandheld.jsx uses — deliberately
// shared so whichever batch is being assigned/checked is what Overview
// shows too, without needing its own separate picker.
const SELECTED_BATCH_STORAGE_KEY = 'wisa:assignHandheld:selectedBatchId';
function readStoredBatchId() {
  try { return localStorage.getItem(SELECTED_BATCH_STORAGE_KEY) || ''; } catch { return ''; }
}

const SHOP_ORDER = ['A', 'W', 'T', 'K', 'R', 'TTAT'];

const statusStyle = (status) => {
  if (status === 'Done') return { bg: 'bg-accent', text: 'text-ink' };
  if (status === 'Checking') return { bg: 'bg-ink', text: 'text-accent' };
  return { bg: 'bg-ink/[0.06]', text: 'text-[#B5B2A8]' };
};

const deviceStatusStyle = (status) => {
  if (status === 'active') return { badge: 'bg-ink text-accent', dot: 'bg-accent', text: 'text-ink' };
  return { badge: 'bg-ink/[0.06] text-[#B5B2A8]', dot: 'bg-[#B5B2A8]', text: 'text-[#B5B2A8]' };
};

const SOURCE_COLORS = { Local: '#D7FF3F', Import: '#14140F', Inhouse: '#8A8880', Unknown: '#D9D6CC' };

function timeAgo(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr`;
  return `${Math.round(hr / 24)} d`;
}

const Overview = ({ currentBatchId, subscribeToEvent }) => {
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

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedShop, setSelectedShop] = useState('All');
  const loadRequestIdRef = useRef(0);
  // Only the very first load (or a batch switch) shows the full spinner and
  // hides the dashboard — a background refresh triggered by handheld:updated
  // (which fires constantly during real counting, every single submission)
  // just swaps the numbers in place once the new data arrives, instead of
  // collapsing the whole page to a spinner and back on every event. That
  // collapse-and-reappear cycle is what was showing up as "flickering".
  const hasLoadedOnceRef = useRef(false);

  const load = () => {
    if (!selectedBatchId) { setData(null); setIsLoading(false); return; }
    if (!hasLoadedOnceRef.current) setIsLoading(true); // only the first load blanks the page
    setLoadError('');
    const requestId = ++loadRequestIdRef.current;
    fetch(`${API_BASE}/api/handheld-assign/overview?batchId=${encodeURIComponent(selectedBatchId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((result) => { if (loadRequestIdRef.current === requestId) setData(result); })
      .catch(() => { if (loadRequestIdRef.current === requestId) setLoadError('Could not load overview for this batch.'); })
      .finally(() => {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false);
          hasLoadedOnceRef.current = true;
        }
      });
  };

  // A batch switch is a genuine "start over" — the next load for the new
  // batch should blank the page again, same as the very first load ever.
  useEffect(() => { hasLoadedOnceRef.current = false; }, [selectedBatchId]);

  useEffect(() => { load(); }, [selectedBatchId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!subscribeToEvent) return undefined;
    return subscribeToEvent('handheld:updated', (payload) => {
      if (!payload || !payload.batchId || payload.batchId === selectedBatchId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeToEvent, selectedBatchId]);

  const shopCards = useMemo(() => {
    const bySh = {};
    (data?.shopProgress || []).forEach((r) => { bySh[r.shop] = r; });
    return SHOP_ORDER.map((shop) => bySh[shop] || { shop, counted: 0, total: 0 });
  }, [data]);

  const zoneChartData = useMemo(
    () => (data?.zoneProgress || []).map((z) => ({
      name: z.zone,
      checked: z.counted,
      remain: Math.max(z.total - z.counted, 0),
      percent: z.total > 0 ? Math.round((z.counted / z.total) * 100) : 0,
    })),
    [data]
  );

  const sourcePie = useMemo(
    () => (data?.sourceComposition || []).map((s) => ({ name: s.label, value: s.count, color: SOURCE_COLORS[s.label] || '#D9D6CC' })),
    [data]
  );
  const sourceTotal = sourcePie.reduce((s, r) => s + r.value, 0);

  const filteredAddressProgress = useMemo(() => {
    const rows = data?.addressProgress || [];
    return selectedShop === 'All' ? rows : rows.filter((r) => r.shop === selectedShop);
  }, [data, selectedShop]);

  // Rendering an unbounded table (a real batch can easily have 200-300+
  // distinct addresses) is what was making the page feel laggy — capped to
  // a reasonable page size; narrowing with the Shop filter above shows
  // everything for that shop since it's a much smaller slice.
  const ADDRESS_ROWS_LIMIT = 100;
  const visibleAddressProgress = filteredAddressProgress.slice(0, ADDRESS_ROWS_LIMIT);
  const hiddenAddressCount = filteredAddressProgress.length - visibleAddressProgress.length;

  const overall = data?.overallProgress || { counted: 0, total: 0, percent: 0 };
  const donutData = [
    { name: 'Done', value: overall.percent, color: '#D7FF3F' },
    { name: 'Remain', value: 100 - overall.percent, color: '#F3F2ED' },
  ];

  return (
    <div className="flex flex-col gap-5 w-full animate-in fade-in duration-500">
      <div className="flex flex-col">
        <div className="flex items-center gap-3.5 mb-3.5">
          <div className="flex flex-col">
            <span className="text-xs text-muted font-semibold tracking-wide">Live Inventory</span>
            <h1 className="font-display text-[34px] font-bold tracking-tight leading-none mt-0.5 text-ink">Stock Monitoring</h1>
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

        {!selectedBatchId ? (
          <div className="bg-white border-2 border-dashed border-ink/10 rounded-[28px] p-16 text-center text-[12px] text-muted font-semibold">
            Select a batch (or pick one on Assign Handheld / Check Stock) to see live progress.
          </div>
        ) : isLoading ? (
          <div className="bg-white border border-ink/10 rounded-[28px] p-16 flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-muted" />
          </div>
        ) : loadError ? (
          <div className="bg-white border border-red-100 rounded-[28px] p-16 text-center text-[12px] text-red-500 font-semibold">{loadError}</div>
        ) : (
          <div className="w-full overflow-x-auto pb-2">
            <div className="grid grid-cols-6 gap-3.5 min-w-[900px]">
              {shopCards.map((row) => (
                <div key={row.shop} className="bg-white rounded-[20px] p-[18px] shadow-[0_2px_10px_rgba(20,20,15,0.04)] border border-ink/5 flex flex-col relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-[5px] bg-ink"></div>
                  <div className="pl-2">
                    <p className="text-muted text-[9px] font-extrabold uppercase tracking-wide mb-1.5">SHOP {row.shop}</p>
                    <h3 className="font-display text-xl font-bold text-ink">{row.counted}/{row.total}</h3>
                    <p className="text-[9.5px] text-[#B5B2A8] font-semibold mt-1">Part Checked</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedBatchId && !isLoading && !loadError && (
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Left Column */}
          <div className="flex-[2.4] min-w-0 flex flex-col gap-5">

            <div className="bg-white rounded-4xl p-[26px] shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col relative overflow-hidden">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2 text-ink">
                    <Sparkle size={8} />
                    Device Status
                  </h3>
                  <p className="text-[10px] text-muted mt-1">Handheld status and current assignment (last activity)</p>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 pr-2 divide-y divide-ink/5">
                {(data.deviceStatus || []).length === 0 ? (
                  <p className="text-[11px] text-muted font-semibold py-10 text-center">No active devices</p>
                ) : (
                  data.deviceStatus.map((device) => {
                    const style = deviceStatusStyle(device.status);
                    return (
                      <div key={device.deviceId} className="grid grid-cols-[0.9fr_1fr_1.4fr_0.9fr] gap-3 items-center py-3">
                        <p className="font-bold text-xs text-ink">{device.name}</p>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold w-fit ${style.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`}></span>
                          {device.status === 'active' ? 'Active' : 'Idle'}
                        </span>
                        <p className="text-[10px] font-bold text-ink truncate">{device.currentLabel}</p>
                        <div className="text-right">
                          <p className={`text-[10px] font-semibold ${style.text}`}>{timeAgo(device.lastActivity)}</p>
                          <p className="text-[8px] text-muted mt-0.5">Last activity</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="bg-white rounded-4xl p-[26px] shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[420px] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm text-ink">Shop Progress by zone</h3>
                <div className="flex items-center gap-3.5">
                  <span className="flex items-center gap-1.5 text-[9.5px] font-bold text-[#8A8880]"><span className="w-2 h-2 rounded-full bg-accent"></span>Checked</span>
                  <span className="flex items-center gap-1.5 text-[9.5px] font-bold text-[#8A8880]"><span className="w-2 h-2 rounded-full bg-ink"></span>Remain</span>
                </div>
              </div>
              <div className="flex-1 w-full overflow-y-auto pr-1">
                <ResponsiveContainer width="100%" height={Math.max(zoneChartData.length * 34, 200)}>
                  <BarChart data={zoneChartData} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barCategoryGap={10}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      width={90}
                      tick={{ fontSize: 10, fontWeight: 'bold', fill: '#14140F' }}
                    />
                    <Tooltip cursor={{ fill: '#FAFAF7' }} />
                    <Bar dataKey="checked" stackId="a" fill="#D7FF3F" radius={[6, 0, 0, 6]} barSize={16} />
                    <Bar dataKey="remain" stackId="a" fill="#14140F" radius={[0, 6, 6, 0]} barSize={16}>
                      <LabelList
                        dataKey="percent"
                        position="right"
                        formatter={(v) => `${v}%`}
                        style={{ fontSize: 10, fontWeight: 'bold', fill: '#8A8880' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-4xl p-[26px] shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 mb-5 h-[420px] flex flex-col">
              <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <h3 className="font-bold text-sm text-ink flex items-center gap-1.5">Detail by address <Sparkle size={6} delay="1.2s" /></h3>
                <div className="relative">
                  <select className="pl-4 pr-9 py-2 bg-[#FAFAF7] border border-ink/10 rounded-full text-[11.5px] w-36 outline-none appearance-none cursor-pointer font-bold text-ink" value={selectedShop} onChange={(e) => setSelectedShop(e.target.value)}>
                    <option value="All">All Shops</option>
                    {SHOP_ORDER.map((s) => <option key={s} value={s}>Shop {s}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 pr-2">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="text-[#B5B2A8] uppercase tracking-wider text-[9px]">
                      <th className="pb-3 pt-2 font-extrabold bg-white">Shop</th>
                      <th className="pb-3 pt-2 font-extrabold bg-white">Address</th>
                      <th className="pb-3 pt-2 font-extrabold bg-white">Progress</th>
                      <th className="pb-3 pt-2 font-extrabold bg-white">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {filteredAddressProgress.length === 0 ? (
                      <tr><td colSpan={4} className="py-10 text-center text-muted font-semibold">No data</td></tr>
                    ) : (
                      visibleAddressProgress.map((row, index) => {
                        const s = statusStyle(row.status);
                        return (
                          <tr key={index}>
                            <td className="py-3 font-bold text-ink">Shop {row.shop}</td>
                            <td className="py-3 text-[#8A8880] font-medium">{row.address}</td>
                            <td className="py-3 font-bold text-ink">{row.counted}/{row.total}</td>
                            <td className="py-3"><span className={`font-extrabold text-[10px] ${s.bg} ${s.text} px-2.5 py-1 rounded-full`}>{row.status}</span></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {hiddenAddressCount > 0 && (
                  <p className="text-[10px] text-muted font-semibold text-center py-3">
                    โชว์ {visibleAddressProgress.length} จาก {filteredAddressProgress.length} แถว — เลือก Shop ด้านบนเพื่อดูที่เหลือ
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="flex-1 min-w-[260px] lg:max-w-[320px] flex flex-col gap-5">
            <div className="bg-white rounded-4xl p-7 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col items-center relative flex-shrink-0">
              <h3 className="font-bold text-sm mb-4 w-full text-left text-ink">Overall Progress</h3>
              <p className="text-[9px] text-muted font-semibold w-full text-left -mt-3 mb-2">Fix zone เท่านั้น (ไม่รวม Free zone)</p>
              <div className="flex-1 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={donutData} cx="50%" cy="50%" innerRadius="75%" outerRadius="100%" dataKey="value" stroke="none">{donutData.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie></PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-display text-3xl font-bold text-ink">{overall.percent}%</span>
                  <span className="text-[9px] text-[#B5B2A8] font-extrabold uppercase mt-1 tracking-wide">Completed</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col items-center flex-shrink-0">
              <h3 className="font-bold text-sm mb-4 w-full text-left text-ink">Local / Import / Inhouse</h3>
              <div className="flex-1 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={sourcePie} innerRadius={0} outerRadius="90%" dataKey="value" stroke="#ffffff" strokeWidth={3}>{sourcePie.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full flex flex-wrap justify-center gap-4 mt-4">
                {sourcePie.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }}></div>
                    <span className="text-[10px] font-bold text-[#5C5A52]">{s.name} ({s.value})</span>
                  </div>
                ))}
                {sourceTotal === 0 && <p className="text-[10px] text-muted font-semibold">No data</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Overview;