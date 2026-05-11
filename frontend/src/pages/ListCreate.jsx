import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, FileSpreadsheet, Database, Loader2, Download, 
  X, CheckSquare, Square, Merge, History, Plus, Filter, 
  ArrowRight, AlertCircle, MapPin, AlertTriangle
} from 'lucide-react';

const generateBatchId = () => {
  const d = new Date();
  return `B-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
};

const ListCreate = ({ activeTab, setUploadTab }) => { 
  const [subTab, setSubTab] = useState('new'); 
  const [currentBatchId, setCurrentBatchId] = useState('');
  const [historyBatches, setHistoryBatches] = useState([]);
  const [step, setStep] = useState('idle'); 
  const [uploadStatus, setUploadStatus] = useState({ target: false, proc: false });
  const [previewData, setPreviewData] = useState([]);
  const [selectedPreviewGroup, setSelectedPreviewGroup] = useState('All'); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [downloadFiles, setDownloadFiles] = useState([]);

  // State สำหรับหน้า Handheld
  const [handheldPreview, setHandheldPreview] = useState(null);
  const [addrFileUploaded, setAddrFileUploaded] = useState(false);
  const [finalHandheldData, setFinalHandheldData] = useState(null);
  
  // State สำหรับเก็บข้อมูล Error/Exception
  const [holdData, setHoldData] = useState([]);
  const [remindData, setRemindData] = useState([]);

  const fileInputRef1 = useRef(null);
  const fileInputRef2 = useRef(null);
  const fileInputRef3 = useRef(null); 

  // 🔴 จุดแก้บั๊ก: เปลี่ยนเงื่อนไขเพื่อไม่ให้ล้าง Batch ID ทิ้งเวลาสลับหน้า
  useEffect(() => { 
    if (activeTab === 'TBOS') {
      if (!currentBatchId) {
        setCurrentBatchId(generateBatchId());
      }
      fetchHistory();
    }
  }, [activeTab]);

  const resetUpload = () => {
    setStep('idle');
    setUploadStatus({ target: false, proc: false });
    setCurrentBatchId(generateBatchId()); 
    setPreviewData([]);
    setSelectedPreviewGroup('All'); 
    setDownloadFiles([]); 
    
    setHandheldPreview(null); 
    setAddrFileUploaded(false);
    setFinalHandheldData(null);
    setHoldData([]);
    setRemindData([]);
  };

  const fetchHistory = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/batches/list');
      if (response.ok) {
        const data = await response.json();
        setHistoryBatches(data);
      }
    } catch (err) { console.error("Failed to fetch history", err); }
  };

  const handleDeleteBatch = async (batchId) => {
    if(!window.confirm(`Are you sure you want to delete Batch: ${batchId}?`)) return;
    try {
      const response = await fetch(`http://localhost:3000/api/batches/${batchId}`, { method: 'DELETE' });
      
      if (response.ok) {
        // ถ้า Backend ตอบกลับมาว่าลบสำเร็จ ให้สั่งดึงข้อมูลประวัติใหม่เพื่ออัปเดตตารางทันที
        fetchHistory(); 
      } else {
        alert("Failed to delete batch (Backend Error).");
      }
    } catch (err) { 
      alert("Failed to connect to server."); 
    }
  };

  const handlePreviewHistory = (batchId) => {
    setCurrentBatchId(batchId); 
    setUploadStatus({ target: true, proc: true }); 
    setSubTab('new'); 
    setSelectedPreviewGroup('All'); 
    
    setHandheldPreview(null); 
    setAddrFileUploaded(false);
    setFinalHandheldData(null);
    setHoldData([]);
    setRemindData([]);

    handleMergeData(batchId); 
  };

  const handleFileChangeBox1 = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchId', currentBatchId); 
    try {
      setStep('generating');
      const response = await fetch('http://localhost:3000/api/part-list/target-ro', { method: 'POST', body: formData });
      if (response.ok) { 
        setUploadStatus(prev => ({ ...prev, target: true })); 
        setStep('idle'); 
        fetchHistory(); // 🔴 ให้โหลดประวัติใหม่ทันทีที่อัปโหลดเสร็จ
      } 
      else { alert("Upload Target R/O Failed!"); setStep('idle'); }
    } catch (err) { alert("Server Error!"); setStep('idle'); }
    e.target.value = null; 
  };

  const handleFileChangeBox2 = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchId', currentBatchId); 
    try {
      setStep('generating');
      const response = await fetch('http://localhost:3000/api/part-list/part-procurement', { method: 'POST', body: formData });
      if (response.ok) { 
        setUploadStatus(prev => ({ ...prev, proc: true })); 
        setStep('idle'); 
        fetchHistory(); // 🔴 ให้โหลดประวัติใหม่ทันทีที่อัปโหลดเสร็จ
      } 
      else { alert("Upload Part Procurement Failed!"); setStep('idle'); }
    } catch (err) { alert("Server Error!"); setStep('idle'); }
    e.target.value = null; 
  };

  const handleMergeData = async (batchIdToMerge = currentBatchId) => {
    try {
      setStep('generating');
      const response = await fetch(`http://localhost:3000/api/part-list/preview-main?batchId=${batchIdToMerge}`);
      const result = await response.json();
      if (response.ok) {
        setPreviewData(result.data);
        const uniqueGroups = [...new Set(result.data.map(item => item['Group ID*']))].filter(Boolean);
        const dynamicGroupOptions = uniqueGroups.map((grp, index) => ({ id: `grp_${index}`, label: `Group: ${grp}`, value: grp, isChecked: true }));
        setDownloadFiles(dynamicGroupOptions); 
        setStep('preview');
      } else { alert("Merge Failed!"); setStep('idle'); }
    } catch (error) { alert("Server Error during merge!"); setStep('idle'); }
  };

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

  const handleToggleFile = (id) => setDownloadFiles(prev => prev.map(f => f.id === id ? { ...f, isChecked: !f.isChecked } : f));
  const isAllChecked = downloadFiles.length > 0 && downloadFiles.every(f => f.isChecked);
  const handleToggleAll = () => setDownloadFiles(prev => prev.map(f => ({ ...f, isChecked: !isAllChecked })));

  const handleConfirmDownload = async () => {
    const selectedGroups = downloadFiles.filter(f => f.isChecked).map(f => f.value);
    if (selectedGroups.length === 0) { alert("Please select at least one group to download."); return; }
    const groupsQuery = encodeURIComponent(selectedGroups.join(','));
    window.location.href = `http://localhost:3000/api/part-list/download-main?batchId=${currentBatchId}&groups=${groupsQuery}`;
    setIsModalOpen(false);
  };

  const tableHeaders = previewData.length > 0 ? Object.keys(previewData[0]) : [];
  const uniqueGroupsForDropdown = [...new Set(previewData.map(item => item['Group ID*']))].filter(Boolean);
  const filteredPreviewData = selectedPreviewGroup === 'All' ? previewData : previewData.filter(item => item['Group ID*'] === selectedPreviewGroup);

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500 pb-10">
      
      {/* ================= TBOS TAB ================= */}
      {activeTab === 'TBOS' ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold text-dark tracking-tight">Generate Part List (TBOS)</h2>
            <p className="text-sm text-gray-500">Upload and manage your inventory data batches.</p>
          </div>

          <div className="flex items-center gap-6 border-b border-gray-200 pb-0">
            <button onClick={() => { setSubTab('new'); if(step !== 'preview') resetUpload(); }} className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'new' ? 'text-primary border-primary' : 'text-gray-400 border-transparent hover:text-dark hover:border-gray-300'}`}><Plus size={18} /> New Upload</button>
            <button onClick={() => { setSubTab('history'); fetchHistory(); }} className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'history' ? 'text-primary border-primary' : 'text-gray-400 border-transparent hover:text-dark hover:border-gray-300'}`}><History size={18} /> Upload History</button>
          </div>

          {subTab === 'new' && (
            <div className="flex flex-col gap-6 animate-in fade-in">
              {(step === 'idle' || step === 'generating') && (
                <div className="flex flex-col items-center gap-8">
                  <div className="w-full bg-white px-6 py-3 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-500">Current Batch ID:</span>
                    <span className="text-sm font-mono bg-gray-100 px-3 py-1 rounded-md text-dark">{currentBatchId}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
                    <div onClick={() => fileInputRef1.current.click()} className={`bg-white border-2 border-dashed rounded-[32px] p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${uploadStatus.target ? 'border-success bg-green-50/30' : 'hover:border-primary'}`}>
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${uploadStatus.target ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-orange-50 text-primary'}`}>
                        {uploadStatus.target ? <CheckCircle2 size={28} /> : <FileSpreadsheet size={28} />}
                      </div>
                      <div className="text-center">
                        <h3 className={`font-bold ${uploadStatus.target ? 'text-success' : 'text-dark'}`}>1. Target R/O</h3>
                        <p className="text-[10px] text-gray-400">{uploadStatus.target ? 'Saved to Database' : 'Click to upload Excel'}</p>
                      </div>
                    </div>
                    <input type="file" accept=".xls,.xlsx" ref={fileInputRef1} onChange={handleFileChangeBox1} className="hidden" />

                    <div onClick={() => fileInputRef2.current.click()} className={`bg-white border-2 border-dashed rounded-[32px] p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${uploadStatus.proc ? 'border-success bg-green-50/30' : 'hover:border-primary'}`}>
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${uploadStatus.proc ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-orange-50 text-primary'}`}>
                        {uploadStatus.proc ? <CheckCircle2 size={28} /> : <Database size={28} />}
                      </div>
                      <div className="text-center">
                        <h3 className={`font-bold ${uploadStatus.proc ? 'text-success' : 'text-dark'}`}>2. Part Procurement</h3>
                        <p className="text-[10px] text-gray-400">{uploadStatus.proc ? 'Saved to Database' : 'Click to upload Excel'}</p>
                      </div>
                    </div>
                    <input type="file" accept=".xls,.xlsx" ref={fileInputRef2} onChange={handleFileChangeBox2} className="hidden" />
                  </div>

                  {uploadStatus.target && uploadStatus.proc && step !== 'generating' && (
                    <button onClick={() => handleMergeData(currentBatchId)} className="bg-dark text-white px-10 py-4 rounded-full font-bold shadow-xl shadow-dark/20 hover:bg-primary transition-all flex items-center gap-2 animate-in zoom-in">
                      <Merge size={20} /> Merge & Generate Preview
                    </button>
                  )}
                  {step === 'generating' && (
                    <div className="flex flex-col items-center gap-2 text-primary mt-4 animate-in fade-in">
                      <Loader2 size={32} className="animate-spin" />
                      <p className="font-bold text-sm">Processing Data...</p>
                    </div>
                  )}
                </div>
              )}

              {step === 'preview' && (
                <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                  <div className="px-6 py-4 border-b border-gray-100 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-gray-50/50">
                    <div className="flex flex-col">
                      <h3 className="font-bold text-dark">Main Format Preview ({filteredPreviewData.length} items)</h3>
                      <span className="text-xs text-gray-500">Batch ID: {currentBatchId}</span>
                    </div>
                    <div className="flex items-center gap-3 w-full lg:w-auto">
                      <div className="flex items-center bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm flex-1 lg:flex-none">
                        <Filter size={16} className="text-gray-400 mr-2" />
                        <select value={selectedPreviewGroup} onChange={(e) => setSelectedPreviewGroup(e.target.value)} className="bg-transparent text-sm font-medium text-dark focus:outline-none w-full cursor-pointer">
                          <option value="All">All Groups</option>
                          {uniqueGroupsForDropdown.map(grp => (<option key={grp} value={grp}>{grp}</option>))}
                        </select>
                      </div>
                      <button onClick={resetUpload} className="text-xs bg-gray-200 px-4 py-2 rounded-xl font-bold text-dark hover:bg-gray-300 transition-colors whitespace-nowrap">Reset</button>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-w-full max-h-[400px]">
                    <table className="w-full text-left text-xs whitespace-nowrap relative border-collapse">
                      <thead className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
                        <tr className="text-gray-400 uppercase tracking-tighter bg-gray-50/90 backdrop-blur-sm">
                          {tableHeaders.map((header, idx) => (<th key={idx} className="px-4 py-3 font-bold border-r border-gray-100 last:border-0">{header}</th>))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredPreviewData.slice(0, 50).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                            {tableHeaders.map((header, hIdx) => (<td key={hIdx} className="px-4 py-3 font-medium text-dark border-r border-gray-50 last:border-0">{String(row[header] || '')}</td>))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-6 bg-gray-50/80 flex justify-between items-center border-t border-gray-100">
                    <div><span className="text-sm font-medium text-gray-500">Ready for Handheld setup?</span></div>
                    <div className="flex gap-3">
                      <button onClick={() => setIsModalOpen(true)} className="bg-white border-2 border-dark text-dark px-6 py-3 rounded-xl font-bold hover:bg-gray-50 transition-colors flex items-center gap-2"><Download size={18} /> Download Excel</button>
                      <button onClick={() => setUploadTab && setUploadTab('Handheld')} className="bg-primary text-white px-8 py-3 rounded-xl font-bold shadow-md hover:scale-105 transition-all flex items-center gap-2">Next to Handheld <ArrowRight size={18} /></button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {subTab === 'history' && (
             <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-4 p-2">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                      <th className="px-6 py-4 rounded-tl-2xl">Batch ID</th>
                      <th className="px-6 py-4">Upload Date</th>
                      <th className="px-6 py-4 text-center">Records (Target / Proc)</th>
                      <th className="px-6 py-4 text-right rounded-tr-2xl">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {historyBatches && historyBatches.length > 0 ? (
                      historyBatches.map(b => (
                        <tr key={b.batch_id} className="hover:bg-orange-50/30 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-dark">{b.batch_id}</td>
                          <td className="px-6 py-4 text-gray-500">{new Date(b.upload_date).toLocaleString()}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-medium text-xs mr-2">{b.tg_count}</span> / 
                            <span className="bg-purple-50 text-purple-600 px-2 py-1 rounded-md font-medium text-xs ml-2">{b.pp_count}</span>
                          </td>
                          <td className="px-6 py-4 flex justify-end gap-3">
                            <button onClick={() => handlePreviewHistory(b.batch_id)} className="text-primary font-bold bg-orange-50 px-4 py-2 rounded-lg text-xs hover:bg-primary hover:text-white transition-colors shadow-sm">
                              Preview / Use
                            </button>
                            <button onClick={() => handleDeleteBatch(b.batch_id)} className="text-red-500 font-bold bg-red-50 px-4 py-2 rounded-lg text-xs hover:bg-red-500 hover:text-white transition-colors shadow-sm">
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4" className="text-center py-10 text-gray-400">No upload history found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (

        /* ================= HANDHELD TAB ================= */
        <div className="w-full h-full animate-in fade-in pb-10">
          {!previewData || previewData.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-red-200 rounded-[32px] p-20 flex flex-col items-center justify-center text-center">
              <AlertCircle size={56} className="text-red-400 mb-4" />
              <h3 className="text-2xl font-bold text-dark mb-2">No Base Data Found</h3>
              <p className="text-gray-500 mb-6 max-w-md">You must generate or select a previous batch from the TBOS section before proceeding.</p>
              <button onClick={() => setUploadTab && setUploadTab('TBOS')} className="bg-dark text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-colors">Back to TBOS</button>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              
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
                        {handheldPreview.slice(0, 100).map((r, i) => (
                          <tr key={i} className="hover:bg-orange-50/50">
                            <td className="px-4 py-3 font-bold">{r['Shop']}</td><td className="px-4 py-3">{r['Dock']}</td><td className="px-4 py-3">{r['Supplier']}</td><td className="px-4 py-3">{r['S.plant']}</td><td className="px-4 py-3">{r['S.dock']}</td><td className="px-4 py-3">{r['Part no.']}</td><td className="px-4 py-3">{r['Part name']}</td><td className="px-4 py-3">{r['kbn']}</td><td className="px-4 py-3">{r['Q\'ty']}</td>
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
                    <h2 className="text-2xl font-bold text-dark tracking-tight">2. Address Assignment</h2>
                    <p className="text-sm text-gray-500">Upload <span className="font-bold text-dark">Part addr.xls</span> to assign Address and PIC.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-8">
                    <div onClick={() => fileInputRef3.current.click()} className={`bg-white border-2 border-dashed rounded-[32px] p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${addrFileUploaded ? 'border-success bg-green-50/30' : 'hover:border-primary'}`}>
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${addrFileUploaded ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-orange-50 text-primary'}`}>
                        {addrFileUploaded ? <CheckCircle2 size={28} /> : <MapPin size={28} />}
                      </div>
                      <div className="text-center">
                        <h3 className={`font-bold ${addrFileUploaded ? 'text-success' : 'text-dark'}`}>Part addr.xls</h3>
                        <p className="text-[10px] text-gray-400">{addrFileUploaded ? 'Data Assigned Successfully' : 'Click to upload Excel'}</p>
                      </div>
                    </div>
                    <input type="file" accept=".xls,.xlsx" ref={fileInputRef3} onChange={handleUploadAddr} className="hidden" />
                  </div>

                  {/* 🔴 ตารางหลัก Final Result */}
                  {finalHandheldData && (
                    <div className="flex flex-col gap-6">
                      <div className="overflow-x-auto border border-gray-200 rounded-xl animate-in fade-in">
                        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                          <h3 className="font-bold text-dark">Final Handheld Format Preview</h3>
                          <span className="text-xs font-bold bg-primary text-white px-3 py-1 rounded-full shadow-sm">Total: {finalHandheldData.length} Rows</span>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto">
                          <table className="w-full text-left text-xs whitespace-nowrap">
                            <thead className="bg-white sticky top-0 shadow-sm border-b border-gray-200 z-10">
                              <tr className="text-gray-500 uppercase">
                                <th className="px-4 py-3 bg-gray-100">Shop</th><th className="px-4 py-3">Dock</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Part no.</th><th className="px-4 py-3">Part name</th><th className="px-4 py-3">KBN</th><th className="px-4 py-3 text-blue-600 font-bold bg-blue-50/50">Address</th><th className="px-4 py-3 text-orange-600 font-bold bg-orange-50/50">PIC</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {finalHandheldData.slice(0, 100).map((r, i) => (
                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-3 font-bold bg-gray-50/50">{r.Shop}</td><td className="px-4 py-3">{r.Dock}</td><td className="px-4 py-3">{r.Supplier}</td><td className="px-4 py-3">{r['Part no.']}</td><td className="px-4 py-3">{r['Part name']}</td><td className="px-4 py-3">{r.kbn}</td><td className="px-4 py-3 text-blue-700 font-medium bg-blue-50/20">{r.Addr}</td><td className="px-4 py-3 text-orange-600 font-bold bg-orange-50/20">{r.PIC}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 🔴 ส่วนแสดงผล Exception Records (Remind & Hold) */}
                      {(remindData.length > 0 || holdData.length > 0) && (
                        <div className="flex gap-6 mt-4">
                          
                          {/* กล่อง Remind Data */}
                          <div className="flex-1 bg-red-50/50 border border-red-100 rounded-xl p-6">
                            <div className="flex items-center gap-2 text-red-600 mb-4">
                              <AlertTriangle size={20} />
                              <h3 className="font-bold">Missing in Part Procurement (Remind)</h3>
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

                          {/* กล่อง Hold Data */}
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

                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* ================= DOWNLOAD POPUP MODAL ================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[24px] p-8 w-[400px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors"><X size={20} /></button>
            <h3 className="text-xl font-bold text-dark mb-2">Download Options</h3>
            <p className="text-sm text-gray-500 mb-6">Batch ID: <span className="font-mono text-xs">{currentBatchId}</span></p>

            <div className="flex flex-col gap-2 mb-8">
              <div onClick={handleToggleAll} className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-100 hover:border-primary/50 hover:bg-orange-50/50 cursor-pointer transition-all group">
                {isAllChecked ? <CheckSquare size={20} className="text-primary" /> : <Square size={20} className="text-gray-300 group-hover:text-primary/50" />}
                <span className="font-bold text-dark select-none">Select All Groups ({downloadFiles.length})</span>
              </div>
              <div className="w-full h-px bg-gray-100 my-2"></div>
              <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto pr-2">
                {downloadFiles.map((file) => (
                  <div key={file.id} onClick={() => handleToggleFile(file.id)} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group">
                    {file.isChecked ? <CheckSquare size={18} className="text-primary" /> : <Square size={18} className="text-gray-300 group-hover:text-primary/50" />}
                    <span className={`text-sm font-medium select-none ${file.isChecked ? 'text-dark' : 'text-gray-500'}`}>{file.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">Cancel</button>
              <button onClick={handleConfirmDownload} className={`px-6 py-2.5 rounded-xl font-bold transition-all shadow-md ${downloadFiles.some(f => f.isChecked) ? 'bg-primary text-white hover:scale-105 shadow-primary/20' : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'}`}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListCreate;