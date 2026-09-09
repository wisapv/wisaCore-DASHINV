import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CheckCircle2, FileSpreadsheet, Database, Loader2, Download,
  X, CheckSquare, Square, Merge, History, Plus, Filter,
  ArrowRight, AlertTriangle, ChevronDown, Pencil, RefreshCw, Users, PackagePlus, Star
} from 'lucide-react';
import HandheldManager from './HandheldManager';
import { useActiveBatch, SOCKET_EVENTS, API_BASE } from '../hooks/useActiveBatch';

const DEFAULT_GROUP_PREFIX = 'SR481D';
const INVALID_PREFIX_CHARS = /[/\\:*?"<>|]/;

function validatePrefixInput(value) {
  if (!value || value.trim() === '') return 'Group prefix cannot be empty.';
  const invalidChar = [...value].find((ch) => INVALID_PREFIX_CHARS.test(ch));
  if (invalidChar) return `Group prefix contains an invalid character: "${invalidChar}". Avoid / \\ : * ? " < > |`;
  return '';
}

const ListCreate = ({ activeTab, setUploadTab, setActiveModule }) => {
  const { activeBatchId, hasLoadedActiveBatch, isSocketConnected, subscribeToEvent, startNewBatch } = useActiveBatch();

  const [subTab, setSubTab] = useState('new');
  // Normally mirrors activeBatchId (the shared batch), but "Preview / Use"
  // in Upload History temporarily diverges it to browse a past batch
  // read-only — see isViewingHistoricalBatch below.
  const [currentBatchId, setCurrentBatchId] = useState('');
  const [isViewingHistoricalBatch, setIsViewingHistoricalBatch] = useState(false);
  const [historyBatches, setHistoryBatches] = useState([]);
  const [step, setStep] = useState('idle');
  const [uploadStatus, setUploadStatus] = useState({ target: false, proc: false });
  const [previewData, setPreviewData] = useState([]);
  // True until the mount-time restore below has settled (success, no-merge,
  // or error) for this ListCreate instance. HandheldManager gates its own
  // render on previewData, and previewData starts empty on every fresh mount
  // (Home -> Upload navigation fully remounts this component) — without this
  // flag, a merged batch would flash "No Base Data Found" on Handheld for
  // every mount until the fetch below resolves, and if that fetch ever fails
  // silently, Handheld would be stuck there permanently with no way to tell
  // "still loading" apart from "genuinely no data".
  const [isRestoringPreview, setIsRestoringPreview] = useState(true);

  const [tbosRemindData, setTbosRemindData] = useState([]);
  const [newPartsData, setNewPartsData] = useState([]);

  const [selectedPreviewGroup, setSelectedPreviewGroup] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [downloadFiles, setDownloadFiles] = useState([]);
  const [duplicateHeaderWarning, setDuplicateHeaderWarning] = useState('');
  const [groupPrefix, setGroupPrefix] = useState(DEFAULT_GROUP_PREFIX);
  const [groupPrefixError, setGroupPrefixError] = useState('');
  const [groupPrefixHistory, setGroupPrefixHistory] = useState([]);
  const [isPrefixDropdownOpen, setIsPrefixDropdownOpen] = useState(false);
  const [isNewPrefixModalOpen, setIsNewPrefixModalOpen] = useState(false);
  const [newPrefixInput, setNewPrefixInput] = useState('');
  const [newPrefixModalError, setNewPrefixModalError] = useState('');
  const [isSavingNewPrefix, setIsSavingNewPrefix] = useState(false);
  const [isEditPrefixModalOpen, setIsEditPrefixModalOpen] = useState(false);
  const [deletePrefixTarget, setDeletePrefixTarget] = useState(null);
  const [isDeletingPrefix, setIsDeletingPrefix] = useState(false);

  const fileInputRef1 = useRef(null);
  const fileInputRef2 = useRef(null);
  const prefixDropdownRef = useRef(null);
  const hasInitializedPrefixRef = useRef(false);
  const prevActiveBatchIdRef = useRef(undefined);

  const fetchGroupPrefixHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/part-list/group-prefix-history`);
      if (response.ok) {
        const data = await response.json();
        setGroupPrefixHistory(data);
        return data;
      }
    } catch (err) { console.error("Failed to fetch group prefix history", err); }
    return [];
  }, []);

  // Reflects a genuinely new active batch: clears every batch-scoped piece of
  // local view state, but deliberately leaves alone anything the "must not
  // disrupt in-progress local UI state" rule covers — no open modal is
  // touched here, subTab isn't forced, etc.
  const resetViewForNewBatch = useCallback(async () => {
    setStep('idle');
    setUploadStatus({ target: false, proc: false });
    setPreviewData([]);
    setTbosRemindData([]);
    setNewPartsData([]);
    setSelectedPreviewGroup('All');
    setDownloadFiles([]);
    setGroupPrefixError('');
    const history = await fetchGroupPrefixHistory();
    setGroupPrefix(history[0]?.prefix || DEFAULT_GROUP_PREFIX);
  }, [fetchGroupPrefixHistory]);

  const fetchHistory = useCallback(async (batchIdForStatus = currentBatchId) => {
    try {
      const response = await fetch(`${API_BASE}/api/batches/list`);
      if (response.ok) {
        const raw = await response.json();
        // Getsudo batches live in the same upload_batches table (so
        // Assign Handheld's batch-selector dropdown can see them), but
        // they don't belong in this TBOS-specific history view — see
        // GetsudoPage.jsx for their own Upload History.
        const data = raw.filter((b) => !b.batch_id.startsWith('GETSUDO-'));
        setHistoryBatches(data);
        if (batchIdForStatus) {
          const row = data.find((b) => b.batch_id === batchIdForStatus);
          if (row) setUploadStatus({ target: row.tg_count > 0, proc: row.pp_count > 0 });
        }
      }
    } catch (err) { console.error("Failed to fetch history", err); }
  }, [currentBatchId]);

  // Populates previewData from whatever's already on the server for this
  // batch — without this, a second user landing on the shared active batch
  // (or the Handheld tab, which gates on previewData) would see nothing
  // even though a teammate already merged it. Also this is the mechanism
  // that restores the preview step itself — see the mount-effect comment
  // below for how it interacts with App.jsx's mount/unmount behavior.
  //
  // Gated on result.hasBeenMerged, NOT on result.data.length > 0 — the
  // latter is true as soon as valid Target R/O + Part Procurement rows
  // exist, even if Merge was never actually clicked (buildMainFormatRows
  // computes straight from stored raw data, merge or no merge), so it can't
  // tell "genuinely merged" apart from "just uploaded". hasBeenMerged
  // reflects the batch's stored group_prefix, which the backend only ever
  // writes on a real Merge action — see mainFormatRoute.js.
  const refreshPreviewDataSilently = useCallback(async (batchId) => {
    if (!batchId) { setIsRestoringPreview(false); return; }
    try {
      const response = await fetch(`${API_BASE}/api/part-list/preview-main?batchId=${batchId}`);
      const result = await response.json();
      // Temporary diagnostic for the "TBOS doesn't restore to preview after
      // Home -> Upload navigation" report — remove once that's confirmed
      // fixed in real usage. Logs exactly what this restore call saw and
      // decided, so a live repro session shows whether the fetch even ran,
      // what hasBeenMerged actually was, and whether setStep('preview') was
      // reached at all.
      console.log('[TBOS restore] preview-main response', { batchId, ok: response.ok, hasBeenMerged: result?.hasBeenMerged, dataLength: result?.data?.length });
      if (response.ok && result.hasBeenMerged) {
        setPreviewData(result.data || []);
        setTbosRemindData(result.remind || []);
        setNewPartsData(result.newParts || []);
        const uniqueGroups = [...new Set((result.data || []).map((item) => item['Group ID*']))].filter(Boolean);
        setDownloadFiles(uniqueGroups.map((grp, index) => ({ id: `grp_${index}`, label: `Group: ${grp}`, value: grp, isChecked: true })));
        setStep('preview');
        console.log('[TBOS restore] restored to preview step', { batchId });
      } else {
        console.log('[TBOS restore] not restoring (either not ok or not yet merged)', { batchId });
      }
    } catch (err) {
      console.error("Failed to refresh preview data", err);
    } finally {
      setIsRestoringPreview(false);
    }
  }, []);

  // Keep currentBatchId in step with the shared active batch, except while
  // deliberately browsing a past batch from History. On a genuine change
  // (not the initial load) reset the local view — this is what makes
  // "Start New Batch" (or another user starting one) take effect here.
  //
  // NOTE: now that App.jsx keeps every module mounted and only toggles
  // visibility via CSS (instead of conditionally rendering/unmounting on
  // navigation), this effect no longer re-runs on every Home <-> Upload
  // switch — it only fires on true mount and on real activeBatchId changes.
  // refreshPreviewDataSilently is kept as-is (server-confirmed restore) since
  // it's still useful for a second user/tab landing on an existing batch.
  useEffect(() => {
    // Temporary diagnostic for the "TBOS doesn't restore to preview after
    // Home -> Upload navigation" report — remove once that's confirmed fixed
    // in real usage.
    console.log('[TBOS restore] mount effect fired', { activeBatchId, hasLoadedActiveBatch, isViewingHistoricalBatch });
    if (!hasLoadedActiveBatch || isViewingHistoricalBatch) return;

    const isFirstAssignment = prevActiveBatchIdRef.current === undefined;
    const changed = !isFirstAssignment && prevActiveBatchIdRef.current !== activeBatchId;
    prevActiveBatchIdRef.current = activeBatchId;
    console.log('[TBOS restore] mount effect deciding', { isFirstAssignment, changed, activeBatchId });

    setCurrentBatchId(activeBatchId || '');
    if (changed) resetViewForNewBatch();
    refreshPreviewDataSilently(activeBatchId);
  }, [activeBatchId, hasLoadedActiveBatch, isViewingHistoricalBatch, resetViewForNewBatch, refreshPreviewDataSilently]);

  useEffect(() => {
    if (activeTab === 'TBOS' && currentBatchId) {
      fetchHistory();
      fetchGroupPrefixHistory().then((history) => {
        if (!hasInitializedPrefixRef.current) {
          setGroupPrefix(history[0]?.prefix || DEFAULT_GROUP_PREFIX);
          hasInitializedPrefixRef.current = true;
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentBatchId]);

  // Cross-session live updates for the shared active batch. Refreshes
  // read-only/background data — the history list, upload-status flags
  // derived from it, and the underlying preview data — and, via
  // refreshPreviewDataSilently, jumps to the preview step once a real Merge
  // actually happened (same server-confirmed hasBeenMerged check as the
  // mount-time restore above), same as if the user had just clicked Merge
  // themselves. Never touches open modals, typed-but-unsubmitted prefix
  // input, or which sub-tab is currently showing.
  useEffect(() => {
    const unsubUpload = subscribeToEvent(SOCKET_EVENTS.BATCH_UPLOAD_UPDATED, (payload) => {
      if (payload.batchId !== currentBatchId) return;
      fetchHistory(currentBatchId);
    });
    const unsubMerge = subscribeToEvent(SOCKET_EVENTS.BATCH_MERGE_UPDATED, (payload) => {
      if (payload.batchId !== currentBatchId) return;
      refreshPreviewDataSilently(currentBatchId);
    });
    return () => { unsubUpload(); unsubMerge(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBatchId, subscribeToEvent, refreshPreviewDataSilently]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (prefixDropdownRef.current && !prefixDropdownRef.current.contains(e.target)) {
        setIsPrefixDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!duplicateHeaderWarning) return;
    const timer = setTimeout(() => setDuplicateHeaderWarning(''), 6000);
    return () => clearTimeout(timer);
  }, [duplicateHeaderWarning]);

  const showDuplicateHeaderWarning = (result) => {
    const duplicates = result?.warnings?.duplicateHeaders;
    if (duplicates && duplicates.length > 0) {
      setDuplicateHeaderWarning(`พบชื่อคอลัมน์ซ้ำในไฟล์: ${duplicates.join(', ')} — ระบบใช้ข้อมูลจากคอลัมน์แรกที่เจอเท่านั้น`);
    }
  };

  // "Reset" — returns to the idle upload view for the SAME shared batch (no
  // new batch is created; that's only ever done via "Start New Batch"). Also
  // the way out of a historical-batch preview, back to the live batch.
  const resetUpload = async () => {
    setIsViewingHistoricalBatch(false);
    setCurrentBatchId(activeBatchId || '');
    setStep('idle');
    setPreviewData([]);
    setTbosRemindData([]);
    setNewPartsData([]);
    setSelectedPreviewGroup('All');
    setDownloadFiles([]);
    setGroupPrefixError('');
    fetchHistory(activeBatchId);
  };

  const handleStartNewBatchClick = async () => {
    if (!window.confirm('This will start a new shared batch for everyone — continue?')) return;
    try {
      await startNewBatch();
    } catch {
      alert('Failed to start a new batch.');
    }
  };

  const handleSelectPrefix = (prefix) => {
    setGroupPrefix(prefix);
    setGroupPrefixError('');
    setIsPrefixDropdownOpen(false);
  };

  const openNewPrefixModal = () => {
    setNewPrefixInput('');
    setNewPrefixModalError('');
    setIsNewPrefixModalOpen(true);
  };

  const handleConfirmNewPrefix = async () => {
    const clientError = validatePrefixInput(newPrefixInput);
    if (clientError) { setNewPrefixModalError(clientError); return; }

    setIsSavingNewPrefix(true);
    try {
      const response = await fetch(`${API_BASE}/api/part-list/group-prefix-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: newPrefixInput }),
      });
      const result = await response.json();
      if (response.ok) {
        setGroupPrefix(result.prefix);
        setGroupPrefixError('');
        setIsNewPrefixModalOpen(false);
        fetchGroupPrefixHistory();
      } else {
        setNewPrefixModalError(result.error || 'Failed to save prefix.');
      }
    } catch {
      setNewPrefixModalError('Server error while saving prefix.');
    } finally {
      setIsSavingNewPrefix(false);
    }
  };

  const openEditPrefixModal = async () => {
    await fetchGroupPrefixHistory();
    setIsEditPrefixModalOpen(true);
  };

  const closeEditPrefixModal = async () => {
    setIsEditPrefixModalOpen(false);
    await fetchGroupPrefixHistory();
  };

  const handleConfirmDeletePrefixHistory = async () => {
    if (!deletePrefixTarget) return;
    const target = deletePrefixTarget;
    setIsDeletingPrefix(true);
    try {
      const response = await fetch(`${API_BASE}/api/part-list/group-prefix-history/${encodeURIComponent(target)}`, { method: 'DELETE' });
      if (response.ok) {
        const updatedHistory = await fetchGroupPrefixHistory();
        if (groupPrefix === target) {
          setGroupPrefix(updatedHistory[0]?.prefix || DEFAULT_GROUP_PREFIX);
        }
      } else {
        alert("Failed to delete prefix from history.");
      }
    } catch { alert("Server error while deleting prefix from history."); }
    finally {
      setIsDeletingPrefix(false);
      setDeletePrefixTarget(null);
    }
  };

  const handleDeleteBatch = async (batchId) => {
    if(!window.confirm(`Are you sure you want to delete Batch: ${batchId}?`)) return;
    try {
      const response = await fetch(`${API_BASE}/api/batches/${batchId}`, { method: 'DELETE' });
      if (response.ok) fetchHistory();
      else alert("Failed to delete batch.");
    } catch { alert("Failed to connect to server."); }
  };

  const handleDownloadNewParts = () => {
    window.location.href = `${API_BASE}/api/part-list/new-parts-since-last-batch/download?batchId=${currentBatchId}`;
  };

  const handleSetBaseline = async (batchId) => {
    if (!window.confirm('This will pin this batch as the shared New Parts comparison baseline for everyone — continue?')) return;
    try {
      const response = await fetch(`${API_BASE}/api/part-list/set-baseline-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });
      if (response.ok) fetchHistory();
      else alert("Failed to set baseline batch.");
    } catch { alert("Failed to connect to server."); }
  };

  const handlePreviewHistory = (batchId) => {
    // Read-only browsing of a past (possibly no-longer-active) batch — must
    // not be treated as, or disrupted by, the shared active batch changing.
    setIsViewingHistoricalBatch(true);
    setCurrentBatchId(batchId);
    setUploadStatus({ target: true, proc: true });
    setSubTab('new');
    setSelectedPreviewGroup('All');
    setTbosRemindData([]);
    setNewPartsData([]);
    // Re-viewing an already-merged batch must use whatever prefix is already
    // stored for it, not silently overwrite it with the input's current value.
    handleMergeData(batchId, { includePrefix: false });
  };

  const handleFileChangeBox1 = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchId', currentBatchId);
    try {
      setStep('generating');
      const response = await fetch(`${API_BASE}/api/part-list/target-ro`, { method: 'POST', body: formData });
      if (response.ok) {
        const result = await response.json();
        setUploadStatus(prev => ({ ...prev, target: true }));
        showDuplicateHeaderWarning(result);
        setStep('idle');
        fetchHistory();
      }
      else { alert("Upload Target R/O Failed!"); setStep('idle'); }
    } catch { alert("Server Error!"); setStep('idle'); }
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
      const response = await fetch(`${API_BASE}/api/part-list/part-procurement`, { method: 'POST', body: formData });
      if (response.ok) {
        const result = await response.json();
        setUploadStatus(prev => ({ ...prev, proc: true }));
        showDuplicateHeaderWarning(result);
        setStep('idle');
        fetchHistory();
      }
      else { alert("Upload Part Procurement Failed!"); setStep('idle'); }
    } catch { alert("Server Error!"); setStep('idle'); }
    e.target.value = null;
  };

  const handleMergeData = async (batchIdToMerge = currentBatchId, { includePrefix = true } = {}) => {
    try {
      setStep('generating');
      setGroupPrefixError('');
      const params = new URLSearchParams({ batchId: batchIdToMerge });
      if (includePrefix) params.set('prefix', groupPrefix);
      const response = await fetch(`${API_BASE}/api/part-list/preview-main?${params.toString()}`);
      const result = await response.json();
      if (response.ok) {
        setPreviewData(result.data);
        setTbosRemindData(result.remind || []);
        setNewPartsData(result.newParts || []);

        const uniqueGroups = [...new Set(result.data.map(item => item['Group ID*']))].filter(Boolean);
        const dynamicGroupOptions = uniqueGroups.map((grp, index) => ({ id: `grp_${index}`, label: `Group: ${grp}`, value: grp, isChecked: true }));
        setDownloadFiles(dynamicGroupOptions);
        setStep('preview');
        if (includePrefix) fetchGroupPrefixHistory();
      } else if (response.status === 400 && result.error) {
        setGroupPrefixError(result.error);
        setStep('idle');
      } else { alert("Merge Failed!"); setStep('idle'); }
    } catch { alert("Server Error during merge!"); setStep('idle'); }
  };

  const handleToggleFile = (id) => setDownloadFiles(prev => prev.map(f => f.id === id ? { ...f, isChecked: !f.isChecked } : f));
  const isAllChecked = downloadFiles.length > 0 && downloadFiles.every(f => f.isChecked);
  const handleToggleAll = () => setDownloadFiles(prev => prev.map(f => ({ ...f, isChecked: !isAllChecked })));

  const handleConfirmDownload = async () => {
    const selectedGroups = downloadFiles.filter(f => f.isChecked).map(f => f.value);
    if (selectedGroups.length === 0) { alert("Please select at least one group to download."); return; }
    const groupsQuery = encodeURIComponent(selectedGroups.join(','));
    window.location.href = `${API_BASE}/api/part-list/download-main?batchId=${currentBatchId}&groups=${groupsQuery}`;
    setIsModalOpen(false);
  };

  // Memoized so these are only recomputed when previewData / newPartsData /
  // selectedPreviewGroup actually change, instead of on every render of this
  // component (which happens on nearly every interaction — typing in a
  // modal, toggling a checkbox, a socket event, etc). Without this, every
  // one of those re-renders re-iterates the full previewData array, which
  // gets noticeably laggy once a merged batch has more than a few hundred
  // rows.
  const tableHeaders = useMemo(
    () => (previewData.length > 0 ? Object.keys(previewData[0]) : []),
    [previewData]
  );
  const newPartsTableHeaders = useMemo(
    () => (newPartsData.length > 0 ? Object.keys(newPartsData[0]) : []),
    [newPartsData]
  );
  const uniqueGroupsForDropdown = useMemo(
    () => [...new Set(previewData.map(item => item['Group ID*']))].filter(Boolean),
    [previewData]
  );
  const filteredPreviewData = useMemo(
    () => (selectedPreviewGroup === 'All' ? previewData : previewData.filter(item => item['Group ID*'] === selectedPreviewGroup)),
    [previewData, selectedPreviewGroup]
  );

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500 pb-10">

      <div className={activeTab === 'TBOS' ? 'flex flex-col gap-8' : 'hidden'}>
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-2xl font-bold text-ink tracking-tight">Generate Part List (TBOS)</h2>
            <p className="text-sm text-muted">Upload and manage your inventory data batches.</p>
          </div>

          <div className="flex items-center justify-between border-b border-ink/10 pb-0">
            <div className="flex items-center gap-6">
              <button onClick={() => setSubTab('new')} className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'new' ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'}`}><Plus size={18} /> New Upload</button>
              <button onClick={() => { setSubTab('history'); fetchHistory(); }} className={`flex items-center gap-2 px-4 py-3 font-bold transition-all border-b-2 ${subTab === 'history' ? 'text-ink border-ink' : 'text-muted border-transparent hover:text-ink hover:border-ink/20'}`}><History size={18} /> Upload History</button>
            </div>

            <button
              onClick={() => {
                if (activeBatchId && !window.confirm('Start a new batch? The current active batch will no longer be active (it stays in Upload History).')) return;
                startNewBatch().catch(() => alert('Failed to start a new batch.'));
              }}
              className="flex items-center gap-2 bg-ink text-accent px-5 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-colors mb-2"
            >
              <Plus size={16} /> New Batch
            </button>
          </div>

          {subTab === 'new' && hasLoadedActiveBatch && !activeBatchId && !isViewingHistoricalBatch && (
            <div className="bg-white border-2 border-dashed border-ink/10 rounded-4xl p-16 flex flex-col items-center justify-center text-center gap-4 animate-in fade-in">
              <Users size={48} className="text-muted" />
              <div>
                <h3 className="font-display text-xl font-bold text-ink mb-1">No shared batch is active yet</h3>
                <p className="text-sm text-muted max-w-sm">Everyone works on the same batch by default. Start one to begin uploading.</p>
              </div>
              <button onClick={() => startNewBatch().catch(() => alert('Failed to start a new batch.'))} className="bg-ink text-accent px-8 py-3 rounded-xl font-bold hover:opacity-90 transition-colors flex items-center gap-2">
                <Plus size={18} /> Start New Batch
              </button>
            </div>
          )}

          {subTab === 'new' && (activeBatchId || isViewingHistoricalBatch) && (
            <div className="flex flex-col gap-6 animate-in fade-in">
              {(step === 'idle' || step === 'generating') && (
                <div className="flex flex-col items-center gap-8">
                  <div className="w-full bg-white px-6 py-3 rounded-2xl border border-ink/5 shadow-[0_2px_10px_rgba(20,20,15,0.04)] flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-muted">Current Batch ID:</span>
                      <span className="text-sm font-mono bg-ink/5 px-3 py-1 rounded-md text-ink">{currentBatchId}</span>
                      <span className={`w-2 h-2 rounded-full ${isSocketConnected ? 'bg-success' : 'bg-red-400'}`} title={isSocketConnected ? 'Live updates connected' : 'Live updates disconnected'}></span>
                    </div>
                    <button onClick={handleStartNewBatchClick} className="text-xs bg-ink/5 hover:bg-ink/10 px-4 py-2 rounded-xl font-bold text-ink transition-colors whitespace-nowrap flex items-center gap-1.5">
                      <RefreshCw size={14} /> Start New Batch
                    </button>
                  </div>

                  <div className="w-full bg-white px-6 py-4 rounded-2xl border border-ink/5 shadow-[0_2px_10px_rgba(20,20,15,0.04)] flex flex-col gap-2">
                    <label className="text-sm font-bold text-muted">Group Prefix</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1" ref={prefixDropdownRef}>
                        <button
                          type="button"
                          id="group-prefix-input"
                          onClick={() => setIsPrefixDropdownOpen(prev => !prev)}
                          className={`w-full flex items-center justify-between bg-[#FAFAF7] border rounded-xl px-4 py-2.5 text-sm font-mono text-ink focus:outline-none transition-colors ${groupPrefixError ? 'border-red-300' : 'border-ink/10 hover:border-ink/20'}`}
                        >
                          <span>{groupPrefix}</span>
                          <ChevronDown size={16} className={`text-muted transition-transform ${isPrefixDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isPrefixDropdownOpen && (
                          <div className="absolute z-20 mt-2 w-full bg-white border border-ink/10 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                            {(groupPrefixHistory.length > 0 ? groupPrefixHistory : [{ prefix: DEFAULT_GROUP_PREFIX, last_used_at: null }]).map((entry) => (
                              <button
                                key={entry.prefix}
                                type="button"
                                onClick={() => handleSelectPrefix(entry.prefix)}
                                className={`w-full text-left text-sm font-mono px-4 py-2.5 hover:bg-accent/10 transition-colors ${entry.prefix === groupPrefix ? 'text-ink font-bold bg-accent/5' : 'text-ink/70'}`}
                              >
                                {entry.prefix}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={openNewPrefixModal}
                        className="flex items-center gap-1.5 bg-ink/5 hover:bg-ink/10 text-ink font-bold text-sm px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
                      >
                        <Plus size={16} /> New
                      </button>

                      <button
                        type="button"
                        onClick={openEditPrefixModal}
                        className="flex items-center gap-1.5 bg-ink/5 hover:bg-ink/10 text-ink font-bold text-sm px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
                      >
                        <Pencil size={16} /> Edit
                      </button>
                    </div>
                    {groupPrefixError && (
                      <p className="text-xs font-semibold text-red-500">{groupPrefixError}</p>
                    )}
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
                  {newPartsData && newPartsData.length > 0 && (
                    <div className="bg-white rounded-4xl shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                      <div className="px-6 py-4 bg-lime-100/70 border-b border-lime-200">
                        <div className="flex items-center gap-2 text-lime-800">
                          <PackagePlus size={22} />
                          <h3 className="font-bold text-lg">New Parts Since Last Batch</h3>
                          <span className="ml-auto text-sm font-bold bg-lime-200 px-3 py-1.5 rounded-lg shadow-sm">Total: {newPartsData.length} items</span>
                        </div>
                        <p className="text-sm text-lime-800/80 mt-1">These parts weren't in the previous batch's Target R/O — they need to be registered in TBOS.</p>
                      </div>

                      <div className="p-6 flex flex-col gap-4">
                        <div className="overflow-x-auto max-w-full max-h-[300px] border border-ink/5 rounded-xl bg-white shadow-sm">
                          <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
                            <thead className="bg-white border-b border-ink/5 sticky top-0 z-10 shadow-sm">
                              <tr className="text-muted uppercase tracking-tighter bg-[#FAFAF7]/90 backdrop-blur-sm">
                                {newPartsTableHeaders.map((header, idx) => (<th key={idx} className="px-4 py-3 font-bold border-r border-ink/5 last:border-0">{header}</th>))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-ink/5">
                              {newPartsData.slice(0, 100).map((row, idx) => (
                                <tr key={idx} className="hover:bg-[#FAFAF7]/50 transition-colors">
                                  {newPartsTableHeaders.map((header, hIdx) => (<td key={hIdx} className="px-4 py-3 font-medium text-ink border-r border-ink/5 last:border-0">{String(row[header] || '')}</td>))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {newPartsData.length > 100 && (
                          <p className="text-xs text-muted -mt-1">Showing first 100 of {newPartsData.length} — download for the full list.</p>
                        )}

                        <button onClick={handleDownloadNewParts} className="self-start bg-lime-700 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-lime-800 transition-colors flex items-center gap-2 shadow-md">
                          <Download size={16} /> Download New Parts
                        </button>
                      </div>
                    </div>
                  )}

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
                            {tbosRemindData.slice(0, 100).map((r, i) => (
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
                      {tbosRemindData.length > 100 && (
                        <p className="text-xs text-red-400/80 mt-2">Showing first 100 of {tbosRemindData.length} items.</p>
                      )}
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
                      <th className="px-6 py-4 text-center">Baseline</th>
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
                          <td className="px-6 py-4 text-center">
                            {b.is_baseline ? (
                              <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-bold text-xs shadow-sm">
                                <Star size={12} className="fill-amber-700" /> Current Baseline
                              </span>
                            ) : (
                              <button onClick={() => handleSetBaseline(b.batch_id)} className="text-ink/60 font-bold bg-ink/5 px-3 py-1.5 rounded-lg text-xs hover:bg-ink hover:text-accent transition-colors shadow-sm">
                                Set as Baseline
                              </button>
                            )}
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
                        <td colSpan="5" className="text-center py-10 text-muted">No upload history found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </div>

      <div className={activeTab === 'Handheld' ? '' : 'hidden'}>
        <HandheldManager
          key={currentBatchId}
          currentBatchId={currentBatchId}
          previewData={previewData}
          isRestoringPreview={isRestoringPreview}
          setUploadTab={setUploadTab}
          subscribeToEvent={subscribeToEvent}
          setActiveModule={setActiveModule}
        />
      </div>

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

      {isNewPrefixModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-4xl p-8 w-[400px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={() => setIsNewPrefixModalOpen(false)} className="absolute top-6 right-6 text-muted hover:text-ink transition-colors"><X size={20} /></button>
            <h3 className="font-display text-xl font-bold text-ink mb-2">New Group Prefix</h3>
            <p className="text-sm text-muted mb-6">Type a new prefix to use for this batch.</p>

            <input
              type="text"
              autoFocus
              value={newPrefixInput}
              onChange={(e) => { setNewPrefixInput(e.target.value); if (newPrefixModalError) setNewPrefixModalError(''); }}
              placeholder={DEFAULT_GROUP_PREFIX}
              className={`w-full bg-[#FAFAF7] border rounded-xl px-4 py-2.5 text-sm font-mono text-ink focus:outline-none focus:ring-2 transition-colors ${newPrefixModalError ? 'border-red-300 focus:ring-red-200' : 'border-ink/10 focus:ring-accent/40'}`}
            />
            {newPrefixModalError && (
              <p className="text-xs font-semibold text-red-500 mt-2">{newPrefixModalError}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsNewPrefixModalOpen(false)} disabled={isSavingNewPrefix} className="px-6 py-2.5 rounded-xl font-bold text-muted hover:bg-[#FAFAF7] transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleConfirmNewPrefix} disabled={isSavingNewPrefix} className="bg-ink text-accent px-6 py-2.5 rounded-xl font-bold hover:scale-105 transition-all shadow-md disabled:opacity-50">
                {isSavingNewPrefix ? 'Saving...' : 'Use this prefix'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditPrefixModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-4xl p-8 w-[420px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={closeEditPrefixModal} className="absolute top-6 right-6 text-muted hover:text-ink transition-colors"><X size={20} /></button>
            <h3 className="font-display text-xl font-bold text-ink mb-2">Edit Group Prefix History</h3>
            <p className="text-sm text-muted mb-6">Remove prefixes you no longer need. This only affects the suggestion list — it never changes any batch's already-stored prefix or past exports.</p>

            <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto mb-6">
              {groupPrefixHistory.length > 0 ? groupPrefixHistory.map((entry) => (
                <div key={entry.prefix} className="flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-[#FAFAF7] transition-colors">
                  <span className="text-sm font-mono text-ink">{entry.prefix}</span>
                  <button
                    type="button"
                    onClick={() => setDeletePrefixTarget(entry.prefix)}
                    className="text-muted hover:text-red-500 transition-colors p-1.5"
                    title="Remove from history"
                  >
                    <X size={16} />
                  </button>
                </div>
              )) : (
                <p className="text-sm text-muted text-center py-6">No saved prefixes yet.</p>
              )}
            </div>

            <div className="flex justify-end">
              <button onClick={closeEditPrefixModal} className="bg-ink text-accent px-6 py-2.5 rounded-xl font-bold hover:scale-105 transition-all shadow-md">Done</button>
            </div>
          </div>
        </div>
      )}

      {deletePrefixTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-4xl p-8 w-[380px] shadow-2xl animate-in zoom-in-95 relative">
            <h3 className="font-display text-lg font-bold text-ink mb-2">ยืนยันการลบ prefix นี้ออกจากประวัติ?</h3>
            <p className="text-sm text-muted mb-6">Prefix: <span className="font-mono font-bold text-ink">{deletePrefixTarget}</span></p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeletePrefixTarget(null)} disabled={isDeletingPrefix} className="px-6 py-2.5 rounded-xl font-bold text-muted hover:bg-[#FAFAF7] transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleConfirmDeletePrefixHistory} disabled={isDeletingPrefix} className="bg-red-500 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-red-600 transition-all shadow-md disabled:opacity-50">
                {isDeletingPrefix ? 'Deleting...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateHeaderWarning && (
        <div className="fixed bottom-6 right-6 z-[200] max-w-sm bg-ink text-white text-xs font-semibold px-4 py-3 rounded-2xl shadow-2xl flex items-start gap-2 animate-in fade-in slide-in-from-bottom-4 pointer-events-none">
          <AlertTriangle size={16} className="text-accent flex-shrink-0 mt-0.5" />
          <span>{duplicateHeaderWarning}</span>
        </div>
      )}
    </div>
  );
};

export default ListCreate;