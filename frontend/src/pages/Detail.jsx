import React, { useState } from 'react';
import {
  Search, ChevronDown
} from 'lucide-react';
import Sparkle from '../components/Sparkle';

// --- ข้อมูลจำลองสำหรับหน้า Detail ---
const detailTableData = [
  { id: '010347', shop: 'A', dock: 'S1', address: 'FN3-L01', partNo: '5610106B0000', kbn: 'SFK6', partname: 'GLASS S/A W/SHIELD', qty: '16', box: '1', pcs: '16', seq: '516', order: '2026031016', status: 'Done', color: 'border-l-gray-300' },
  { id: '010348', shop: 'W', dock: 'N2', address: 'W-10-02', partNo: '821610XV5000', kbn: 'NDH2', partname: 'WIRE FLR', qty: '1', box: '2', pcs: '0', seq: '519', order: '2026031013', status: 'Checking', color: 'border-l-primary' },
  { id: '010349', shop: 'W', dock: 'N1', address: 'W-15-08', partNo: '8214506K8000', kbn: 'ND55', partname: 'WIRE INST PNL', qty: '2', box: '0', pcs: '6', seq: '816', order: '-', status: 'Pending', color: 'border-l-yellow-400' },
  { id: '010350', shop: 'T', dock: 'N1', address: 'T-05-01', partNo: '8614006A0000', kbn: 'NNC6', partname: 'RCVR RADIO & DISP', qty: '2', box: '10', pcs: '1', seq: '566', order: '2026031816', status: 'Done', color: 'border-l-green-400' },
  { id: '010351', shop: 'K', dock: 'N1', address: 'K-01-01', partNo: '8217106T7000', kbn: 'NDN8', partname: 'WIRE ROOF', qty: '20', box: '1', pcs: '111', seq: '716', order: '2026031916', status: 'Checking', color: 'border-l-purple-400' },
];

// Presentational only — derives badge/border colors from row.status, matching
// the design's statusStyle(). Does not alter detailTableData in any way.
const statusStyle = (status) => {
  if (status === 'Done') return { bg: 'bg-accent', text: 'text-ink', border: 'border-l-accent' };
  if (status === 'Checking') return { bg: 'bg-ink', text: 'text-accent', border: 'border-l-ink' };
  return { bg: 'bg-ink/[0.06]', text: 'text-[#B5B2A8]', border: 'border-l-ink/[0.15]' };
};

const Detail = () => {
  const [filterShop, setFilterShop] = useState('All');
  const [filterDock, setFilterDock] = useState('All');
  const [filterAddress, setFilterAddress] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  const selectClass = 'border border-ink/10 bg-[#FAFAF7] rounded-xl px-3 py-2.5 text-[11.5px] font-semibold text-ink outline-none appearance-none cursor-pointer';

  return (
    <div className="flex flex-col gap-5 w-full animate-in fade-in duration-500 pb-10">

      {/* Header Text */}
      <div className="flex items-center gap-3.5 mb-1">
        <div className="flex flex-col">
          <span className="text-xs text-muted font-semibold tracking-wide">Piece Count Detail</span>
          <h1 className="font-display text-[34px] font-bold tracking-tight leading-none mt-0.5 text-ink">Stock Tracking Detail</h1>
        </div>
        <div className="w-[34px] h-[34px] bg-accent rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkle size={16} className="!bg-ink" delay=".2s" />
        </div>
      </div>

      {/* ======================= TOP CARDS (Filters & Search) ======================= */}
      <div className="flex flex-col lg:flex-row gap-5 items-stretch">

        {/* Left Card: Multiple Filters */}
        <div className="flex-[2.2] min-w-[300px] bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 relative overflow-hidden">
          <div className="absolute top-3.5 right-4.5 pointer-events-none">
            <Sparkle size={10} className="!opacity-60" delay=".5s" />
          </div>
          <p className="text-[13px] font-bold text-ink mb-3.5">Filters</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">

            {/* Filter: Shop */}
            <div className="relative w-full">
              <select
                className={`w-full pr-8 ${selectClass}`}
                value={filterShop}
                onChange={(e) => setFilterShop(e.target.value)}
              >
                <option value="All">All Shops</option>
                <option value="A">Shop A</option>
                <option value="W">Shop W</option>
                <option value="T">Shop T</option>
                <option value="K">Shop K</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted"/>
            </div>

            {/* Filter: Dock */}
            <div className="relative w-full">
              <select
                className={`w-full pr-8 ${selectClass}`}
                value={filterDock}
                onChange={(e) => setFilterDock(e.target.value)}
              >
                <option value="All">All Docks</option>
                <option value="S1">Dock S1</option>
                <option value="N1">Dock N1</option>
                <option value="N2">Dock N2</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted"/>
            </div>

            {/* Filter: Address */}
            <div className="relative w-full">
              <select
                className={`w-full pr-8 ${selectClass}`}
                value={filterAddress}
                onChange={(e) => setFilterAddress(e.target.value)}
              >
                <option value="All">All Addresses</option>
                <option value="A-01-05">A-01-05</option>
                <option value="W-10-02">W-10-02</option>
                <option value="T-05-01">T-05-01</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted"/>
            </div>

            {/* Filter: Status */}
            <div className="relative w-full">
              <select
                className={`w-full pr-8 ${selectClass}`}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="All">All Status</option>
                <option value="Done">Done</option>
                <option value="Checking">Checking</option>
                <option value="Pending">Pending</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted"/>
            </div>

          </div>
        </div>

        {/* Right Card: Search Bar */}
        <div className="flex-[1.4] min-w-[260px] bg-white rounded-4xl p-6 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 flex flex-col justify-center">
          <p className="text-[13px] font-bold text-ink mb-3.5">Search Data</p>
          <div className="flex gap-2.5">
            <input
              type="text"
              placeholder="Type KBN, Part No..."
              className="flex-1 border border-ink/10 bg-[#FAFAF7] rounded-xl px-3.5 py-2.5 text-xs outline-none text-ink"
            />
            <button className="bg-ink text-accent px-[22px] py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap hover:opacity-90 transition-opacity">
              Search
            </button>
          </div>
        </div>
      </div>

      {/* ======================= DATA TABLE ======================= */}
      <div className="bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 overflow-hidden mt-1">
        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs whitespace-nowrap border-collapse">
            {/* Table Header */}
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
                <th className="px-3.5 py-4 text-[9px] font-extrabold tracking-wider text-white">STATUS</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody>
              {detailTableData.map((row, idx) => {
                const s = statusStyle(row.status);
                return (
                  <tr key={idx} className={`border-t border-ink/5 border-l-4 ${s.border}`}>
                    <td className="px-3.5 py-3.5 font-extrabold text-ink">Shop {row.shop}</td>
                    <td className="px-3.5 py-3.5 font-bold text-ink">{row.dock}</td>
                    <td className="px-3.5 py-3.5 font-bold text-[#5C5A52]">{row.partNo}</td>
                    <td className="px-3.5 py-3.5 font-bold text-ink">{row.partname}</td>
                    <td className="px-3.5 py-3.5">
                      <span className="bg-accent text-ink font-extrabold px-2.5 py-0.5 rounded-lg text-[10.5px]">{row.kbn}</span>
                    </td>
                    <td className="px-3.5 py-3.5 text-[#5C5A52] font-semibold">{row.address}</td>
                    <td className="px-3.5 py-3.5 font-bold text-ink">{row.qty}</td>
                    <td className="px-3.5 py-3.5 font-bold text-ink">{row.box}</td>
                    <td className="px-3.5 py-3.5 font-bold text-ink">{row.pcs}</td>
                    <td className="px-3.5 py-3.5 text-[#5C5A52]">{row.seq}</td>
                    <td className="px-3.5 py-3.5 text-[#5C5A52] text-[10.5px]">{row.order}</td>
                    <td className="px-3.5 py-3.5">
                      <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${s.bg} ${s.text}`}>{row.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default Detail;
