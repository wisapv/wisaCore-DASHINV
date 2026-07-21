import React from 'react';
import { Search, Bell, AlertCircle, ChevronDown } from 'lucide-react';
import Sparkle from './Sparkle';

const Header = ({ activeTab, setActiveTab, activeModule, uploadTab, setUploadTab }) => {
  const dashboardTabs = ['Overview', 'Detail', 'Summary'];
  const uploadTabs = ['TBOS', 'Handheld'];

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-canvas/90 backdrop-blur-md w-full flex justify-between items-center px-8 h-24 border-b border-ink/[0.06]">

      {/* Left: Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-[38px] h-[38px] bg-ink rounded-xl flex items-center justify-center">
          <Sparkle size={17} delay=".4s" />
        </div>
        <span className="font-display font-bold text-[19px] tracking-tight text-ink">WISA</span>
      </div>

      {/* Center: Dynamic Tabs or Title */}
      <div className="absolute left-1/2 -translate-x-1/2">
        {activeModule === 'dashboard' ? (

          // โชว์ Tabs สำหรับ Dashboard
          <div className="relative flex items-center bg-white rounded-full p-1.5 shadow-[0_2px_10px_rgba(20,20,15,0.05)] border border-ink/[0.05]">
            <div
              className="absolute top-1.5 bottom-1.5 left-1.5 w-[110px] bg-ink rounded-full transition-transform duration-300 ease-in-out"
              style={{ transform: `translateX(${dashboardTabs.indexOf(activeTab) * 100}%)` }}
            ></div>

            {dashboardTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative z-10 w-[110px] flex-none text-center py-2.5 text-xs font-bold transition-colors duration-300 ${
                  activeTab === tab ? 'text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

        ) : activeModule === 'upload' ? (

          // โชว์ Tabs สำหรับ Part List Upload (TBOS / Handheld)
          <div className="relative flex items-center bg-white rounded-full p-1.5 shadow-[0_2px_10px_rgba(20,20,15,0.05)] border border-ink/[0.05]">
            <div
              className="absolute top-1.5 bottom-1.5 left-1.5 w-[120px] bg-ink rounded-full transition-transform duration-300 ease-in-out"
              style={{ transform: `translateX(${uploadTabs.indexOf(uploadTab) * 100}%)` }}
            ></div>

            {uploadTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setUploadTab(tab)}
                className={`relative z-10 w-[120px] flex-none text-center py-2.5 text-xs font-bold transition-colors duration-300 ${
                  uploadTab === tab ? 'text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

        ) : (

          // หน้าอื่นๆ โชว์เป็นแค่ป้ายชื่อ
          <div className="text-sm font-bold text-ink uppercase tracking-widest bg-white px-8 py-2.5 rounded-full shadow-[0_2px_10px_rgba(20,20,15,0.05)] border border-ink/[0.05]">
             {activeModule === 'home' ? 'Welcome to System' :
              activeModule === 'result' ? 'Inventory Result' : 'System'}
          </div>

        )}
      </div>

      {/* Right: Profile & Actions */}
      <div className="flex items-center gap-3">
        <div className="flex items-center bg-white rounded-full px-4 py-2.5 shadow-[0_2px_10px_rgba(20,20,15,0.05)] gap-4 text-muted border border-ink/[0.05]">
          <Search size={17} className="cursor-pointer hover:text-ink transition-colors" />
          <div className="relative cursor-pointer hover:text-ink transition-colors">
            <Bell size={17} />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-danger rounded-full"></span>
          </div>
          <AlertCircle size={17} className="cursor-pointer hover:text-ink transition-colors" />
        </div>

        <div className="flex items-center bg-white rounded-full pl-2 pr-4 py-1.5 shadow-[0_2px_10px_rgba(20,20,15,0.05)] gap-3 cursor-pointer border border-ink/[0.05] hover:bg-canvas/50 transition-colors">
          <div className="w-8 h-8 rounded-full bg-ink text-accent flex items-center justify-center font-extrabold text-[13px]">W</div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-bold text-ink text-right">Wanwisa</span>
            <span className="text-[9px] text-muted">wsakchai@toyota.co.th</span>
          </div>
          <ChevronDown size={13} className="text-muted ml-1" />
        </div>
      </div>
    </div>
  );
};

export default Header;
