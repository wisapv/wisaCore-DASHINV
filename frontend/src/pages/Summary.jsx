import React, { useEffect, useRef, useState } from 'react';
import { Factory, ClipboardList, ArrowLeft, Construction, Sparkles, UploadCloud, Loader2, FileSpreadsheet, Eye, AlertTriangle, Trash2, Layers, PlayCircle, CheckCircle2, XCircle, Download } from 'lucide-react';
import Sparkle from '../components/Sparkle';
import { API_BASE } from '../hooks/useActiveBatch';

// Same storage key AssignHandheld.jsx / Overview.jsx / Detail.jsx use.
const SELECTED_BATCH_STORAGE_KEY = 'wisa:assignHandheld:selectedBatchId';
function readStoredBatchId() {
  try { return localStorage.getItem(SELECTED_BATCH_STORAGE_KEY) || ''; } catch { return ''; }
}

// Which operation a batch was last summarized as — keyed per-batch (not a
// single global value) so switching between a RUN OUT batch and a Getsudo
// batch doesn't have them fight over one shared choice.
// Every column the LTBO1021 template defines, in its own official order,
// except Part No is pulled to the front for display (sticky column, see
// the preview table below) — Inventory Result columns get a subtle accent
// tint since they're the most important data, everything else stays plain
// to match the rest of the app's table style (no heavy color-blocking).
const LTBO_COLUMNS = [
  { key: 'part_no', label: 'Part No.', sticky: true },
  { key: 'company', label: 'Company' },
  { key: 'company_plant_code', label: 'Company Plant Code' },
  { key: 'group_id', label: 'Group ID' },
  { key: 'no_of_inventory', label: 'No. of Inventory' },
  { key: 'suffix', label: 'Suffix' },
  { key: 'receiving_company', label: 'Receiving Company' },
  { key: 'receiving_company_plant_code', label: 'Receiving Co. Plant Code' },
  { key: 'production_process_routing', label: 'Production Process Routing' },
  { key: 'dock_code', label: 'Dock Code' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'supplier_plant_code', label: 'Supplier Plant Code' },
  { key: 'supplier_shipping_dock', label: 'Supplier Shipping Dock' },
  { key: 'previous_process_routing', label: 'Previous Process Routing' },
  { key: 'dummy', label: 'Dummy' },
  { key: 'out_of_calculation_flg', label: 'Out of Calculation Flg' },
  { key: 'out_of_check_flg', label: 'Out of Check Flg' },
  { key: 'min_bc_seq', label: 'Min BC Seq' },
  { key: 'attachment_point_1', label: 'Attachment Point 1' },
  { key: 'attachment_point_2', label: 'Attachment Point 2' },
  { key: 'attachment_point_3', label: 'Attachment Point 3' },
  ...Array.from({ length: 13 }, (_, i) => ({
    key: `inv_result_${i + 1}`, label: `Inv. Result ${i + 1}`, highlight: true,
  })),
  { key: 'stock_in_transit_system', label: 'Stock in Transit (System)' },
  { key: 'stock_in_transit_adjust_qty', label: 'Stock in Transit (Adjust Qty)' },
  { key: 'comments', label: 'Comments' },
];

function operationStorageKey(batchId) {
  return `wisa:summary:operation:${batchId}`;
}
function readStoredOperation(batchId) {
  try { return localStorage.getItem(operationStorageKey(batchId)) || ''; } catch { return ''; }
}
function writeStoredOperation(batchId, operation) {
  try { localStorage.setItem(operationStorageKey(batchId), operation); } catch { /* ignore */ }
}

// The RUN OUT half of Summary — importing the LTBO1021 List Report as
// master data (see the design discussion: it's its own batch, linked back
// to the counting batch via linkedBatchId, since Process Stock will later
// need to know which handheld_stock_counts/handheld_free_zone_scans rows
// to compare this master list against).
const RunOutImport = ({ linkedBatchId }) => {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  const [importBatches, setImportBatches] = useState([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(true);
  const [previewBatchId, setPreviewBatchId] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Process Stock — runs against whichever import batch is expanded; a
  // fresh run always replaces the last one (see the backend's own DELETE-
  // then-recompute), so there's no stale-results risk from re-running after
  // fixing counts.
  const [processingBatchId, setProcessingBatchId] = useState(null);
  const [processResults, setProcessResults] = useState({}); // ltboBatchId -> { summary, rows }
  const [isProcessRunning, setIsProcessRunning] = useState(null); // ltboBatchId currently running, or null
  const [isExporting, setIsExporting] = useState(null); // ltboBatchId currently exporting, or null
  const [exportError, setExportError] = useState('');

  const loadImportBatches = () => {
    setIsLoadingBatches(true);
    fetch(`${API_BASE}/api/ltbo/batches?linkedBatchId=${encodeURIComponent(linkedBatchId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => setImportBatches(result ? result.data : []))
      .catch(() => {})
      .finally(() => setIsLoadingBatches(false));
  };
  useEffect(loadImportBatches, [linkedBatchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilesChosen = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadError('');
    setLastResult(null);
    try {
      const formData = new FormData();
      formData.append('linkedBatchId', linkedBatchId);
      files.forEach((f) => formData.append('files', f));
      const res = await fetch(`${API_BASE}/api/ltbo/import`, { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) { setUploadError(result.error || 'Import failed.'); return; }
      setLastResult(result);
      loadImportBatches();
    } catch {
      setUploadError('Could not reach the server.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePreview = (batchId) => {
    if (previewBatchId === batchId) { setPreviewBatchId(null); setPreviewRows([]); return; }
    setPreviewBatchId(batchId);
    setIsPreviewLoading(true);
    fetch(`${API_BASE}/api/ltbo/master?batchId=${encodeURIComponent(batchId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => setPreviewRows(result ? result.data : []))
      .catch(() => {})
      .finally(() => setIsPreviewLoading(false));
  };

  // Loads whatever Process Stock last computed for this LTBO batch, if
  // anything — lets someone come back to a batch and see the last run's
  // results without needing to re-run it just to look.
  const loadProcessResults = async (ltboBatchId) => {
    try {
      const res = await fetch(`${API_BASE}/api/process-stock/results?ltboBatchId=${encodeURIComponent(ltboBatchId)}`);
      if (!res.ok) return;
      const result = await res.json();
      const rows = result.data || [];
      if (rows.length === 0) return;
      const notFound = rows.filter((r) => r.status === 'not_found');
      setProcessResults((prev) => ({
        ...prev,
        [ltboBatchId]: {
          rows,
          summary: { totalParts: rows.length, matchedCount: rows.length - notFound.length, notFoundCount: notFound.length, blocked: notFound.length > 0 },
        },
      }));
    } catch {
      // best-effort — leaves whatever was already shown, if anything
    }
  };

  const handleToggleProcessing = (batchId) => {
    if (processingBatchId === batchId) { setProcessingBatchId(null); return; }
    setProcessingBatchId(batchId);
    if (!processResults[batchId]) loadProcessResults(batchId);
  };

  // Runs Process Stock, then fetches the resulting rows, and only ever
  // commits ONE state update carrying both rows + summary together — never
  // an in-between state with a summary but no rows yet (that's what was
  // crashing the page: the results table unconditionally did
  // `.rows.map(...)`, which threw when rows was still undefined).
  const handleRunProcessStock = async (ltboBatchId) => {
    setIsProcessRunning(ltboBatchId);
    try {
      const runRes = await fetch(`${API_BASE}/api/process-stock/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ltboBatchId }),
      });
      const summary = await runRes.json();
      if (!runRes.ok) { setProcessResults((prev) => ({ ...prev, [ltboBatchId]: { error: summary.error || 'Failed to run Process Stock.' } })); return; }

      const resultsRes = await fetch(`${API_BASE}/api/process-stock/results?ltboBatchId=${encodeURIComponent(ltboBatchId)}`);
      const resultsJson = resultsRes.ok ? await resultsRes.json() : { data: [] };
      setProcessResults((prev) => ({ ...prev, [ltboBatchId]: { rows: resultsJson.data || [], summary } }));
    } catch {
      setProcessResults((prev) => ({ ...prev, [ltboBatchId]: { error: 'Could not reach the server.' } }));
    } finally {
      setIsProcessRunning(null);
    }
  };

  // Downloads the export zip directly via an anchor click — the endpoint
  // itself re-checks "0 not-found" server-side (see handleExport's own
  // guard), so this button only ever gets a real error message back
  // instead of a broken/empty download when something's still unresolved.
  const handleExport = async (ltboBatchId) => {
    setIsExporting(ltboBatchId);
    setExportError('');
    try {
      const res = await fetch(`${API_BASE}/api/process-stock/export?ltboBatchId=${encodeURIComponent(ltboBatchId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExportError(body.error || 'Export failed.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ltboBatchId}_Inv_Upload.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Could not reach the server.');
    } finally {
      setIsExporting(null);
    }
  };

  const handleDeleteBatch = async (batchId) => {
    setDeletingId(batchId);
    try {
      const res = await fetch(`${API_BASE}/api/ltbo/batch/${encodeURIComponent(batchId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setImportBatches((prev) => prev.filter((b) => b.batch_id !== batchId));
      if (previewBatchId === batchId) { setPreviewBatchId(null); setPreviewRows([]); }
      if (processingBatchId === batchId) setProcessingBatchId(null);
    } catch {
      // best-effort — row just stays in the list, user can retry
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-bold text-ink mb-1">Import LTBO1021 List Report</p>
        <p className="text-[11px] text-muted font-semibold">Upload one or more List Report files (e.g. one per Group/Plant) — they merge into a single master list for this batch.</p>
      </div>

      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink/10 rounded-[24px] py-10 cursor-pointer hover:border-accent/50 hover:bg-accent/[0.03] transition-colors">
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleFilesChosen} disabled={isUploading} />
        {isUploading ? <Loader2 size={22} className="animate-spin text-muted" /> : <UploadCloud size={22} className="text-muted" />}
        <p className="text-[11.5px] font-bold text-ink">{isUploading ? 'Importing…' : 'Click to choose files'}</p>
        <p className="text-[10px] text-muted font-semibold">.xlsx — multiple files allowed</p>
      </label>

      {uploadError && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl p-4">
          <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-700 font-semibold">{uploadError}</p>
        </div>
      )}

      {lastResult && (
        <div className="rounded-2xl border border-accent/30 overflow-hidden">
          <div className="bg-accent/10 px-6 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-ink flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet size={16} className="text-accent" />
            </div>
            <p className="text-[12.5px] font-bold text-ink">
              Imported {lastResult.fileCount} file{lastResult.fileCount === 1 ? '' : 's'} → {lastResult.rowCount} row{lastResult.rowCount === 1 ? '' : 's'} stored
              {lastResult.parsedCount !== lastResult.rowCount ? ` (${lastResult.parsedCount} parsed, duplicates merged)` : ''}
            </p>
          </div>
          {lastResult.fileErrors.length > 0 && (
            <p className="bg-white px-6 py-3 text-[11px] font-semibold text-red-600">{lastResult.fileErrors.length} file(s) failed to parse.</p>
          )}
        </div>
      )}

      <div>
        <p className="text-[12px] font-bold text-ink mb-3">Previous imports for this batch</p>
        <div className="bg-white rounded-[24px] border border-ink/[0.06] overflow-hidden">
          {isLoadingBatches ? (
            <div className="py-14 flex items-center justify-center text-muted"><Loader2 size={20} className="animate-spin" /></div>
          ) : importBatches.length === 0 ? (
            <p className="text-[12px] text-muted font-semibold text-center py-14">No LTBO1021 data imported yet.</p>
          ) : (
            <table className="w-full text-left text-[12px] table-fixed">
              <thead className="bg-[#FAFAF7]">
                <tr className="text-muted uppercase text-[10px]">
                  <th className="px-5 py-3.5 font-bold w-[38%]">Import Batch</th>
                  <th className="px-5 py-3.5 font-bold w-[10%]">Files</th>
                  <th className="px-5 py-3.5 font-bold w-[12%]">Rows</th>
                  <th className="px-5 py-3.5 font-bold w-[22%]">Imported</th>
                  <th className="px-5 py-3.5 font-bold text-right w-[18%]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {importBatches.map((b) => (
                  <tr key={b.batch_id} className={`hover:bg-[#FAFAF7] transition-colors ${previewBatchId === b.batch_id ? 'bg-accent/[0.06]' : ''}`}>
                    <td className="px-5 py-3.5 font-mono font-bold text-ink text-[11px] flex items-center gap-2">
                      <FileSpreadsheet size={14} className="text-muted shrink-0" /> {b.batch_id}
                    </td>
                    <td className="px-5 py-3.5 text-muted font-semibold">{b.file_count}</td>
                    <td className="px-5 py-3.5 font-bold text-ink">{b.row_count.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-muted font-semibold">{new Date(b.uploaded_at).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleToggleProcessing(b.batch_id)}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold text-[10.5px] transition-colors ${
                            processingBatchId === b.batch_id ? 'bg-ink text-accent' : 'bg-ink/[0.08] text-ink hover:bg-ink/[0.14]'
                          }`}
                        >
                          <PlayCircle size={12} /> Process Stock
                        </button>
                        <button
                          onClick={() => handlePreview(b.batch_id)}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold text-[10.5px] transition-colors ${
                            previewBatchId === b.batch_id ? 'bg-ink text-accent' : 'bg-accent/15 text-ink hover:bg-accent/25'
                          }`}
                        >
                          <Eye size={12} /> {previewBatchId === b.batch_id ? 'Hide' : 'Preview'}
                        </button>
                        {confirmDeleteId === b.batch_id ? (
                          <>
                            <button
                              onClick={() => handleDeleteBatch(b.batch_id)}
                              disabled={deletingId === b.batch_id}
                              className="inline-flex items-center gap-1.5 bg-red-500 text-white px-3 py-2 rounded-lg font-bold text-[10.5px] hover:bg-red-600 transition-colors disabled:opacity-60"
                            >
                              {deletingId === b.batch_id ? <Loader2 size={12} className="animate-spin" /> : 'Confirm'}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-[10.5px] font-bold text-muted hover:text-ink px-1">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(b.batch_id)}
                            title="Delete this import"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Preview renders as its own block below the list, not nested
            inside a table row — nesting a second scrollable table with a
            sticky column inside a <tr> broke the column alignment (the
            outer table's own layout and the inner one's sticky positioning
            fought each other). This also gives the 37-column table room to
            breathe at full width instead of being squeezed into a cell. */}
        {previewBatchId && (
          <div className="mt-4 bg-ink rounded-[24px] overflow-hidden shadow-[0_8px_24px_rgba(20,20,15,0.12)]">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/10">
              <Layers size={15} className="text-accent" />
              <p className="text-[12px] font-bold text-white">Master data preview</p>
              <span className="font-mono text-[10.5px] text-white/50">{previewBatchId}</span>
              <span className="ml-auto flex items-center gap-1.5 text-[9.5px] font-bold text-accent/80">
                <span className="w-2 h-2 rounded-sm bg-accent/30"></span> Inventory Result
              </span>
            </div>
            <div className="overflow-auto max-h-[460px] bg-white">
              {isPreviewLoading ? (
                <p className="text-[11px] text-muted font-semibold p-6">Loading…</p>
              ) : (
                <table className="text-left text-[10.5px] whitespace-nowrap border-collapse">
                  <thead>
                    <tr>
                      {LTBO_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          className={`px-3.5 py-3 font-extrabold uppercase text-[9px] tracking-wide sticky top-0 z-10 ${
                            col.sticky
                              ? 'sticky left-0 z-20 bg-ink text-accent border-r-2 border-accent/40'
                              : col.highlight
                                ? 'bg-accent/25 text-ink'
                                : 'bg-[#F3F2EA] text-ink/60'
                          }`}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {previewRows.map((r, i) => (
                      <tr key={i} className="hover:bg-accent/[0.08] transition-colors">
                        {LTBO_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3.5 py-2.5 ${
                              col.sticky
                                ? 'sticky left-0 z-[5] font-extrabold text-ink bg-white border-r-2 border-accent/20'
                                : col.highlight
                                  ? 'bg-accent/[0.08] font-bold text-ink'
                                  : 'text-[#5C5A52]'
                            }`}
                          >
                            {r[col.key] || <span className="text-ink/15">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Process Stock panel — separate from the LTBO preview above since
            they answer different questions (what's in the master list vs
            what counting actually produced against it) and can both be
            open at once. */}
        {processingBatchId && (
          <div className="mt-4 bg-white rounded-[24px] border-2 border-ink overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 bg-ink">
              <PlayCircle size={15} className="text-accent" />
              <p className="text-[12px] font-bold text-white">Process Stock</p>
              <span className="font-mono text-[10.5px] text-white/50">{processingBatchId}</span>
              <button
                onClick={() => handleRunProcessStock(processingBatchId)}
                disabled={isProcessRunning === processingBatchId}
                className="ml-auto flex items-center gap-1.5 bg-accent text-ink px-4 py-2 rounded-lg text-[10.5px] font-extrabold hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {isProcessRunning === processingBatchId ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                {isProcessRunning === processingBatchId ? 'Running…' : (processResults[processingBatchId] ? 'Re-run' : 'Run Process Stock')}
              </button>
            </div>

            {!processResults[processingBatchId] ? (
              <p className="text-[12px] text-muted font-semibold text-center py-14">
                Not run yet — click "Run Process Stock" to match counted quantities against this master list.
              </p>
            ) : processResults[processingBatchId].error ? (
              <div className="flex items-center gap-2.5 px-6 py-5 text-red-600">
                <AlertTriangle size={15} /> <p className="text-[12px] font-semibold">{processResults[processingBatchId].error}</p>
              </div>
            ) : (
              (() => {
                // Local alias with safe defaults — belt-and-suspenders on
                // top of the state-shape fix above, so a summary field
                // missing for any reason renders as "0 matched" instead of
                // crashing the whole page again.
                const summary = processResults[processingBatchId].summary || { totalParts: 0, matchedCount: 0, notFoundCount: 0, blocked: false };
                const rows = processResults[processingBatchId].rows || [];
                return (
              <>
                <div className={`flex items-center gap-3 px-6 py-4 ${summary.blocked ? 'bg-red-50' : 'bg-accent/10'}`}>
                  {summary.blocked ? (
                    <XCircle size={18} className="text-red-500 shrink-0" />
                  ) : (
                    <CheckCircle2 size={18} className="text-ink shrink-0" />
                  )}
                  <p className="text-[12.5px] font-bold text-ink">
                    {summary.matchedCount} / {summary.totalParts} parts matched
                    {summary.blocked && (
                      <span className="text-red-600"> — {summary.notFoundCount} part(s) not counted yet. Export is blocked until every part is found.</span>
                    )}
                  </p>
                  {!summary.blocked && (
                    <button
                      onClick={() => handleExport(processingBatchId)}
                      disabled={isExporting === processingBatchId}
                      className="ml-auto flex items-center gap-1.5 bg-ink text-accent px-4 py-2 rounded-lg text-[10.5px] font-extrabold hover:opacity-90 transition-opacity disabled:opacity-60 shrink-0"
                    >
                      {isExporting === processingBatchId ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {isExporting === processingBatchId ? 'Exporting…' : 'Export by Group ID'}
                    </button>
                  )}
                </div>
                {exportError && (
                  <div className="flex items-center gap-2.5 px-6 py-3 bg-red-50 text-red-600">
                    <AlertTriangle size={13} /> <p className="text-[11px] font-semibold">{exportError}</p>
                  </div>
                )}

                <div className="overflow-auto max-h-[420px]">
                  <table className="w-full text-left text-[10.5px] whitespace-nowrap">
                    <thead className="bg-[#FAFAF7] sticky top-0">
                      <tr className="text-muted uppercase text-[9px]">
                        <th className="px-4 py-2.5 font-bold">Part No</th>
                        <th className="px-4 py-2.5 font-bold">Status</th>
                        {Array.from({ length: 11 }, (_, i) => (
                          <th key={i} className="px-3 py-2.5 font-bold text-right">Inv{i + 1}</th>
                        ))}
                        <th className="px-3 py-2.5 font-bold">Seq1</th>
                        <th className="px-3 py-2.5 font-bold">Seq2</th>
                        <th className="px-3 py-2.5 font-bold">Seq3</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/5">
                      {rows.map((r, i) => (
                        <tr key={i} className={r.status === 'not_found' ? 'bg-red-50/50' : 'hover:bg-accent/[0.05]'}>
                          <td className="px-4 py-2.5 font-mono font-bold text-ink">{r.part_no}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[9.5px] font-extrabold px-2 py-0.5 rounded-full ${
                              r.status === 'matched' ? 'bg-accent/20 text-ink' : 'bg-red-100 text-red-600'
                            }`}>
                              {r.status === 'matched' ? 'Matched' : 'Not Found'}
                            </span>
                            {r.has_ambiguous_w === 1 && (
                              <span className="ml-1.5 text-[9px] font-bold text-orange-500" title="From PIC=W — duplicated into Inv7/8/9, see the Zone Assignment Rules backlog">⚠ W</span>
                            )}
                          </td>
                          {Array.from({ length: 11 }, (_, idx) => (
                            <td key={idx} className="px-3 py-2.5 text-right font-semibold text-ink">{r[`inv_result_${idx + 1}`] || '—'}</td>
                          ))}
                          <td className="px-3 py-2.5 text-muted">{r.seq_no_1 || '—'}</td>
                          <td className="px-3 py-2.5 text-muted">{r.seq_no_2 || '—'}</td>
                          <td className="px-3 py-2.5 text-muted">{r.seq_no_3 || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
                );
              })()
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// RUN OUT and Getsudo sum into two different target formats (see the
// Inventory Sum / LTBO1021 design discussion) — this page's whole job is
// to make sure the right one is picked before any summarizing happens.
// A GETSUDO- batch ID is unambiguous, so that case is auto-picked; a TBOS
// batch could in principle still be either, so it isn't guessed for those.
function guessOperation(batchId) {
  return batchId && batchId.startsWith('GETSUDO-') ? 'GETSUDO' : '';
}

const Summary = ({ currentBatchId }) => {
  const [selectedBatchId, setSelectedBatchId] = useState(() => readStoredBatchId() || currentBatchId || '');
  // Adjusting state when a prop changes — done during render (not in an
  // effect) per React's own guidance, so it doesn't cause an extra
  // cascading re-render. currentBatchId can arrive after this component's
  // first render (it comes from an async fetch higher up), so this can't
  // just be the useState initializer above.
  const [lastSeenBatchId, setLastSeenBatchId] = useState(currentBatchId);
  if (currentBatchId !== lastSeenBatchId) {
    setLastSeenBatchId(currentBatchId);
    if (!readStoredBatchId() && currentBatchId) setSelectedBatchId(currentBatchId);
  }

  const [operation, setOperation] = useState(() => {
    const batch = readStoredBatchId() || currentBatchId || '';
    return readStoredOperation(batch) || guessOperation(batch);
  });

  // Same render-time adjustment pattern as above — re-derive `operation`
  // whenever the selected batch itself changes (switching from a RUN OUT
  // batch to a Getsudo one shouldn't carry over the previous batch's choice).
  const [lastSeenSelectedBatchId, setLastSeenSelectedBatchId] = useState(selectedBatchId);
  if (selectedBatchId !== lastSeenSelectedBatchId) {
    setLastSeenSelectedBatchId(selectedBatchId);
    if (selectedBatchId) setOperation(readStoredOperation(selectedBatchId) || guessOperation(selectedBatchId));
  }

  const chooseOperation = (op) => {
    setOperation(op);
    if (selectedBatchId) writeStoredOperation(selectedBatchId, op);
  };

  if (!selectedBatchId) {
    return (
      <div className="w-full pb-10 animate-in fade-in">
        <div className="bg-white border-2 border-dashed border-ink/10 rounded-[28px] p-16 text-center text-[12px] text-muted font-semibold">
          Select a batch (on Assign Handheld, Overview, or Detail) before opening Summary.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500 pb-10 relative">

      <div className="flex items-center gap-3.5">
        <div className="flex flex-col">
          <span className="text-xs text-muted font-semibold tracking-wide">Inventory Sum</span>
          <h1 className="font-display text-[34px] font-bold tracking-tight leading-none mt-0.5 text-ink">Summary</h1>
        </div>
        <div className="w-[34px] h-[34px] bg-accent rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkle size={16} className="!bg-ink" delay=".2s" />
        </div>
        <span className="ml-auto bg-white border border-ink/10 rounded-xl px-3 py-2 text-[11px] font-bold text-ink shadow-sm">
          {selectedBatchId}
        </span>
      </div>

      {/* Underlying content — always mounted, so the popup above it feels
          like a layer rather than the only thing on the page. Blurred while
          no operation is chosen yet. key={operation} forces a fresh mount
          (and re-plays the animate-in) every time the operation changes,
          instead of just quietly re-rendering the same element in place. */}
      <div key={operation || 'none'} className={`bg-white rounded-4xl p-10 shadow-[0_2px_12px_rgba(20,20,15,0.04)] border border-ink/5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 ${!operation ? 'blur-sm opacity-60 pointer-events-none select-none' : ''}`}>
        {operation && (
          <button
            onClick={() => chooseOperation('')}
            className="flex items-center gap-1.5 text-[11px] font-bold text-muted hover:text-ink transition-colors mb-6"
          >
            <ArrowLeft size={13} /> Change operation
          </button>
        )}

        {operation === 'RUN OUT' ? (
          <RunOutImport linkedBatchId={selectedBatchId} />
        ) : (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <div className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center text-ink">
              <Construction size={26} />
            </div>
            <p className="font-display text-xl font-bold text-ink">{operation ? `${operation} summary isn't built yet` : 'Choose an operation to begin'}</p>
            <p className="text-[11.5px] text-muted font-semibold max-w-md">
              {operation === 'GETSUDO'
                ? "Getsudo's own target output format hasn't been specified yet (see the backlog) — this page will show its summary flow once that's defined."
                : ''}
            </p>
          </div>
        )}
      </div>

      {/* The picker itself — a proper overlay layer, not just another card
          in the flow, so choosing RUN OUT/GETSUDO feels like a deliberate
          step rather than one more thing on the page. */}
      {!operation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] p-11 w-[92%] max-w-7xl min-h-[320px] shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={16} className="text-ink" />
              <p className="text-sm font-bold text-ink">Which operation is this batch for?</p>
            </div>
            <p className="text-[11px] text-muted font-semibold mb-7">RUN OUT and GETSUDO sum into two different output formats — pick one before continuing.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <button
                onClick={() => chooseOperation('RUN OUT')}
                className="group text-left bg-[#FAFAF7] hover:bg-ink hover:text-accent hover:-translate-y-1 border border-ink/10 rounded-[24px] p-7 transition-all duration-200"
              >
                <Factory size={28} className="text-ink group-hover:text-accent mb-4 transition-colors" />
                <p className="font-display text-xl font-bold mb-1">RUN OUT</p>
                <p className="text-[11px] font-semibold text-muted group-hover:text-accent/70 transition-colors">Sums into the LTBO1021 Inventory Result format.</p>
              </button>
              <button
                onClick={() => chooseOperation('GETSUDO')}
                className="group text-left bg-[#FAFAF7] hover:bg-ink hover:text-accent hover:-translate-y-1 border border-ink/10 rounded-[24px] p-7 transition-all duration-200"
              >
                <ClipboardList size={28} className="text-ink group-hover:text-accent mb-4 transition-colors" />
                <p className="font-display text-xl font-bold mb-1">GETSUDO</p>
                <p className="text-[11px] font-semibold text-muted group-hover:text-accent/70 transition-colors">Sums into Getsudo's own format.</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Summary;