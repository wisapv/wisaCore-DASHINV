import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Overview from './pages/Overview';
import Detail from './pages/Detail';
import ListCreate from './pages/ListCreate';
import Home from './pages/Home';
import TemplateManager from './pages/TemplateManager'

function App() {
  const [activeModule, setActiveModule] = useState('home');
  const [activeTab, setActiveTab] = useState('Overview'); // ใช้สำหรับหน้า Dashboard
  const [uploadTab, setUploadTab] = useState('TBOS');     // ใช้สำหรับหน้า Upload (เพิ่มใหม่)

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink overflow-x-hidden overflow-y-scroll">

      <Sidebar activeModule={activeModule} setActiveModule={setActiveModule} />

      {/* ส่งค่า State ไปให้ Header จัดการแสดงผล Tabs */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeModule={activeModule}
        uploadTab={uploadTab}
        setUploadTab={setUploadTab}
      />

      <div className="flex pt-[132px]">
        <div className="flex-1 ml-[116px] pb-12 pr-8 flex flex-col gap-6 min-w-0">

          {activeModule === 'home' && <Home />}
          
          {/* ส่ง uploadTab ไปให้ ListCreate เพื่อเลือกว่าจะโชว์ TBOS หรือ Handheld */}
          {/* เปลี่ยนจากแบบเดิมเป็นแบบนี้ */}
          {activeModule === 'upload' && <ListCreate activeTab={uploadTab} setUploadTab={setUploadTab} />}
          {activeModule === 'template' && <TemplateManager />}
          {activeModule === 'dashboard' && (
            <>
              {activeTab === 'Overview' && <Overview />}
              {activeTab === 'Detail' && <Detail />}
              {activeTab === 'Summary' && <div className="p-20 text-center text-muted bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5">Summary Page</div>}
            </>
          )}

          {activeModule === 'result' && (
            <div className="p-20 text-center text-muted bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5">
              Inventory Result Page (กำลังพัฒนา...)
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;