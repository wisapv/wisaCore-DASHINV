import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, FileSpreadsheet, Database, Loader2, Download,
  X, CheckSquare, Square, Merge, History, Plus, Filter,
  ArrowRight, AlertTriangle
} from 'lucide-react';
import HandheldManager from './HandheldManager';

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

  const [tbosRemindData, setTbosRemindData] = useState([]);

  const [selectedPreviewGroup, setSelectedPreviewGroup] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [downloadFiles, setDownloadFiles] = useState([]);

  const fileInputRef1 = useRef(null);
  const fileInputRef2 = useRef(null);

  useEffect(() => {
    if (activeTab === 'TBOS') {
      setCurrentBatchId(prev => prev ? prev : generateBatchId());
      fetchHistory();
    }
  }, [activeTab]);

  const resetUpload = () => {
    setStep('idle');
    setUploadStatus({ target: false, proc: false });
    setCurrentBatchId(generateBatchId());
    setPreviewData([]);
    setTbosRemindData([]);
    setSelectedPreviewGroup('All');
    setDownloadFiles([]);
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
      if (response.ok) fetchHistory();
      else alert("Failed to delete batch.");
    } catch (err) { alert("Failed to connect to server."); }
  };

  const handlePreviewHistory = (batchId) => {
    setCurrentBatchId(batchId);
    setUploadStatus({ target: true, proc: true });
    setSubTab('new');
    setSelectedPreviewGroup('All');
    setTbosRemindData([]);
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
        fetchHistory();
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
        fetchHistory();
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
        setTbosRemindData(result.remind || []);

        const uniqueGroups = [...new Set(result.data.map(item => item['Group ID*']))].filter(Boolean);
        const dynamicGroupOptions = uniqueGroups.map((grp, index) => ({ id: `grp_${index}`, label: `Group: ${grp}`, value: grp, isChecked: true }));
        setDownloadFiles(dynamicGroupOptions);
        setStep('preview');
      } else { alert("Merge Failed!"); setStep('idle'); }
    } catch (error) { alert("Server Error during merge!"); setStep('idle'); }
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

      {activeTab === 'TBOS' ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-2xl font-bold text-ink tracking-tight">Generate Part List (TBOS)</h2>
            <p className="text-sm text-muted">Upload and manage your inventory data batches.</p>
          </div>

          <div className="flex items-center gap-6 border-b border-ink/10 pb-0">
            <button onClick={() => { setSubTab('new'); if(step !== 'preview') resetUpload(); }} className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'new' ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'}`}><Plus size={18} /> New Upload</button>
            <button onClick={() => { setSubTab('history'); fetchHistory(); }} className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'history' ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'}`}><History size={18} /> Upload History</button>
          </div>

          {subTab === 'new' && (
            <div className="flex flex-col gap-6 animate-in fade-in">
              {(step === 'idle' || step === 'generating') && (
                <div className="flex flex-col items-center gap-8">
                  <div className="w-full bg-white px-6 py-3 rounded-2xl border border-ink/5 shadow-[0_2px_10px_rgba(20,20,15,0.04)] flex justify-between items-center">
                    <span className="text-sm font-bold text-muted">Current Batch ID:</span>
                    <span className="text-sm font-mono bg-ink/5 px-3 py-1 rounded-md text-ink">{currentBatchId}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
                    <div onClick={() => fileInputRef1.current.click()} className={`bg-white border-2 border-dashed rounded-4xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${uploadStatus.target ? 'border-success bg-green-50/30' : 'border-ink/10 hover:border-ink/40'}`}>
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${uploadStatus.target ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-accent/20 text-ink'}`}>
                        {uploadStatus.target ? <CheckCircle2 size={28} /> : <FileSpreadsheet size={28} />}
                      </div>
                      <div className="text-center">
                        <h3 className={`font-bold ${uploadStatus.target ? 'text-success' : 'text-ink'}`}>1. Target R/O</h3>
                        <p className="text-[10px] text-muted">{uploadStatus.target ? 'Saved to Database' : 'Click to upload Excel'}</p>
                      </div>
                    </div>
                    <input type="file" accept=".xls,.xlsx" ref={fileInputRef1} onChange={handleFileChangeBox1} className="hidden" />

                    <div onClick={() => fileInputRef2.current.click()} className={`bg-white border-2 border-dashed rounded-4xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${uploadStatus.proc ? 'border-success bg-green-50/30' : 'border-ink/10 hover:border-ink/40'}`}>
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${uploadStatus.proc ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-accent/20 text-ink'}`}>
                        {uploadStatus.proc ? <CheckCircle2 size={28} /> : <Database size={28} />}
                      </div>
                      <div className="text-center">
                        <h3 className={`font-bold ${uploadStatus.proc ? 'text-success' : 'text-ink'}`}>2. Part Procurement</h3>
                        <p className="text-[10px] text-muted">{uploadStatus.proc ? 'Saved to Database' : 'Click to upload Excel'}</p>
                      </div>
                    </div>
                    <input type="file" accept=".xls,.xlsx" ref={fileInputRef2} onChange={handleFileChangeBox2} className="hidden" />
                  </div>

                  {uploadStatus.target && uploadStatus.proc && step !== 'generating' && (
                    <button onClick={() => handleMergeData(currentBatchId)} className="bg-ink text-accent px-10 py-4 rounded-full font-bold shadow-xl shadow-ink/20 hover:opacity-90 transition-all flex items-center gap-2 animate-in zoom-in">
                      <Merge size={20} /> Merge & Generate Preview
                    </button>
                  )}
                  {step === 'generating' && (
                    <div className="flex flex-col items-center gap-2 text-ink mt-4 animate-in fade-in">
                      <Loader2 size={32} className="animate-spin" />
                      <p className="font-bold text-sm">Processing Data...</p>
                    </div>
                  )}
                </div>
              )}

              {step === 'preview' && (
                <div className="flex flex-col gap-6">
                  <div className="bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                    <div className="px-6 py-4 border-b border-ink/5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-[#FAFAF7]">
                      <div className="flex flex-col">
                        <h3 className="font-bold text-ink">Main Format Preview ({filteredPreviewData.length} items)</h3>
                        <span className="text-xs text-muted">Batch ID: {currentBatchId}</span>
                      </div>
                      <div className="flex items-center gap-3 w-full lg:w-auto">
                        <div className="flex items-center bg-white border border-ink/10 rounded-xl px-3 py-1.5 shadow-[0_2px_10px_rgba(20,20,15,0.04)] flex-1 lg:flex-none">
                          <Filter size={16} className="text-muted mr-2" />
                          <select value={selectedPreviewGroup} onChange={(e) => setSelectedPreviewGroup(e.target.value)} className="bg-transparent text-sm font-medium text-ink focus:outline-none w-full cursor-pointer">
                            <option value="All">All Groups</option>
                            {uniqueGroupsForDropdown.map(grp => (<option key={grp} value={grp}>{grp}</option>))}
                          </select>
                        </div>
                        <button onClick={resetUpload} className="text-xs bg-ink/5 px-4 py-2 rounded-xl font-bold text-ink hover:bg-ink/10 transition-colors whitespace-nowrap">Reset</button>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-w-full max-h-[400px]">
                      <table className="w-full text-left text-xs whitespace-nowrap relative border-collapse">
                        <thead className="bg-white border-b border-ink/5 sticky top-0 z-10 shadow-sm">
                          <tr className="text-muted uppercase tracking-tighter bg-[#FAFAF7]/90 backdrop-blur-sm">
                            {tableHeaders.map((header, idx) => (<th key={idx} className="px-4 py-3 font-bold border-r border-ink/5 last:border-0">{header}</th>))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink/5">
                          {filteredPreviewData.slice(0, 50).map((row, idx) => (
                            <tr key={idx} className="hover:bg-[#FAFAF7]/50 transition-colors">
                              {tableHeaders.map((header, hIdx) => (<td key={hIdx} className="px-4 py-3 font-medium text-ink border-r border-ink/5 last:border-0">{String(row[header] || '')}</td>))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-6 bg-[#FAFAF7]/80 flex justify-between items-center border-t border-ink/5">
                      <div><span className="text-sm font-medium text-muted">Ready for Handheld setup?</span></div>
                      <div className="flex gap-3">
                        <button onClick={() => setIsModalOpen(true)} className="bg-white border-2 border-ink text-ink px-6 py-3 rounded-xl font-bold hover:bg-[#FAFAF7] transition-colors flex items-center gap-2"><Download size={18} /> Download Excel</button>
                        <button onClick={() => setUploadTab && setUploadTab('Handheld')} className="bg-ink text-accent px-8 py-3 rounded-xl font-bold shadow-md hover:scale-105 transition-all flex items-center gap-2">Next to Handheld <ArrowRight size={18} /></button>
                      </div>
                    </div>
                  </div>

                  {tbosRemindData && tbosRemindData.length > 0 && (
                    <div className="bg-red-50/50 border border-red-100 rounded-4xl p-6 animate-in fade-in slide-in-from-bottom-6">
                      <div className="flex items-center gap-2 text-red-600 mb-4">
                        <AlertTriangle size={24} />
                        <h3 className="font-bold text-lg">Missing in Part Procurement (Remind)</h3>
                        <span className="ml-auto text-sm font-bold bg-red-100 px-3 py-1.5 rounded-lg shadow-sm">Total: {tbosRemindData.length} items</span>
                      </div>
                      <p className="text-sm text-red-400 mb-4">The following items are missing from your uploaded Part Procurement file. Please check and upload a revised file if necessary.</p>

                      <div className="max-h-[300px] overflow-y-auto border border-red-100 rounded-xl bg-white shadow-sm">
                        <table className="w-full text-left text-[11px] whitespace-nowrap">
                          <thead className="bg-red-50 sticky top-0">
                            <tr className="text-red-500 uppercase tracking-wider">
                              <th className="px-4 py-3 border-b border-red-100">Dock IH</th>
                              <th className="px-4 py-3 border-b border-red-100">Supplier</th>
                              <th className="px-4 py-3 border-b border-red-100">Part No</th>
                              <th className="px-4 py-3 border-b border-red-100">Source</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-50">
                            {tbosRemindData.map((r, i) => (
                              <tr key={i} className="hover:bg-red-50/30 transition-colors">
                                <td className="px-4 py-3 font-medium text-ink">{r['Dock IH']}</td>
                                <td className="px-4 py-3 text-ink">{r.Supplier}</td>
                                <td className="px-4 py-3 font-mono text-ink">{r['Part No']}</td>
                                <td className="px-4 py-3 text-ink">{r.Source}</td>
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

          {subTab === 'history' && (
             <div className="bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4 p-2">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-[#FAFAF7] text-muted uppercase text-xs tracking-wider">
                      <th className="px-6 py-4 rounded-tl-2xl">Batch ID</th>
                      <th className="px-6 py-4">Upload Date</th>
                      <th className="px-6 py-4 text-center">Records (Target / Proc)</th>
                      <th className="px-6 py-4 text-right rounded-tr-2xl">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {historyBatches && historyBatches.length > 0 ? (
                      historyBatches.map(b => (
                        <tr key={b.batch_id} className="hover:bg-accent/10 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-ink">{b.batch_id}</td>
                          <td className="px-6 py-4 text-muted">{new Date(b.upload_date).toLocaleString()}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-medium text-xs mr-2">{b.tg_count}</span> /
                            <span className="bg-purple-50 text-purple-600 px-2 py-1 rounded-md font-medium text-xs ml-2">{b.pp_count}</span>
                          </td>
                          <td className="px-6 py-4 flex justify-end gap-3">
                            <button onClick={() => handlePreviewHistory(b.batch_id)} className="text-ink font-bold bg-accent/20 px-4 py-2 rounded-lg text-xs hover:bg-ink hover:text-accent transition-colors shadow-sm">
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
                        <td colSpan="4" className="text-center py-10 text-muted">No upload history found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <HandheldManager
          currentBatchId={currentBatchId}
          previewData={previewData}
          setUploadTab={setUploadTab}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-4xl p-8 w-[400px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-muted hover:text-ink transition-colors"><X size={20} /></button>
            <h3 className="font-display text-xl font-bold text-ink mb-2">Download Options</h3>
            <p className="text-sm text-muted mb-6">Batch ID: <span className="font-mono text-xs">{currentBatchId}</span></p>

            <div className="flex flex-col gap-2 mb-8">
              <div onClick={handleToggleAll} className="flex items-center gap-3 p-3 rounded-xl border-2 border-ink/5 hover:border-ink/20 hover:bg-accent/10 cursor-pointer transition-all group">
                {isAllChecked ? <CheckSquare size={20} className="text-ink" /> : <Square size={20} className="text-ink/20 group-hover:text-ink/40" />}
                <span className="font-bold text-ink select-none">Select All Groups ({downloadFiles.length})</span>
              </div>
              <div className="w-full h-px bg-ink/5 my-2"></div>
              <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto pr-2">
                {downloadFiles.map((file) => (
                  <div key={file.id} onClick={() => handleToggleFile(file.id)} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[#FAFAF7] cursor-pointer transition-colors group">
                    {file.isChecked ? <CheckSquare size={18} className="text-ink" /> : <Square size={18} className="text-ink/20 group-hover:text-ink/40" />}
                    <span className={`text-sm font-medium select-none ${file.isChecked ? 'text-ink' : 'text-muted'}`}>{file.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-muted hover:bg-[#FAFAF7] transition-colors">Cancel</button>
              <button onClick={handleConfirmDownload} className={`px-6 py-2.5 rounded-xl font-bold transition-all shadow-md ${downloadFiles.some(f => f.isChecked) ? 'bg-ink text-accent hover:scale-105' : 'bg-ink/10 text-ink/30 cursor-not-allowed shadow-none'}`}>
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
