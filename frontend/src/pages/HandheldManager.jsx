import React, { useState, useRef, useMemo } from 'react';
import { 
  Database, Loader2, CheckCircle2, MapPin, 
  AlertCircle, AlertTriangle, GripVertical, Settings2
} from 'lucide-react';

const HandheldManager = ({ currentBatchId, previewData, setUploadTab }) => {
  const [step, setStep] = useState('idle');
  const [handheldPreview, setHandheldPreview] = useState(null);
  const [addrFileUploaded, setAddrFileUploaded] = useState(false);
  const [finalHandheldData, setFinalHandheldData] = useState(null);
  
  const [holdData, setHoldData] = useState([]);
  const [remindData, setRemindData] = useState([]);

  // 🔴 สร้าง State สำหรับเปิด/ปิด กล่องลากวาง
  const [showPicManager, setShowPicManager] = useState(false);
  const [dragOverPic, setDragOverPic] = useState(null);
  const fileInputRef = useRef(null);

  const handleLoadHandheldPreview = async () => {
    try {
      setStep('generating');
      const res = await fetch(`http://localhost:3000/api/handheld/preview-handheld?batchId=${currentBatchId}`);
      const result = await res.json();
      if (res.ok) { setHandheldPreview(result.data); setStep('idle'); } 
      else { alert("Failed to generate Handheld format"); setStep('idle'); }
    } catch(e) { alert("Server Error"); setStep('idle'); }
  };

  const handleUploadAddr = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchId', currentBatchId);

    try {
        setStep('generating');
        const res = await fetch('http://localhost:3000/api/handheld-assign/process-assign-addr', { method: 'POST', body: formData });
        const result = await res.json();
        if (result.success) {
            setFinalHandheldData(result.data);
            setHoldData(result.hold);     
            setRemindData(result.remind); 
            setAddrFileUploaded(true);
            setStep('idle');
        } else { alert("Process Failed"); setStep('idle'); }
    } catch (err) { alert("Upload Failed"); setStep('idle'); }
    e.target.value = null;
  };

  // 🔴 จัดกลุ่มตาม ShortAddr (ตัวอักษร 2-3 ตัวแรกที่ตัดมาจาก Backend)
  const picGroups = useMemo(() => {
    if (!finalHandheldData) return {};
    const groups = {};
    finalHandheldData.forEach(row => {
        const pic = row.PIC || 'Unassigned';
        const shortAddr = row.ShortAddr || 'Unk';
        
        if (!groups[pic]) groups[pic] = {};
        if (!groups[pic][shortAddr]) groups[pic][shortAddr] = 0;
        groups[pic][shortAddr]++; 
    });
    return groups;
  }, [finalHandheldData]);

  const handleDragStart = (e, shortAddr) => {
    e.dataTransfer.setData('text/plain', shortAddr);
  };

  const handleDragOver = (e, pic) => {
    e.preventDefault();
    if (dragOverPic !== pic) setDragOverPic(pic);
  };

  const handleDragLeave = () => {
    setDragOverPic(null);
  };

  const handleDrop = (e, targetPic) => {
    e.preventDefault();
    setDragOverPic(null);
    const draggedShortAddr = e.dataTransfer.getData('text/plain');
    if (!draggedShortAddr) return;

    // 🔴 โยกพาร์ทที่มี ShortAddr ตรงกัน ไปเป็น PIC ใหม่ทั้งหมดแบบยกพวง
    setFinalHandheldData(prev => prev.map(row => 
      row.ShortAddr === draggedShortAddr ? { ...row, PIC: targetPic } : row
    ));
  };

  if (!previewData || previewData.length === 0) {
    return (
      <div className="bg-white border-2 border-dashed border-red-200 rounded-[32px] p-20 flex flex-col items-center justify-center text-center animate-in fade-in">
        <AlertCircle size={56} className="text-red-400 mb-4" />
        <h3 className="text-2xl font-bold text-dark mb-2">No Base Data Found</h3>
        <p className="text-gray-500 mb-6 max-w-md">You must generate or select a previous batch from the TBOS section before proceeding.</p>
        <button onClick={() => setUploadTab && setUploadTab('TBOS')} className="bg-dark text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-colors">Back to TBOS</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 w-full animate-in fade-in pb-10">
      
      {/* --- 1. Base Data Preview --- */}
      <div className="bg-white border border-gray-100 shadow-sm rounded-[32px] p-10 flex flex-col">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-dark mb-2">1. Handheld Base Preview</h2>
            <p className="text-sm text-gray-500">Using Raw Data from Batch: <span className="font-mono text-primary font-bold px-2 py-1 bg-orange-50 rounded-md">{currentBatchId}</span></p>
          </div>
          <button onClick={handleLoadHandheldPreview} className="bg-primary text-white px-6 py-3 rounded-xl font-bold hover:scale-105 transition-all shadow-md flex items-center gap-2">
            {step === 'generating' && !addrFileUploaded ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />} Generate Base Format
          </button>
        </div>
        
        {handheldPreview ? (
          <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-[400px]">
            <table className="w-full text-left text-xs whitespace-nowrap relative border-collapse">
              <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm border-b border-gray-200">
                <tr className="text-gray-500 uppercase tracking-wider bg-gray-100">
                  <th className="px-4 py-3">Shop</th><th className="px-4 py-3">Dock</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">S.plant</th><th className="px-4 py-3">S.dock</th><th className="px-4 py-3">Part no.</th><th className="px-4 py-3">Part name</th><th className="px-4 py-3">kbn</th><th className="px-4 py-3">Q'ty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {handheldPreview.slice(0, 50).map((r, i) => (
                  <tr key={i} className="hover:bg-orange-50/50">
                    <td className="px-4 py-3 font-bold">{r['Shop']}</td><td className="px-4 py-3">{r['Dock']}</td><td className="px-4 py-3">{r['Supplier']}</td><td className="px-4 py-3">{r['S.plant']}</td><td className="px-4 py-3">{r['S.dock']}</td><td className="px-4 py-3">{r['Part no.']}</td><td className="px-4 py-3 truncate max-w-[150px]">{r['Part name']}</td><td className="px-4 py-3">{r['kbn']}</td><td className="px-4 py-3">{r['Q\'ty']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="w-full bg-gray-50 rounded-2xl p-20 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 text-gray-400">
            <p>Click the button above to generate the Base format.</p>
          </div>
        )}
      </div>

      {/* --- 2. Addr Upload & Final Result --- */}
      {handheldPreview && (
        <div className="bg-white border border-gray-100 shadow-sm rounded-[32px] p-10 flex flex-col animate-in fade-in slide-in-from-bottom-4">
          <div className="flex flex-col gap-2 mb-8">
            <h2 className="text-2xl font-bold text-dark tracking-tight">2. Address Assignment & PIC Setup</h2>
            <p className="text-sm text-gray-500">Upload <span className="font-bold text-dark">Part addr.xls</span> to assign Address and PIC.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-8">
            <div onClick={() => fileInputRef.current.click()} className={`bg-white border-2 border-dashed rounded-[32px] p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${addrFileUploaded ? 'border-success bg-green-50/30' : 'hover:border-primary'}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${addrFileUploaded ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-orange-50 text-primary'}`}>
                {addrFileUploaded ? <CheckCircle2 size={28} /> : <MapPin size={28} />}
              </div>
              <div className="text-center">
                <h3 className={`font-bold ${addrFileUploaded ? 'text-success' : 'text-dark'}`}>Part addr.xls</h3>
                <p className="text-[10px] text-gray-400">{addrFileUploaded ? 'Data Assigned Successfully' : 'Click to upload Excel'}</p>
              </div>
            </div>
            <input type="file" accept=".xls,.xlsx" ref={fileInputRef} onChange={handleUploadAddr} className="hidden" />
          </div>

          {finalHandheldData && (
            <div className="flex flex-col gap-8 mt-4">
              
              <div className="flex justify-between items-center bg-gray-50 border border-gray-200 px-6 py-4 rounded-2xl">
                <div>
                  <h3 className="font-bold text-dark">PIC Configuration</h3>
                  <p className="text-xs text-gray-500">Enable this to manually drag and drop address groups to different PICs.</p>
                </div>
                {/* 🔴 ปุ่มเปิด/ปิด แผง Drag & Drop */}
                <button 
                  onClick={() => setShowPicManager(!showPicManager)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${showPicManager ? 'bg-dark text-white' : 'bg-white border-2 border-gray-200 text-dark hover:border-primary'}`}
                >
                  <Settings2 size={16} />
                  {showPicManager ? 'Close PIC Manager' : 'Reassign PIC'}
                </button>
              </div>

              {/* 🔴 แผง Drag & Drop (จะโชว์ก็ต่อเมื่อกดปุ่ม) */}
              {showPicManager && (
                <div className="bg-orange-50/50 p-6 rounded-2xl border border-orange-200 animate-in zoom-in-95">
                  <h3 className="font-bold text-dark mb-4 flex items-center gap-2"><GripVertical size={20} className="text-primary"/> Drag & Drop Address Groups</h3>
                  <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
                    {Object.entries(picGroups).map(([pic, addrMap]) => (
                      <div 
                        key={pic}
                        onDragOver={(e) => handleDragOver(e, pic)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, pic)}
                        className={`min-w-[200px] bg-white rounded-xl p-4 shadow-sm border-2 transition-all snap-start
                          ${dragOverPic === pic ? 'border-primary bg-orange-100 scale-105' : 'border-transparent'}`}
                      >
                        <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
                          <h4 className="font-bold text-dark text-lg">PIC: <span className="text-primary">{pic}</span></h4>
                          <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-full">{Object.keys(addrMap).length} Addr</span>
                        </div>
                        
                        <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto pr-1">
                          {Object.entries(addrMap).map(([shortAddr, count]) => (
                            <div 
                              key={shortAddr}
                              draggable
                              onDragStart={(e) => handleDragStart(e, shortAddr)}
                              className="bg-gray-50 border border-gray-200 p-2.5 rounded-lg flex justify-between items-center cursor-grab active:cursor-grabbing hover:border-primary hover:text-primary transition-colors group"
                            >
                              <span className="font-mono text-sm font-bold group-hover:text-primary">
                                {shortAddr} {/* 🔴 โชว์แค่ตัวย่อ 2-3 ตัวตามที่คุณต้องการ ไม่มีจุดไข่ปลาแล้ว */}
                              </span>
                              <span className="text-[10px] bg-white border border-gray-100 px-1.5 py-0.5 rounded text-gray-400 font-bold">
                                {count} items
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🔴 ตารางหลัก Final Result */}
              <div className="overflow-x-auto border border-gray-200 rounded-xl animate-in fade-in">
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                  <h3 className="font-bold text-dark">Final Handheld Format Preview</h3>
                  <span className="text-xs font-bold bg-primary text-white px-3 py-1 rounded-full shadow-sm">Total: {finalHandheldData.length} Rows</span>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-white sticky top-0 shadow-sm border-b border-gray-200 z-10">
                      <tr className="text-gray-500 uppercase">
                        <th className="px-4 py-3 bg-gray-100">Shop</th><th className="px-4 py-3">Dock</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Part no.</th><th className="px-4 py-3">Part name</th><th className="px-4 py-3 text-blue-600 font-bold bg-blue-50/50">Address</th><th className="px-4 py-3 text-orange-600 font-bold bg-orange-50/50">PIC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {finalHandheldData.slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-bold bg-gray-50/50">{r.Shop}</td><td className="px-4 py-3">{r.Dock}</td><td className="px-4 py-3">{r.Supplier}</td><td className="px-4 py-3">{r['Part no.']}</td><td className="px-4 py-3 truncate max-w-[150px]">{r['Part name']}</td>
                          <td className="px-4 py-3 text-blue-700 font-medium bg-blue-50/20">{r.Addr}</td>
                          <td className="px-4 py-3 font-bold text-orange-600 bg-orange-50/20">
                            <span className="bg-white border border-orange-200 px-2 py-0.5 rounded shadow-sm">{r.PIC}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Exception Boxes */}
              {(remindData.length > 0 || holdData.length > 0) && (
                <div className="flex gap-6">
                  {remindData.length > 0 && (
                    <div className="flex-1 bg-red-50/50 border border-red-100 rounded-xl p-6">
                      <div className="flex items-center gap-2 text-red-600 mb-4">
                        <AlertTriangle size={20} />
                        <h3 className="font-bold">Missing in Part Procure (Remind)</h3>
                        <span className="ml-auto text-xs font-bold bg-red-100 px-2 py-1 rounded-md">{remindData.length} items</span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto border border-red-100 rounded-lg bg-white">
                        <table className="w-full text-left text-[10px] whitespace-nowrap">
                          <thead className="bg-red-50 sticky top-0"><tr className="text-red-500 uppercase"><th className="px-3 py-2">Dock</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Part No</th><th className="px-3 py-2">Source</th></tr></thead>
                          <tbody className="divide-y divide-red-50">
                            {remindData.map((r, i) => (
                              <tr key={i} className="hover:bg-red-50/30">
                                <td className="px-3 py-2 font-medium">{r['Dock IH']}</td><td className="px-3 py-2">{r.Supplier}</td><td className="px-3 py-2">{r['Part No']}</td><td className="px-3 py-2">{r.Source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {holdData.length > 0 && (
                    <div className="flex-1 bg-orange-50/50 border border-orange-100 rounded-xl p-6">
                      <div className="flex items-center gap-2 text-orange-600 mb-4">
                        <AlertTriangle size={20} />
                        <h3 className="font-bold">Missing in Address Master (Hold)</h3>
                        <span className="ml-auto text-xs font-bold bg-orange-100 px-2 py-1 rounded-md">{holdData.length} items</span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto border border-orange-100 rounded-lg bg-white">
                        <table className="w-full text-left text-[10px] whitespace-nowrap">
                          <thead className="bg-orange-50 sticky top-0"><tr className="text-orange-500 uppercase"><th className="px-3 py-2">Dock</th><th className="px-3 py-2">Part No</th><th className="px-3 py-2">Part Name</th></tr></thead>
                          <tbody className="divide-y divide-orange-50">
                            {holdData.map((r, i) => (
                              <tr key={i} className="hover:bg-orange-50/30">
                                <td className="px-3 py-2 font-medium">{r.Dock}</td><td className="px-3 py-2">{r['Part No']}</td><td className="px-3 py-2 truncate max-w-[150px]">{r['Part Name']}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HandheldManager;