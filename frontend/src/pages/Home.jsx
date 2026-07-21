import React, { useMemo, useRef, useState } from 'react';
import Sparkle from '../components/Sparkle';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const COLOR_OPTIONS = [
  { name: 'Orange', hex: '#FF8A3D' },
  { name: 'Yellow', hex: '#FFC94D' },
  { name: 'Green', hex: '#6FCF67' },
];

const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const initialActivities = () => {
  const today = new Date();
  const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return isoLocal(d); };
  return [
    { id: 1, date: isoLocal(today), title: 'Reconcile Shop A damage report', color: '#6FCF67', ok: 118, ng: 4 },
    { id: 2, date: addDays(1), title: 'Cycle count — Shop W line side', color: '#FFC94D', ok: 76, ng: 9 },
    { id: 3, date: addDays(4), title: 'Handheld sync check, all docks', color: '#FF8A3D', ok: 210, ng: 2 },
    { id: 4, date: addDays(9), title: 'Monthly TBOS upload deadline', color: '#6FCF67', ok: 0, ng: 0 },
  ];
};

const Home = () => {
  const today = useMemo(() => new Date(), []);
  const todayIso = isoLocal(today);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [newDate, setNewDate] = useState(todayIso);
  const [hoverDate, setHoverDate] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalColor, setModalColor] = useState('#6FCF67');
  const [activities, setActivities] = useState(initialActivities);
  const nextIdRef = useRef(5);

  const removeActivity = (id, e) => {
    e.stopPropagation();
    setActivities(prev => prev.filter(a => a.id !== id));
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const handleNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleOpenModal = () => { setModalTitle(''); setModalColor('#6FCF67'); setShowModal(true); };
  const handleSaveModal = () => {
    if (!modalTitle.trim()) return;
    setActivities(prev => [...prev, { id: nextIdRef.current++, date: newDate, title: modalTitle.trim(), color: modalColor, ok: 0, ng: 0 }]);
    setShowModal(false);
  };

  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  const activitiesByDate = new Map();
  activities.forEach(a => {
    if (!activitiesByDate.has(a.date)) activitiesByDate.set(a.date, []);
    activitiesByDate.get(a.date).push(a);
  });

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const calendarDays = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const dateObj = new Date(viewYear, viewMonth, dayNum);
    const dateIso = isoLocal(dateObj);
    const isToday = inMonth && dateIso === todayIso;
    const isSelected = inMonth && newDate === dateIso;
    const dayActivities = activitiesByDate.get(dateIso) || [];
    const hasActivity = inMonth && dayActivities.length > 0;
    const activityColor = dayActivities[0] ? dayActivities[0].color : '#6FCF67';
    calendarDays.push({
      key: i,
      day: inMonth ? dayNum : '',
      inMonth,
      dateIso,
      opacity: inMonth ? 1 : 0,
      bg: isToday ? '#14140F' : (hasActivity ? activityColor : (isSelected ? '#D7FF3F' : 'transparent')),
      color: isToday ? '#D7FF3F' : (hasActivity ? '#14140F' : (isSelected ? '#14140F' : (inMonth ? '#14140F' : 'transparent'))),
      border: isSelected && !isToday && !hasActivity ? '2px solid #14140F' : '2px solid transparent',
      radius: (isToday || hasActivity || isSelected) ? '50%' : '9px',
      hasActivity,
      isHovered: hasActivity && hoverDate === dateIso,
      tooltip: dayActivities.map(a => a.title).join(' • '),
      cursor: inMonth ? 'pointer' : 'default',
    });
  }

  const allActivities = [...activities].sort((a, b) => a.date.localeCompare(b.date));

  const upcomingActivities = activities
    .filter(a => a.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const selDate = newDate ? new Date(newDate) : null;
  const newDateLabel = selDate ? `${MONTH_NAMES[selDate.getMonth()].slice(0, 3)} ${selDate.getDate()}` : '—';

  return (
    <div className="flex flex-col gap-5 w-full animate-in fade-in duration-500 pb-10">

      {/* Header Text */}
      <div className="flex items-center gap-3.5 mb-1">
        <div className="flex flex-col">
          <span className="text-xs text-muted font-semibold tracking-wide">Home</span>
          <h1 className="font-display text-[34px] font-bold tracking-tight leading-none mt-0.5 text-ink">Welcome back, Wanwisa</h1>
        </div>
        <div className="w-[34px] h-[34px] bg-accent rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkle size={16} className="!bg-ink" delay=".2s" />
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-ink rounded-[24px] p-[22px] relative overflow-hidden">
          <Sparkle size={11} className="absolute top-3.5 right-4 pointer-events-none" />
          <p className="text-accent text-[9.5px] font-extrabold tracking-wide mb-2.5">PARTS RUNNING OUT</p>
          <h3 className="font-display text-[30px] font-bold text-white">18 <span className="text-[13px] font-semibold text-[#8A8880]">SKUs</span></h3>
          <p className="text-[10.5px] text-[#8A8880] font-semibold mt-1.5">Below safety stock threshold</p>
        </div>
        <div className="bg-white rounded-[24px] p-[22px] border border-ink/5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] relative overflow-hidden">
          <Sparkle size={11} className="absolute top-3.5 right-4 pointer-events-none" delay=".5s" />
          <p className="text-muted text-[9.5px] font-extrabold tracking-wide mb-2.5">TOTAL CHECKED TODAY</p>
          <h3 className="font-display text-[30px] font-bold text-ink">1,240 <span className="text-[13px] font-semibold text-[#B5B2A8]">/ 1,600</span></h3>
          <p className="text-[10.5px] text-[#B5B2A8] font-semibold mt-1.5">Parts scanned across 6 shops</p>
        </div>
        <div className="bg-white rounded-[24px] p-[22px] border border-ink/5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] relative overflow-hidden">
          <Sparkle size={11} className="absolute top-3.5 right-4 pointer-events-none" delay="1s" />
          <p className="text-muted text-[9.5px] font-extrabold tracking-wide mb-2.5">RESULT ACCURACY</p>
          <h3 className="font-display text-[30px] font-bold text-ink">92.4%</h3>
          <p className="text-[10.5px] text-[#B5B2A8] font-semibold mt-1.5">Matched vs system records</p>
        </div>
      </div>

      {/* COLUMNS */}
      <div className="flex gap-5 items-start flex-wrap">

        {/* LEFT: Calendar + Reminders */}
        <div className="flex-none w-full lg:w-[380px] flex flex-col gap-5">
          <div className="bg-white rounded-4xl p-[22px] shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="font-display text-lg font-bold text-ink">{monthLabel}</h3>
              <div className="flex gap-1.5">
                <div onClick={handlePrevMonth} className="w-[26px] h-[26px] rounded-full bg-[#FAFAF7] border border-ink/[0.08] flex items-center justify-center cursor-pointer">
                  <div className="w-[5px] h-[5px] border-l-2 border-b-2 border-ink rotate-45"></div>
                </div>
                <div onClick={handleNextMonth} className="w-[26px] h-[26px] rounded-full bg-[#FAFAF7] border border-ink/[0.08] flex items-center justify-center cursor-pointer">
                  <div className="w-[5px] h-[5px] border-r-2 border-t-2 border-ink rotate-45"></div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1.5">
              {WEEKDAY_LABELS.map((wd, i) => (
                <div key={i} className="text-center text-[9px] font-extrabold text-[#B5B2A8] tracking-wide py-0.5">{wd}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((d) => (
                <div
                  key={d.key}
                  onClick={() => d.inMonth && setNewDate(d.dateIso)}
                  onMouseEnter={() => d.hasActivity && setHoverDate(d.dateIso)}
                  onMouseLeave={() => d.hasActivity && setHoverDate(null)}
                  className="aspect-square flex flex-col items-center justify-center relative transition-colors"
                  style={{ borderRadius: d.radius, background: d.bg, border: d.border, opacity: d.opacity, cursor: d.cursor }}
                >
                  <span className="text-[13px] font-bold" style={{ color: d.color }}>{d.day}</span>
                  {d.isHovered && (
                    <div className="absolute bottom-[110%] left-1/2 -translate-x-1/2 bg-ink text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap z-30 shadow-lg">
                      {d.tooltip}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-[18px] pt-4 border-t border-ink/[0.06]">
              <p className="text-[11px] font-bold text-muted mb-2.5">Selected date: {newDateLabel}</p>
              <div onClick={handleOpenModal} className="bg-ink text-accent px-3.5 py-2.5 rounded-[10px] text-[11.5px] font-extrabold cursor-pointer text-center">+ Add Activity</div>
            </div>
          </div>

          <div className="bg-white rounded-4xl p-[22px] shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 relative overflow-hidden">
            <Sparkle size={9} className="absolute top-3.5 right-4 !opacity-60 pointer-events-none" delay=".7s" />
            <h3 className="text-sm font-bold text-ink mb-3.5">Reminders</h3>
            <div className="flex flex-col gap-2">
              {upcomingActivities.map((a) => {
                const d = new Date(a.date);
                const diffDays = Math.round((new Date(a.date) - new Date(todayIso)) / 86400000);
                const relLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
                return (
                  <div key={a.id} className="flex items-center gap-2.5 p-2.5 bg-[#FAFAF7] rounded-xl animate-item-pop">
                    <div className="w-8 h-8 rounded-[9px] bg-ink text-accent flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-extrabold leading-none">{d.getDate()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11.5px] font-bold leading-tight text-ink truncate">{a.title}</p>
                      <p className="text-[9.5px] text-muted font-semibold mt-0.5">{relLabel}</p>
                    </div>
                    <div onClick={(e) => removeActivity(a.id, e)} className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[#C9C6BC] text-[11px] font-bold cursor-pointer flex-shrink-0 hover:text-ink transition-colors">×</div>
                  </div>
                );
              })}
              {upcomingActivities.length === 0 && (
                <p className="text-[11px] text-[#B5B2A8] text-center mt-1.5">No upcoming activities.</p>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: All Activities + How it works */}
        <div className="flex-1 min-w-[300px] flex flex-col gap-5">
          <div className="bg-white rounded-4xl p-[26px] shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5">
            <h3 className="text-sm font-bold text-ink mb-[18px]">All Activities</h3>
            <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
              {allActivities.map((a) => {
                const d = new Date(a.date);
                const isExpanded = expandedId === a.id;
                const isPast = a.date < todayIso;
                const total = (a.ok || 0) + (a.ng || 0);
                const okPct = total > 0 ? (a.ok / total) * 100 : 0;
                const ngPct = total > 0 ? (a.ng / total) * 100 : 100;
                const dateLabel = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
                return (
                  <div key={a.id} className="bg-[#FAFAF7] rounded-2xl overflow-hidden" style={{ opacity: isPast ? 0.55 : 1 }}>
                    <div onClick={() => setExpandedId(prev => prev === a.id ? null : a.id)} className="flex items-center gap-3 px-3.5 py-3 cursor-pointer">
                      <div className="w-[9px] h-[9px] rounded-full flex-shrink-0" style={{ background: a.color }}></div>
                      <p className="text-[12.5px] font-bold flex-1 min-w-0 truncate text-ink">{a.title}</p>
                      <span className="text-[10.5px] text-muted font-bold whitespace-nowrap">{dateLabel}</span>
                      <span className="text-[13px] font-extrabold text-muted w-3.5 text-center">{isExpanded ? '−' : '+'}</span>
                      <div onClick={(e) => removeActivity(a.id, e)} className="w-5 h-5 rounded-full flex items-center justify-center text-[#C9C6BC] text-xs font-bold cursor-pointer flex-shrink-0 hover:text-ink transition-colors">×</div>
                    </div>
                    <div
                      className="overflow-hidden transition-[max-height,opacity] duration-300"
                      style={{ maxHeight: isExpanded ? '110px' : '0px', opacity: isExpanded ? 1 : 0 }}
                    >
                      <div className="px-3.5 pb-3.5 pt-0.5 pl-[33px]">
                        <div className="flex h-2 rounded-[5px] overflow-hidden bg-ink/[0.08] mb-2.5">
                          <div style={{ width: `${okPct}%`, background: '#3C9A4A' }}></div>
                          <div style={{ width: `${ngPct}%`, background: '#D14545' }}></div>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full bg-ink text-white">Total {total}</span>
                          <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: 'rgba(60,154,74,0.14)', color: '#3C9A4A' }}>OK {a.ok || 0}</span>
                          <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: 'rgba(209,69,69,0.12)', color: '#D14545' }}>NG {a.ng || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-ink rounded-4xl p-6 relative overflow-hidden">
            <div className="absolute -bottom-4 -right-4 w-20 h-20 opacity-[0.16] pointer-events-none">
              <Sparkle size={80} />
            </div>
            <h3 className="text-sm font-bold text-white mb-1.5">How it works</h3>
            <p className="text-[11px] text-[#8A8880] font-semibold leading-relaxed mb-4">Upload → Check Stock → Dashboard. Three steps to a fully reconciled inventory.</p>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5"><div className="w-1.5 h-1.5 rounded-full bg-accent"></div><span className="text-[11px] font-bold text-white">1. Upload List</span></div>
              <div className="flex items-center gap-2.5"><div className="w-1.5 h-1.5 rounded-full bg-accent"></div><span className="text-[11px] font-bold text-white">2. Check Stock</span></div>
              <div className="flex items-center gap-2.5"><div className="w-1.5 h-1.5 rounded-full bg-accent"></div><span className="text-[11px] font-bold text-white">3. Dashboard</span></div>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-ink/45 flex items-center justify-center z-[100]" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-[24px] p-7 w-[340px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-ink mb-1">Add Activity</h3>
            <p className="text-[11.5px] text-muted font-semibold mb-[18px]">{newDateLabel}</p>
            <p className="text-[11px] font-bold text-[#5C5A52] mb-1.5">Title</p>
            <input
              type="text"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
              placeholder="e.g. Cycle count — Shop A"
              className="w-full box-border border border-ink/10 bg-[#FAFAF7] rounded-[10px] px-3 py-2.5 text-xs font-semibold text-ink outline-none mb-4"
            />
            <p className="text-[11px] font-bold text-[#5C5A52] mb-2">Color</p>
            <div className="flex gap-2.5 mb-[22px]">
              {COLOR_OPTIONS.map((c) => (
                <div
                  key={c.hex}
                  onClick={() => setModalColor(c.hex)}
                  title={c.name}
                  className="w-7 h-7 rounded-full cursor-pointer"
                  style={{ background: c.hex, border: modalColor === c.hex ? '3px solid #14140F' : '3px solid transparent' }}
                ></div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <div onClick={() => setShowModal(false)} className="flex-1 text-center py-2.5 rounded-xl bg-[#FAFAF7] border border-ink/10 text-xs font-bold cursor-pointer text-ink">Cancel</div>
              <div onClick={handleSaveModal} className="flex-1 text-center py-2.5 rounded-xl bg-ink text-accent text-xs font-extrabold cursor-pointer">Save</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
