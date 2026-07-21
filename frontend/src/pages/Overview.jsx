import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts';
import { ChevronDown } from 'lucide-react';
import Sparkle from '../components/Sparkle';

// --- ข้อมูลจำลองสำหรับหน้า Overview ---
const trendData = [ { time: '08:00', count: 30 }, { time: '10:00', count: 85 }, { time: '12:00', count: 45 }, { time: '14:00', count: 90 }, { time: '16:00', count: 65 } ];
const shopData = [ { name: 'A', checked: 85, remain: 15 }, { name: 'W', checked: 60, remain: 40 }, { name: 'T', checked: 30, remain: 70 }, { name: 'K', checked: 15, remain: 85 }, { name: 'R', checked: 5, remain: 95 } ];
const overallData = [ { name: 'Checked', value: 280, color: '#D7FF3F' }, { name: 'Remaining', value: 146, color: '#14140F' } ];
const donutData = [ { name: 'Done', value: 68, color: '#D7FF3F' }, { name: 'Remain', value: 32, color: '#F3F2ED' } ];
const tableData = [
  { shop: 'A', address: 'FN2', progress: '12/12', status: 'Done', color: 'text-success', bg: 'bg-green-50' },
  { shop: 'A', address: 'TR2', progress: '10/12', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'W', address: 'Line Side', progress: '5/12', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'W', address: 'PC', progress: '12/12', status: 'Done', color: 'text-success', bg: 'bg-green-50' },
  { shop: 'T', address: 'Line Side', progress: '0/20', status: 'Pending', color: 'text-gray-400', bg: 'bg-gray-100' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
  { shop: 'K', address: 'Line Side', progress: '8/10', status: 'Checking', color: 'text-primary', bg: 'bg-orange-50' },
];
const damageData = [ { shop: 'A', kbn: '88511-0K010-00', total: 5 }, { shop: 'W', kbn: '82121-0K120-00', total: 2 } ];
const lastOrderData = [ { dock: 'S1', check: 'Completed Lane', route: '-', lastOrder: '2026040110' }, { dock: 'S2', check: 'ASIAA', route: 'SC-B01', lastOrder: '2026040114' } ];

// Presentational only — derives the address-table status badge from
// row.status, matching the design's statusStyle(). Does not alter tableData.
const statusStyle = (status) => {
  if (status === 'Done') return { bg: 'bg-accent', text: 'text-ink' };
  if (status === 'Checking') return { bg: 'bg-ink', text: 'text-accent' };
  return { bg: 'bg-ink/[0.06]', text: 'text-[#B5B2A8]' };
};

const Overview = () => {
  const [selectedShop, setSelectedShop] = useState('All');
  const filteredTableData = selectedShop === 'All' ? tableData : tableData.filter(item => item.shop === selectedShop);

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
        </div>
        <div className="w-full overflow-x-auto pb-2">
          <div className="grid grid-cols-6 gap-3.5 min-w-[900px]">
            {['A', 'W', 'T', 'K', 'R', 'TTAT'].map((shop, i) => (
              <div key={shop} className="bg-white rounded-[20px] p-4.5 shadow-[0_2px_10px_rgba(20,20,15,0.04)] border border-ink/5 flex flex-col relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[5px] bg-ink"></div>
                <div className="pl-2">
                  <p className="text-muted text-[9px] font-extrabold uppercase tracking-wide mb-1.5">SHOP {shop}</p>
                  <h3 className="font-display text-xl font-bold text-ink">{i === 0 ? '120/140' : i === 1 ? '90/150' : '45/140'}</h3>
                  <p className="text-[9.5px] text-[#B5B2A8] font-semibold mt-1">Part Checked</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left Column */}
        <div className="flex-[2.4] min-w-0 flex flex-col gap-5">
          <div className="bg-white rounded-4xl p-6.5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col relative overflow-hidden">
            <h3 className="font-bold text-sm flex items-center gap-2 mb-5 text-ink"><Sparkle size={8} /> Scanning Trend</h3>
            <div className="flex-1 w-full -ml-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#D7FF3F" stopOpacity={0.45}/><stop offset="95%" stopColor="#D7FF3F" stopOpacity={0}/></linearGradient></defs>
                  <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#9B9890'}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#9B9890'}} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="count" stroke="#14140F" strokeWidth={1.5} fillOpacity={1} fill="url(#colorCount)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-4xl p-6.5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col">
            <h3 className="font-bold text-sm mb-6 text-ink">Shop Progress by address</h3>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shopData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold', fill: '#14140F'}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#9B9890'}} />
                  <Tooltip cursor={{fill: '#FAFAF7'}} />
                  <Bar dataKey="checked" stackId="a" fill="#D7FF3F" radius={[0, 0, 6, 6]} barSize={14} />
                  <Bar dataKey="remain" stackId="a" fill="#14140F" radius={[6, 6, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-4xl p-6.5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 mb-5 h-[420px] flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <h3 className="font-bold text-sm text-ink flex items-center gap-1.5">Detail by address <Sparkle size={6} delay="1.2s" /></h3>
              <div className="relative">
                <select className="pl-4 pr-9 py-2 bg-[#FAFAF7] border border-ink/10 rounded-full text-[11.5px] w-36 outline-none appearance-none cursor-pointer font-bold text-ink" value={selectedShop} onChange={(e) => setSelectedShop(e.target.value)}>
                  <option value="All">All Shops</option> <option value="A">Shop A</option> <option value="W">Shop W</option> <option value="T">Shop T</option> <option value="K">Shop K</option> <option value="R">Shop R</option> <option value="TTAT">Shop TTAT</option>
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 pr-2">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[#B5B2A8] uppercase tracking-wider text-[9px]"><th className="pb-3 pt-2 font-extrabold bg-white">Shop</th><th className="pb-3 pt-2 font-extrabold bg-white">Address</th><th className="pb-3 pt-2 font-extrabold bg-white">Progress</th><th className="pb-3 pt-2 font-extrabold bg-white">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {filteredTableData.map((row, index) => {
                    const s = statusStyle(row.status);
                    return (
                      <tr key={index}><td className="py-3 font-bold text-ink">Shop {row.shop}</td><td className="py-3 text-[#8A8880] font-medium">{row.address}</td><td className="py-3 font-bold text-ink">{row.progress}</td><td className="py-3"><span className={`font-extrabold text-[10px] ${s.bg} ${s.text} px-2.5 py-1 rounded-full`}>{row.status}</span></td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex-1 min-w-[260px] lg:max-w-[320px] flex flex-col gap-5">
          <div className="bg-white rounded-4xl p-7 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col items-center relative flex-shrink-0">
            <h3 className="font-bold text-sm mb-4 w-full text-left text-ink">Overall Progress</h3>
            <div className="flex-1 w-full relative">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donutData} cx="50%" cy="50%" innerRadius="75%" outerRadius="100%" dataKey="value" stroke="none">{donutData.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="font-display text-3xl font-bold text-ink">68%</span><span className="text-[9px] text-[#B5B2A8] font-extrabold uppercase mt-1 tracking-wide">Completed</span></div>
            </div>
          </div>

          <div className="bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[300px] flex flex-col items-center flex-shrink-0">
            <h3 className="font-bold text-sm mb-4 w-full text-left text-ink">Local part vs Import part</h3>
            <div className="flex-1 w-full relative">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={overallData} innerRadius={0} outerRadius="90%" dataKey="value" stroke="#ffffff" strokeWidth={3}>{overallData.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer>
            </div>
            <div className="w-full flex justify-center gap-6 mt-4">
              <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-accent"></div><span className="text-[10px] font-bold text-[#5C5A52]">Local (280)</span></div>
              <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-ink"></div><span className="text-[10px] font-bold text-[#5C5A52]">Import (146)</span></div>
            </div>
          </div>

          <div className="bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[200px] flex flex-col flex-shrink-0">
            <h3 className="font-bold text-sm mb-3.5 flex-shrink-0 text-ink">Part Damage Status</h3>
            <div className="overflow-y-auto flex-1 pr-2">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[#B5B2A8] uppercase tracking-wider text-[9px]"><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Shop</th><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Part No</th><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {damageData.map((item, index) => (
                    <tr key={index}><td className="py-2.5 font-extrabold text-[11px] text-danger text-center">Shop {item.shop}</td><td className="py-2.5 text-[#8A8880] text-center font-medium text-[11px]">{item.kbn}</td><td className="py-2.5 font-extrabold text-ink text-center text-[11px]">{item.total}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 h-[200px] flex flex-col flex-shrink-0">
            <h3 className="font-bold text-sm mb-3.5 flex-shrink-0 text-ink">Check Last Order (Lane)</h3>
            <div className="overflow-y-auto flex-1 pr-2">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[#B5B2A8] uppercase tracking-wider text-[9px]"><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Dock</th><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Check</th><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Route</th><th className="pb-2.5 pt-1 font-extrabold text-center bg-white">Last Order</th></tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {lastOrderData.map((item, index) => (
                    <tr key={index}><td className="py-2.5 font-extrabold text-[11px] text-ink text-center">{item.dock}</td><td className="py-2.5 font-extrabold text-ink text-center text-[11px]">{item.check}</td><td className="py-2.5 text-[#8A8880] text-center font-medium text-[11px]">{item.route}</td><td className="py-2.5 text-[#8A8880] text-center text-[10px] bg-[#FAFAF7] rounded-md">{item.lastOrder}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Overview;
