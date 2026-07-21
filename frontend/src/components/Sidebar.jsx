import React from 'react';
import { Home, UploadCloud, LayoutGrid, ClipboardList, DownloadCloud, LogOut } from 'lucide-react';
import Sparkle from './Sparkle';

const Sidebar = ({ activeModule, setActiveModule }) => {
  return (
    <div className="fixed left-6 top-[112px] bottom-6 w-[59px] flex items-center justify-center z-40">
      <div className="w-[59px] bg-white rounded-5xl flex flex-col items-center py-[22px] shadow-[0_8px_24px_rgba(20,20,15,0.07)] max-h-full overflow-auto">

        {/* Logo mark */}
        <div className="w-[34px] h-[34px] bg-ink rounded-xl flex items-center justify-center mb-7 flex-shrink-0">
          <Sparkle size={16} />
        </div>

        {/* Main Menu */}
        <div className="flex flex-col gap-2.5 items-center">

          {/* 1. Home */}
          <div
            onClick={() => setActiveModule('home')}
            title="Home"
            className={`w-10 h-10 rounded-2xl cursor-pointer transition-all flex items-center justify-center ${
              activeModule === 'home' ? 'bg-ink text-accent shadow-[0_4px_10px_rgba(20,20,15,0.25)]' : 'text-muted hover:text-ink'
            }`}
          >
            <Home size={18} />
          </div>

          {/* 2. Part list upload */}
          <div
            onClick={() => setActiveModule('upload')}
            title="Part List Upload"
            className={`w-10 h-10 rounded-2xl cursor-pointer transition-all flex items-center justify-center ${
              activeModule === 'upload' ? 'bg-ink text-accent shadow-[0_4px_10px_rgba(20,20,15,0.25)]' : 'text-muted hover:text-ink'
            }`}
          >
            <UploadCloud size={18} />
          </div>

          {/* 3. Dashboard */}
          <div
            onClick={() => setActiveModule('dashboard')}
            title="Dashboard"
            className={`w-10 h-10 rounded-2xl cursor-pointer transition-all flex items-center justify-center ${
              activeModule === 'dashboard' ? 'bg-ink text-accent shadow-[0_4px_10px_rgba(20,20,15,0.25)]' : 'text-muted hover:text-ink'
            }`}
          >
            <LayoutGrid size={18} />
          </div>

          {/* 4. Inventory Result */}
          <div
            onClick={() => setActiveModule('result')}
            title="Inventory Result"
            className={`w-10 h-10 rounded-2xl cursor-pointer transition-all flex items-center justify-center ${
              activeModule === 'result' ? 'bg-ink text-accent shadow-[0_4px_10px_rgba(20,20,15,0.25)]' : 'text-muted hover:text-ink'
            }`}
          >
            <ClipboardList size={18} />
          </div>
        </div>

        {/* Bottom Menu */}
        <div className="flex flex-col gap-2.5 items-center mt-auto">
          {/* 5. Template management */}
          <div
            onClick={() => setActiveModule('template')}
            title="Template Management"
            className={`w-10 h-10 rounded-2xl cursor-pointer transition-all flex items-center justify-center ${
              activeModule === 'template' ? 'bg-ink text-accent shadow-[0_4px_10px_rgba(20,20,15,0.25)]' : 'text-muted hover:text-ink'
            }`}
          >
            <DownloadCloud size={18} />
          </div>
          {/* 6. Log out */}
          <div title="Log Out" className="w-10 h-10 rounded-2xl text-[#C9C6BC] hover:text-danger cursor-pointer transition-colors flex items-center justify-center">
            <LogOut size={18} />
          </div>
        </div>

      </div>
    </div>
  );
};

export default Sidebar;
