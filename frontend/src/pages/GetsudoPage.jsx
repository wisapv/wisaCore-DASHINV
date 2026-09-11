import React, { useState, useEffect, useRef } from 'react';
import {
  Download, UploadCloud, Loader2, Search, CheckCircle2, AlertTriangle,
  FileSpreadsheet, ArrowRight, Plus, History, Eye, Trash2,
} from 'lucide-react';
import { API_BASE } from '../hooks/useActiveBatch';

const PREVIEW_COLUMNS = ['Source', 'Dock', 'Sup', 'Splant', 'Sdock', 'PartNo', 'PartName', 'KBN', 'Qty', 'PC_Addr', 'Addr01'];

// Ad-hoc counting ("Getsudo") — pick any part numbers on demand instead of
// going through the TBOS/Address-matching pipeline. No typing into this
// page: download the blank Target List template, fill in one part number
// per row, upload it back — matched against the whole-factory master file
// uploaded in Template Manager > NQC Master (this page never uploads that
// — see NqcMasterManager.jsx). Hands off to the shared Assign Handheld page
// — same as any other batch, but reachable via its own "Getsudo Assign"
// button below rather than a generic one, since this page never shows
// TBOS batches (see ListCreate.jsx's own history, which now excludes
// Getsudo batches the same way).
const GetsudoPage = ({ setActiveModule, onGoToAssign }) => {
  const fileInputRef = useRef(null);
  const [subTab, setSubTab] = useState('new'); // 'new' | 'history'
  const [masterStatus, setMasterStatus] = useState(null); // { count, updatedAt, dataMonth } | null

  const [uploading, setUploading] = useState(false);
  const [createResult, setCreateResult] = useState(null);
  const [createError, setCreateError] = useState('');

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewBatchId, setPreviewBatchId] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Two-click delete: first click asks the row to confirm ("Sure?"), a
  // second click on that same row actually deletes — no browser-native
  // confirm() popup, consistent with the rest of the app's own modals.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Getsudo's own "active batch" (most recently created — see
  // setGetsudoActiveBatch on the backend), independent of TBOS's active
  // batch. Drives the "Getsudo Assign" button below so it lands on the
  // right batch with one click, the same as TBOS's own assign flow.
  const [getsudoActiveBatchId, setGetsudoActiveBatchId] = useState(null);
  const loadGetsudoActiveBatch = () => {
    fetch(`${API_BASE}/api/getsudo/active-batch`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => setGetsudoActiveBatchId(result ? result.batchId : null))
      .catch((err) => console.error('Failed to load active Getsudo batch', err));
  };
  useEffect(() => { loadGetsudoActiveBatch(); }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/getsudo/master-status`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setMasterStatus)
      .catch((err) => console.error('Failed to load master status', err));
  }, []);

  const hasMaster = masterStatus && masterStatus.count > 0;

  const fetchHistory = () => {
    setHistoryLoading(true);
    fetch(`${API_BASE}/api/getsudo/batch-history`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => setHistory(result && result.data ? result.data : []))
      .catch((err) => console.error('Failed to load Getsudo batch history', err))
      .finally(() => setHistoryLoading(false));
  };

  const handleDownloadTemplate = () => {
    window.location.href = `${API_BASE}/api/getsudo/target-list-template`;
  };

  const handleNewBatch = () => {
    setCreateResult(null);
    setCreateError('');
    setSubTab('new');
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setCreateError('');
    setCreateResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/getsudo/create-batch-from-file`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the count list');
      setCreateResult(data);
      setGetsudoActiveBatchId(data.batchId); // backend just made this the Getsudo-active batch too
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handlePreviewBatch = async (batchId) => {
    setPreviewBatchId(batchId);
    setPreviewLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/getsudo/batch-preview?batchId=${encodeURIComponent(batchId)}`);
      const result = await res.json();
      setPreviewRows(result.data || []);
    } catch (err) {
      console.error('Failed to load batch preview', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDeleteBatch = async (batchId) => {
    setDeletingId(batchId);
    try {
      const res = await fetch(`${API_BASE}/api/getsudo/batch/${encodeURIComponent(batchId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setHistory((prev) => prev.filter((h) => h.batchId !== batchId));
      if (previewBatchId === batchId) { setPreviewBatchId(null); setPreviewRows([]); }
      if (getsudoActiveBatchId === batchId) setGetsudoActiveBatchId(null); // deleted batch can no longer be "the" active one
    } catch (err) {
      console.error('Failed to delete Getsudo batch', err);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const renderPreviewTable = (rows) => (
    <div className="overflow-auto border border-ink/10 rounded-xl bg-white max-h-[360px]">
      <table className="w-full text-left text-[11px] whitespace-nowrap">
        <thead className="bg-[#FAFAF7] sticky top-0">
          <tr className="text-muted uppercase">
            {PREVIEW_COLUMNS.map((c) => <th key={c} className="px-4 py-2.5 font-bold">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-[#FAFAF7]">
              {PREVIEW_COLUMNS.map((c) => <td key={c} className="px-4 py-2.5">{row[c]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="w-full flex flex-col gap-7 pb-16">

      {/* HERO HEADER */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-ink flex items-center justify-center flex-shrink-0 shadow-[0_8px_20px_rgba(20,20,15,0.18)]">
          <Search size={22} className="text-accent" />
        </div>
        <div>
          <p className="text-xs text-muted font-bold uppercase tracking-wide">Getsudo</p>
          <h1 className="font-display text-[28px] font-bold text-ink leading-none mt-1">Target List</h1>
          <p className="text-[12px] text-muted font-semibold mt-1.5">
            On-demand counting — pick any part numbers straight from the whole-factory database, no TBOS required.
          </p>
        </div>
      </div>

      {/* MASTER DATA STATUS (read-only — upload happens in Template Manager) */}
      <div
        className={`rounded-[18px] border px-5 py-4 flex items-center gap-3 ${
          hasMaster ? 'bg-white border-ink/[0.06]' : 'bg-amber-50 border-amber-200'
        }`}
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${hasMaster ? 'bg-accent/20' : 'bg-amber-100'}`}>
          {hasMaster ? <FileSpreadsheet size={16} className="text-ink" /> : <AlertTriangle size={16} className="text-amber-700" />}
        </div>
        <div className="flex-1 min-w-0">
          {hasMaster ? (
            <>
              <p className="text-[12.5px] font-bold text-ink">NQC Master Data Ready</p>
              <p className="text-[10.5px] text-muted font-semibold mt-0.5">
                Data for {masterStatus.dataMonth || '—'} · {masterStatus.count.toLocaleString()} parts loaded
              </p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-bold text-amber-800">No NQC Master Data Yet</p>
              <p className="text-[10.5px] text-amber-700 font-semibold mt-0.5">Upload it from Template Manager first before creating a Target List.</p>
            </>
          )}
        </div>
      </div>

      {/* TABS + NEW BATCH — same pattern as the TBOS page */}
      <div className="flex items-center justify-between border-b border-ink/10 pb-0">
        <div className="flex items-center gap-6">
          <button
            onClick={() => setSubTab('new')}
            className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'new' ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'}`}
          >
            <Plus size={18} /> New Target List
          </button>
          <button
            onClick={() => { setSubTab('history'); fetchHistory(); }}
            className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'history' ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'}`}
          >
            <History size={18} /> Upload History
          </button>
        </div>

        <button
          onClick={handleNewBatch}
          className="flex items-center gap-2 bg-ink text-accent px-5 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-colors mb-2"
        >
          <Plus size={16} /> New Batch
        </button>
      </div>

      {/* NEW TARGET LIST */}
      {subTab === 'new' && (
        <div className="bg-white rounded-[28px] p-7 border border-ink/[0.05] shadow-[0_2px_12px_rgba(20,20,15,0.04)]">
          <h2 className="font-display text-[18px] font-bold text-ink">Choose Parts to Count</h2>
          <p className="text-[12px] text-muted font-semibold mt-1.5">Any number of parts — nothing is fixed. Follow the three steps below.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="flex flex-col gap-2 bg-[#FAFAF7] rounded-2xl p-5 border border-ink/[0.05]">
              <div className="w-7 h-7 rounded-full bg-ink text-accent flex items-center justify-center text-[11px] font-bold">1</div>
              <p className="text-[12.5px] font-bold text-ink mt-1">Download the template</p>
              <p className="text-[10.5px] text-muted font-semibold leading-relaxed">A blank Excel file with one column, "Target part list".</p>
            </div>
            <div className="flex flex-col gap-2 bg-[#FAFAF7] rounded-2xl p-5 border border-ink/[0.05]">
              <div className="w-7 h-7 rounded-full bg-ink text-accent flex items-center justify-center text-[11px] font-bold">2</div>
              <p className="text-[12.5px] font-bold text-ink mt-1">Fill in part numbers</p>
              <p className="text-[10.5px] text-muted font-semibold leading-relaxed">One part number per row — as many rows as you need.</p>
            </div>
            <div className="flex flex-col gap-2 bg-[#FAFAF7] rounded-2xl p-5 border border-ink/[0.05]">
              <div className="w-7 h-7 rounded-full bg-ink text-accent flex items-center justify-center text-[11px] font-bold">3</div>
              <p className="text-[12.5px] font-bold text-ink mt-1">Upload it back here</p>
              <p className="text-[10.5px] text-muted font-semibold leading-relaxed">We match it against the NQC master and build the count list.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-7">
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2 bg-white border border-ink/15 text-ink px-6 py-3.5 rounded-xl font-bold text-[12px] hover:border-ink/30 hover:-translate-y-0.5 transition-all"
            >
              <Download size={16} />
              Download Template
            </button>

            <button
              onClick={() => fileInputRef.current.click()}
              disabled={uploading || !hasMaster}
              className="flex items-center gap-2 bg-ink text-accent px-6 py-3.5 rounded-xl font-bold text-[12px] shadow-[0_8px_20px_rgba(20,20,15,0.15)] hover:opacity-90 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
              {uploading ? 'Creating...' : 'Upload Target List'}
            </button>
            <input type="file" accept=".xlsx,.xls" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          </div>
          {!hasMaster && (
            <p className="text-[10.5px] text-amber-700 font-semibold mt-3">NQC Master Data is required before you can upload a Target List.</p>
          )}

          {createError && (
            <div className="mt-5 flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl p-4">
              <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-700 font-semibold">{createError}</p>
            </div>
          )}

          {createResult && (
            <div className="mt-6 rounded-2xl border border-accent/30 overflow-hidden">
              <div className="bg-accent/10 px-6 py-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ink flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={18} className="text-accent" />
                </div>
                <div>
                  <p className="text-[13.5px] font-bold text-ink">Count List Created</p>
                  <p className="text-[11px] text-muted font-semibold mt-0.5">
                    Matched {createResult.matchedCount} of {createResult.requestedCount} parts
                  </p>
                </div>
              </div>

              <div className="bg-white px-6 py-5 flex flex-col gap-4">
                <div className="flex items-center justify-between bg-[#FAFAF7] border border-ink/[0.06] rounded-xl px-4 py-3">
                  <span className="text-[10.5px] font-bold text-muted uppercase tracking-wide">Batch ID</span>
                  <span className="text-[11.5px] font-mono font-bold text-ink">{createResult.batchId}</span>
                </div>

                {createResult.notFound && createResult.notFound.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-red-600 mb-2">{createResult.notFound.length} part{createResult.notFound.length > 1 ? 's' : ''} not found:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {createResult.notFound.map((pn) => (
                        <span key={pn} className="text-[10.5px] font-mono font-semibold text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1">
                          {pn}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {createResult.previewRows && createResult.previewRows.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-ink mb-2">Matched data:</p>
                    {renderPreviewTable(createResult.previewRows)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* UPLOAD HISTORY */}
      {subTab === 'history' && (
        <div className="bg-white rounded-[28px] border border-ink/[0.05] shadow-[0_2px_12px_rgba(20,20,15,0.04)] overflow-hidden">
          {historyLoading ? (
            <div className="p-16 flex items-center justify-center text-muted"><Loader2 size={24} className="animate-spin" /></div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted font-semibold text-center py-16">No Target Lists created yet.</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[#FAFAF7]">
                <tr className="text-muted uppercase text-[10.5px]">
                  <th className="px-6 py-4 font-bold">Batch ID</th>
                  <th className="px-6 py-4 font-bold">Upload Date</th>
                  <th className="px-6 py-4 font-bold">Records</th>
                  <th className="px-6 py-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {history.map((h) => (
                  <React.Fragment key={h.batchId}>
                    <tr className="hover:bg-[#FAFAF7]">
                      <td className="px-6 py-4 font-mono font-bold text-ink">{h.batchId}</td>
                      <td className="px-6 py-4 text-muted font-semibold">{new Date(h.uploadDate).toLocaleString()}</td>
                      <td className="px-6 py-4 font-bold text-ink">{h.recordCount.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => handlePreviewBatch(previewBatchId === h.batchId ? null : h.batchId)}
                            className="inline-flex items-center gap-1.5 bg-accent/15 text-ink px-4 py-2 rounded-lg font-bold text-[11px] hover:bg-accent/25 transition-colors"
                          >
                            <Eye size={13} /> {previewBatchId === h.batchId ? 'Hide' : 'Preview'}
                          </button>
                          {confirmDeleteId === h.batchId ? (
                            <>
                              <button
                                onClick={() => handleDeleteBatch(h.batchId)}
                                disabled={deletingId === h.batchId}
                                className="inline-flex items-center gap-1.5 bg-red-500 text-white px-3 py-2 rounded-lg font-bold text-[11px] hover:bg-red-600 transition-colors disabled:opacity-60"
                              >
                                {deletingId === h.batchId ? <Loader2 size={13} className="animate-spin" /> : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[11px] font-bold text-muted hover:text-ink px-1"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(h.batchId)}
                              title="Delete this batch"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {previewBatchId === h.batchId && (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 bg-[#FAFAF7]">
                          {previewLoading ? (
                            <div className="py-6 flex justify-center text-muted"><Loader2 size={18} className="animate-spin" /></div>
                          ) : (
                            renderPreviewTable(previewRows)
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Outside every content card, bottom-right — jumps to the standalone
          Assign Handheld module, same idea as the TBOS pipeline's own
          "Run Out Assign" button. */}
      <div className="flex justify-end">
        <button
          onClick={() => (onGoToAssign ? onGoToAssign(getsudoActiveBatchId) : setActiveModule && setActiveModule('assign'))}
          className="flex items-center gap-2 bg-ink text-accent px-8 py-3.5 rounded-xl font-bold text-sm shadow-[0_8px_20px_rgba(20,20,15,0.15)] hover:opacity-90 hover:-translate-y-0.5 transition-all"
        >
          Getsudo Assign <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default GetsudoPage;