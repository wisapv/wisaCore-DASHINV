import React, { useState, useRef, useMemo } from 'react';
import {
  Database, Loader2, CheckCircle2, MapPin,
  AlertCircle, AlertTriangle, GripVertical, Settings2, Download
} from 'lucide-react';

const HandheldManager = ({ currentBatchId, previewData, setUploadTab }) => {
  const [step, setStep] = useState('idle');
  const [handheldPreview, setHandheldPreview] = useState(null);
  const [addrFileUploaded, setAddrFileUploaded] = useState(false);
  const [finalHandheldData, setFinalHandheldData] = useState(null);

  const [holdData, setHoldData] = useState([]);
  const [remindData, setRemindData] = useState([]);

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

  const handleDownloadExcel = async () => {
    if (!finalHandheldData || finalHandheldData.length === 0) return;

    try {
      const response = await fetch('http://localhost:3000/api/handheld-assign/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: finalHandheldData,
          fileName: `Handheld_Format_${currentBatchId}`
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Handheld_Format_${currentBatchId}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        alert("Download Failed: Server responded with an error.");
      }
    } catch (err) {
      console.error(err);
      alert("Error connecting to server");
    }
  };

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

  const handleDragStart = (e, shortAddr, sourcePic) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ shortAddr, sourcePic }));
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
    const dataStr = e.dataTransfer.getData('application/json');
    if (!dataStr) return;

    try {
      const { shortAddr, sourcePic } = JSON.parse(dataStr);
      setFinalHandheldData(prev => prev.map(row =>
        (row.ShortAddr === shortAddr && row.PIC === sourcePic) ? { ...row, PIC: targetPic } : row
      ));
    } catch (err) { console.error(err); }
  };

  if (!previewData || previewData.length === 0) {
    return (
      <div className="bg-white border-2 border-dashed border-red-200 rounded-4xl p-20 flex flex-col items-center justify-center text-center animate-in fade-in">
        <AlertCircle size={56} className="text-red-400 mb-4" />
        <h3 className="font-display text-2xl font-bold text-ink mb-2">No Base Data Found</h3>
        <p className="text-muted mb-6 max-w-md">You must generate or select a previous batch from the TBOS section before proceeding.</p>
        <button onClick={() => setUploadTab && setUploadTab('TBOS')} className="bg-ink text-accent px-8 py-3 rounded-xl font-bold hover:opacity-90 transition-colors">Back to TBOS</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 w-full animate-in fade-in pb-10">

      {/* 1. Base Data Preview */}
      <div className="bg-white border border-ink/5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] rounded-4xl p-10 flex flex-col">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink mb-2">1. Handheld Base Preview</h2>
            <p className="text-sm text-muted">Using Raw Data from Batch: <span className="font-mono text-ink font-bold px-2 py-1 bg-accent/20 rounded-md">{currentBatchId}</span></p>
          </div>
          <button onClick={handleLoadHandheldPreview} className="bg-ink text-accent px-6 py-3 rounded-xl font-bold hover:scale-105 transition-all shadow-md flex items-center gap-2">
            {step === 'generating' && !addrFileUploaded ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />} Generate Base Format
          </button>
        </div>

        {handheldPreview ? (
          <div className="overflow-x-auto border border-ink/10 rounded-2xl max-h-[400px]">
            <table className="w-full text-left text-xs whitespace-nowrap relative border-collapse">
              {/* 🔴 แก้ไข: หัวตาราง 1 พื้นหลังดำ ตัวหนังสือขาว */}
              <thead className="bg-ink sticky top-0 z-10 shadow-md">
                <tr className="text-white/80 uppercase tracking-wider">
                  <th className="px-4 py-3 text-accent">Shop</th>
                  <th className="px-4 py-3">Dock</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">S.plant</th>
                  <th className="px-4 py-3">S.dock</th>
                  <th className="px-4 py-3">Part no.</th>
                  <th className="px-4 py-3">Part name</th>
                  <th className="px-4 py-3">kbn</th>
                  <th className="px-4 py-3">Q'ty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {handheldPreview.slice(0, 50).map((r, i) => (
                  <tr key={i} className="hover:bg-accent/10 transition-colors">
                    <td className="px-4 py-3 font-bold text-ink">{r['Shop']}</td>
                    <td className="px-4 py-3 text-ink">{r['Dock']}</td>
                    <td className="px-4 py-3 text-ink">{r['Supplier']}</td>
                    <td className="px-4 py-3 text-ink">{r['S.plant']}</td>
                    <td className="px-4 py-3 text-ink">{r['S.dock']}</td>
                    <td className="px-4 py-3 text-ink">{r['Part no.']}</td>
                    <td className="px-4 py-3 truncate max-w-[150px] text-ink">{r['Part name']}</td>
                    <td className="px-4 py-3 text-ink">{r['kbn']}</td>
                    <td className="px-4 py-3 text-ink">{r['Q\'ty']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="w-full bg-[#FAFAF7] rounded-2xl p-20 flex flex-col items-center justify-center border-2 border-dashed border-ink/10 text-muted">
            <p>Click the button above to generate the Base format.</p>
          </div>
        )}
      </div>

      {/* 2. Addr Upload & Final Result */}
      {handheldPreview && (
        <div className="bg-white border border-ink/5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] rounded-4xl p-10 flex flex-col animate-in fade-in slide-in-from-bottom-4">
          <div className="flex flex-col gap-2 mb-8">
            <h2 className="font-display text-2xl font-bold text-ink tracking-tight">2. Address Assignment & PIC Setup</h2>
            <p className="text-sm text-muted">Upload <span className="font-bold text-ink">Part addr.xls</span> to assign Address and PIC.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-8">
            <div onClick={() => fileInputRef.current.click()} className={`bg-white border-2 border-dashed rounded-4xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${addrFileUploaded ? 'border-success bg-green-50/30' : 'border-ink/10 hover:border-ink/40'}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${addrFileUploaded ? 'bg-success text-white shadow-md shadow-success/30' : 'bg-accent/20 text-ink'}`}>
                {addrFileUploaded ? <CheckCircle2 size={28} /> : <MapPin size={28} />}
              </div>
              <div className="text-center">
                <h3 className={`font-bold ${addrFileUploaded ? 'text-success' : 'text-ink'}`}>Part addr.xls</h3>
                <p className="text-[10px] text-muted">{addrFileUploaded ? 'Data Assigned Successfully' : 'Click to upload Excel'}</p>
              </div>
            </div>
            <input type="file" accept=".xls,.xlsx" ref={fileInputRef} onChange={handleUploadAddr} className="hidden" />
          </div>

          {finalHandheldData && (
            <div className="flex flex-col gap-8 mt-4">

              <div className="flex justify-between items-center bg-[#FAFAF7] border border-ink/10 px-6 py-4 rounded-2xl">
                <div>
                  <h3 className="font-bold text-ink">PIC & Data Management</h3>
                  <p className="text-xs text-muted">Manage assignments and export your final handheld configuration.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleDownloadExcel}
                    className="bg-white border-2 border-ink text-ink px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-accent/10 transition-all flex items-center gap-2"
                  >
                    <Download size={16} />
                    Download Excel
                  </button>
                  <button
                    onClick={() => setShowPicManager(!showPicManager)}
                    className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${showPicManager ? 'bg-ink text-accent' : 'bg-white border-2 border-ink/10 text-ink hover:border-ink/40'}`}
                  >
                    <Settings2 size={16} />
                    {showPicManager ? 'Close PIC Manager' : 'Reassign PIC'}
                  </button>
                </div>
              </div>

              {showPicManager && (
                <div className="bg-ink p-6 rounded-2xl border border-white/10 animate-in zoom-in-95">
                  <h3 className="font-bold text-white mb-4 flex items-center gap-2"><GripVertical size={20} className="text-accent"/> Drag & Drop Address Groups</h3>
                  <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
                    {Object.entries(picGroups).map(([pic, addrMap]) => (
                      <div
                        key={pic}
                        onDragOver={(e) => handleDragOver(e, pic)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, pic)}
                        className={`min-w-[200px] bg-white/10 rounded-xl p-4 shadow-sm border-2 transition-all snap-start
                          ${dragOverPic === pic ? 'border-accent bg-white/20 scale-105' : 'border-transparent'}`}
                      >
                        <div className="flex justify-center items-center mb-4 py-2 rounded-xl bg-accent shadow-lg">
                          <h4 className="font-bold text-ink text-xl">{pic}</h4>
                        </div>

                        <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto pr-1">
                          {Object.entries(addrMap).map(([shortAddr, count]) => (
                            <div
                              key={shortAddr}
                              draggable
                              onDragStart={(e) => handleDragStart(e, shortAddr, pic)}
                              className="bg-white rounded-2xl p-2.5 flex justify-between items-center cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-accent transition-all group shadow-sm"
                            >
                              <span className="font-mono text-sm font-bold text-ink">{shortAddr}</span>
                              <span className="text-[10px] bg-ink/5 px-2 py-0.5 rounded-full text-muted font-bold">{count} items</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto border border-ink/10 rounded-2xl animate-in fade-in">
                <div className="px-6 py-4 bg-ink border-b border-ink/10 flex justify-between items-center">
                  <h3 className="font-bold text-white">Final Handheld Format Preview</h3>
                  <span className="text-xs font-bold bg-accent text-ink px-3 py-1 rounded-full shadow-sm">Total: {finalHandheldData.length} Rows</span>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    {/* 🔴 แก้ไข: หัวตาราง 2 พื้นหลังดำ ตัวหนังสือขาว และปรับสี Address/PIC ให้สว่างขึ้น */}
                    <thead className="bg-[#FAFAF7] sticky top-0 ">
                      <tr className="text-ink font-bold uppercase">
                        <th className="px-4 py-3">Shop</th>
                        <th className="px-4 py-3">Dock</th>
                        <th className="px-4 py-3">Supplier</th>
                        <th className="px-4 py-3">Part no.</th>
                        <th className="px-4 py-3">Part name</th>
                        <th className="px-4 py-3">Address</th>
                        <th className="px-4 py-3">PIC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/10">
                      {finalHandheldData.slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:bg-[#FAFAF7] transition-colors">
                          <td className="px-4 py-3 font-bold bg-[#FAFAF7]/50 text-ink">{r.Shop}</td>
                          <td className="px-4 py-3 text-ink">{r.Dock}</td>
                          <td className="px-4 py-3 text-ink">{r.Supplier}</td>
                          <td className="px-4 py-3 text-ink">{r['Part no.']}</td>
                          <td className="px-4 py-3 truncate max-w-[150px] text-ink">{r['Part name']}</td>
                          <td className="px-4 py-3 text-blue-700 font-medium bg-blue-50/20">{r.Addr}</td>
                          <td className="px-4 py-3 font-bold text-ink bg-accent/10">
                            <span className="bg-white border border-accent/40 px-2 py-0.5 rounded shadow-sm">{r.PIC}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(remindData.length > 0 || holdData.length > 0) && (
                <div className="flex gap-6">
                  {remindData.length > 0 && (
                    <div className="flex-1 bg-red-50/50 border border-red-100 rounded-2xl p-6">
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
                    <div className="flex-1 bg-orange-50/50 border border-orange-100 rounded-2xl p-6">
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
