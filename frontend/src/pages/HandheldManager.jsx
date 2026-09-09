import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Database, Loader2, CheckCircle2, MapPin,
  AlertCircle, AlertTriangle, GripVertical, Settings2, Download, RefreshCw, ArrowRight
} from 'lucide-react';
import { SOCKET_EVENTS, API_BASE } from '../hooks/useActiveBatch';

const HandheldManager = ({ currentBatchId, previewData, isRestoringPreview, setUploadTab, subscribeToEvent, setActiveModule }) => {
  const [step, setStep] = useState('idle');
  const [handheldPreview, setHandheldPreview] = useState(null);
  const [addrFileUploaded, setAddrFileUploaded] = useState(false);
  const [finalHandheldData, setFinalHandheldData] = useState(null);

  const [holdData, setHoldData] = useState([]);
  const [remindData, setRemindData] = useState([]);

  const [showPicManager, setShowPicManager] = useState(false);
  const [dragOverPic, setDragOverPic] = useState(null);
  const [hasHandheldUpdate, setHasHandheldUpdate] = useState(false);
  const fileInputRef = useRef(null);

  const handleLoadHandheldPreview = useCallback(async () => {
    try {
      setStep('generating');
      const res = await fetch(`${API_BASE}/api/handheld/preview-handheld?batchId=${currentBatchId}`);
      const result = await res.json();
      if (res.ok) { setHandheldPreview(result.data); setHasHandheldUpdate(false); setStep('idle'); }
      else { alert("Failed to generate Handheld format"); setStep('idle'); }
    } catch { alert("Server Error"); setStep('idle'); }
  }, [currentBatchId]);

  // Restores the Base Preview (section 1) on mount — this is purely derived
  // from Target R/O + Part Procurement, both already persisted in the DB,
  // so unlike the address-assigned result below it survives a full page
  // reload, not just switching tabs within the app. No spinner/step change
  // (unlike the button above) and silent=true so the backend doesn't
  // broadcast HANDHELD_UPDATED back at this same client.
  //
  // What this deliberately does NOT restore: finalHandheldData / holdData /
  // remindData (the address-assigned result from uploading Part addr.xls)
  // and any manual PIC drag-and-drop reassignment — neither is persisted
  // anywhere server-side (process-assign-addr never writes to the DB, and
  // the PIC Manager's reassignments are local React state only, same as
  // the base preview's own live-update handling above already documents).
  // After a genuine reload those are honestly gone; Part addr.xls has to be
  // re-uploaded. Persisting them is a larger, separate piece of work.
  useEffect(() => {
    if (!currentBatchId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/handheld/preview-handheld?batchId=${currentBatchId}&silent=true`);
        if (cancelled) return;
        if (res.ok) {
          const result = await res.json();
          if (!cancelled) setHandheldPreview(result.data);
        }
        // A 404 (no raw data yet for this batch) is expected and left alone
        // — handheldPreview stays null, showing the normal pre-generate state.
      } catch (err) { console.error('Failed to restore handheld base preview', err); }
    })();
    return () => { cancelled = true; };
  }, [currentBatchId]);

  // Restores the address-assigned result (section 2: Kanban/Lineside rows,
  // PIC assignments, Hold/Remind) on mount from handheld_results — this is
  // now persisted server-side (process-assign-addr upserts it, and PIC
  // drag-and-drop reassignments save back to it too, see handleDrop below),
  // completing what the base-preview-only restore above used to leave as a
  // reported limitation. A 404 means process-assign-addr has never been run
  // for this batch — the normal "please upload Part addr.xls" prompt (Part
  // addr.xls) is left alone in that case, unchanged.
  useEffect(() => {
    if (!currentBatchId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/handheld-assign/final-data?batchId=${currentBatchId}`);
        if (cancelled) return;
        if (res.ok) {
          const result = await res.json();
          if (cancelled) return;
          setFinalHandheldData(result.data);
          setHoldData(result.hold);
          setRemindData(result.remind);
          setAddrFileUploaded(true);
        }
        // A 404 (process-assign-addr never run for this batch) is expected
        // and left alone — the normal upload prompt stays in place.
      } catch (err) { console.error('Failed to restore handheld final data', err); }
    })();
    return () => { cancelled = true; };
  }, [currentBatchId]);

  // Same-batch live updates. The base preview (a plain GET) can be safely
  // auto-refreshed, but only while the PIC Manager is closed — reassignments
  // made there are now saved to the backend (see handleDrop below), but
  // overwriting local state while the PIC Manager is open still risks
  // clobbering a reassignment mid-drag, so this stays deliberately
  // conservative there. The address/PIC results (finalHandheldData) can't be
  // silently refetched from a live-update push — the base data may have
  // changed too, and only re-uploading Address Master recomputes the match —
  // so that case just surfaces a non-blocking banner instead.
  useEffect(() => {
    const unsubscribe = subscribeToEvent(SOCKET_EVENTS.HANDHELD_UPDATED, (payload) => {
      if (payload.batchId !== currentBatchId) return;
      if (showPicManager) { setHasHandheldUpdate(true); return; }
      if (handheldPreview) { handleLoadHandheldPreview(); return; }
      setHasHandheldUpdate(true);
    });
    return unsubscribe;
  }, [currentBatchId, showPicManager, handheldPreview, subscribeToEvent, handleLoadHandheldPreview]);

  const handleUploadAddr = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchId', currentBatchId);

    try {
        setStep('generating');
        const res = await fetch(`${API_BASE}/api/handheld-assign/process-assign-addr`, { method: 'POST', body: formData });
        const result = await res.json();
        if (result.success) {
            setFinalHandheldData(result.data);
            setHoldData(result.hold);
            setRemindData(result.remind);
            setAddrFileUploaded(true);
            setHasHandheldUpdate(false);
            setStep('idle');
        } else { alert("Process Failed"); setStep('idle'); }
    } catch { alert("Upload Failed"); setStep('idle'); }
    e.target.value = null;
  };

  const handleDownloadExcel = async () => {
    if (!finalHandheldData || finalHandheldData.length === 0) return;

    try {
      const response = await fetch(`${API_BASE}/api/handheld-assign/export-excel`, {
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

  // Fire-and-forget, same as the base-preview restore's error handling —
  // the local reassignment already applied optimistically, so a failed save
  // here shouldn't interrupt the drag interaction with a blocking alert.
  const saveFinalDataToServer = async (data) => {
    try {
      await fetch(`${API_BASE}/api/handheld-assign/final-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: currentBatchId, data }),
      });
    } catch (err) { console.error('Failed to persist PIC reassignment', err); }
  };

  const handleDrop = (e, targetPic) => {
    e.preventDefault();
    setDragOverPic(null);
    const dataStr = e.dataTransfer.getData('application/json');
    if (!dataStr) return;

    try {
      const { shortAddr, sourcePic } = JSON.parse(dataStr);
      setFinalHandheldData(prev => {
        const next = prev.map(row =>
          (row.ShortAddr === shortAddr && row.PIC === sourcePic) ? { ...row, PIC: targetPic } : row
        );
        saveFinalDataToServer(next);
        return next;
      });
    } catch (err) { console.error(err); }
  };

  // previewData comes from TBOS's own mount-time restore (see ListCreate's
  // refreshPreviewDataSilently), which starts empty and only populates once
  // that fetch resolves. Without distinguishing "still restoring" from
  // "genuinely no data", a merged batch would flash — or on a slow/failed
  // restore, get permanently stuck on — the "No Base Data Found" prompt
  // below on every Home -> Upload remount, even though data is on its way.
  if (isRestoringPreview) {
    return (
      <div className="bg-white border-2 border-dashed border-ink/10 rounded-4xl p-20 flex flex-col items-center justify-center text-center animate-in fade-in">
        <Loader2 size={40} className="animate-spin text-muted mb-4" />
        <p className="text-muted">Restoring batch data…</p>
      </div>
    );
  }

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

      {hasHandheldUpdate && (
        <div className="bg-accent/10 border border-accent/30 rounded-2xl px-6 py-3 flex items-center justify-between gap-4 animate-in fade-in">
          <span className="text-sm font-bold text-ink">Handheld data for this batch was updated by another user.</span>
          <button onClick={handleLoadHandheldPreview} className="bg-ink text-accent px-4 py-2 rounded-xl font-bold text-sm hover:opacity-90 transition-colors flex items-center gap-2 whitespace-nowrap">
            <RefreshCw size={14} /> Refresh Base Preview
          </button>
        </div>
      )}

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
                <div className="bg-white p-6 rounded-2xl border border-ink/5 shadow-[0_2px_12px_rgba(20,20,15,0.04)] animate-in zoom-in-95">
                  <h3 className="font-bold text-ink mb-4 flex items-center gap-2"><GripVertical size={20} className="text-accent"/> Drag & Drop Address Groups</h3>
                  <div className="flex gap-4 overflow-x-auto p-2 snap-x">
                    {Object.entries(picGroups).map(([pic, addrMap]) => (
                      <div
                        key={pic}
                        onDragOver={(e) => handleDragOver(e, pic)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, pic)}
                        className={`min-w-[200px] bg-[#FAFAF7] rounded-xl p-4 shadow-sm border-2 transition-all snap-start
                          ${dragOverPic === pic ? 'border-accent bg-accent/10 scale-105' : 'border-transparent'}`}
                      >
                        <div className="flex justify-center items-center mb-4 py-2 rounded-xl bg-accent shadow-lg">
                          <h4 className="font-bold text-ink text-xl">{pic}</h4>
                        </div>

                        <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto p-1">
                          {Object.entries(addrMap).map(([shortAddr, count]) => (
                            <div
                              key={shortAddr}
                              draggable
                              onDragStart={(e) => handleDragStart(e, shortAddr, pic)}
                              className="bg-ink rounded-2xl p-2.5 flex justify-between items-center cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-accent transition-all group shadow-sm"
                            >
                              <span className="font-mono text-sm font-bold text-white">{shortAddr}</span>
                              <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-white/70 font-bold">{count} items</span>
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
                          <td className="px-4 py-3 font-bold text-ink">
                            <span className="inline-flex items-center justify-center bg-accent text-ink px-2.5 py-1 rounded-full text-xs font-bold shadow-sm">{r.PIC}</span>
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
                            {remindData.slice(0, 100).map((r, i) => (
                              <tr key={i} className="hover:bg-red-50/30">
                                <td className="px-3 py-2 font-medium">{r['Dock IH']}</td><td className="px-3 py-2">{r.Supplier}</td><td className="px-3 py-2">{r['Part No']}</td><td className="px-3 py-2">{r.Source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {remindData.length > 100 && (
                        <p className="text-[10px] text-red-400/80 mt-2">Showing first 100 of {remindData.length}.</p>
                      )}
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
                            {holdData.slice(0, 100).map((r, i) => (
                              <tr key={i} className="hover:bg-orange-50/30">
                                <td className="px-3 py-2 font-medium">{r.Dock}</td><td className="px-3 py-2">{r['Part No']}</td><td className="px-3 py-2 truncate max-w-[150px]">{r['Part Name']}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {holdData.length > 100 && (
                        <p className="text-[10px] text-orange-500/80 mt-2">Showing first 100 of {holdData.length}.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Outside every content card, bottom-right — the final step of the
          Part Runout pipeline (TBOS -> Handheld -> Assign Handheld). Jumps
          to the standalone Assign Handheld module, same as TBOS's own
          "Next" button does for Handheld. */}
      <div className="flex justify-end">
        <button
          onClick={() => setActiveModule && setActiveModule('assign')}
          className="flex items-center gap-2 bg-ink text-accent px-8 py-3.5 rounded-xl font-bold text-sm shadow-[0_8px_20px_rgba(20,20,15,0.15)] hover:opacity-90 hover:-translate-y-0.5 transition-all"
        >
          Run Out Assign <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default HandheldManager;