import React, { useRef, useState, useEffect } from 'react';
import { FileSpreadsheet, CheckCircle2, UploadCloud, Loader2, Eye, X, AlertTriangle, History } from 'lucide-react';
import { API_BASE } from '../hooks/useActiveBatch';

// Refreshed monthly, not per counting session — this is reference/catalog
// data (which physical part lives where), not a "batch" like TBOS uploads
// are, so it lives here in Template Manager rather than in the Getsudo
// counting flow itself. Getsudo's Target List page just reads the status
// this page sets — it never uploads anything itself. Every upload is kept
// as its own revision (never deleted) — matching always uses the latest
// one, but past revisions stay visible below for reference. Styled to
// match Template Manager's own FORMAT upload card (see TemplateManager.jsx).
const STALE_AFTER_DAYS = 40;

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(value) {
  if (!value) return '-';
  const [y, m] = value.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

const NqcMasterManager = () => {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState({ count: 0, updatedAt: null, dataMonth: null });
  const [history, setHistory] = useState([]);
  const [dataMonth, setDataMonth] = useState(currentMonthValue());
  const [isUploading, setIsUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchStatus = () => {
    fetch(`${API_BASE}/api/getsudo/master-status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setStatus(data))
      .catch((err) => console.error('Failed to load NQC master status', err));
  };

  const fetchHistory = () => {
    fetch(`${API_BASE}/api/getsudo/upload-history`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => setHistory(result && result.data ? result.data : []))
      .catch((err) => console.error('Failed to load NQC upload history', err));
  };

  useEffect(() => { fetchStatus(); fetchHistory(); }, []);

  const daysSinceUpdate = status.updatedAt
    ? Math.floor((Date.now() - new Date(status.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = daysSinceUpdate !== null && daysSinceUpdate > STALE_AFTER_DAYS;

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!dataMonth) {
      setError('เลือกเดือนของข้อมูลก่อนอัปโหลด');
      e.target.value = null;
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('dataMonth', dataMonth);

    setIsUploading(true);
    setSuccess(false);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/getsudo/upload-master`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setSuccess(true);
      fetchStatus();
      fetchHistory();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setIsUploading(false);
      e.target.value = null;
    }
  };

  const handleOpenPreview = async () => {
    setPreviewLoading(true);
    setIsPreviewOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/getsudo/master-preview`);
      const result = await res.json();
      setPreviewRows(result.data || []);
    } catch (err) {
      console.error('Failed to load NQC master preview', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewColumns = previewRows.length > 0
    ? Object.keys(previewRows[0]).filter((c) => c !== 'monthly_forecast' && c !== 'daily_usage' && c !== 'revision_id')
    : [];

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col">
        <h2 className="text-2xl font-bold text-dark tracking-tight">NQC Master Database</h2>
        <p className="text-sm text-gray-500">ฐานข้อมูล part ทั้งโรงงาน สำหรับ Getsudo — refresh เป็นรอบ (ปกติเดือนละครั้ง)</p>
      </div>

      {/* CURRENT STATUS + UPLOAD */}
      <div className="bg-white rounded-[32px] border border-gray-100 p-10 w-full flex flex-col gap-6 shadow-sm">

        <div className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-50 text-primary rounded-xl flex items-center justify-center">
              <FileSpreadsheet size={24} />
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-dark text-lg leading-tight">
                {status.count > 0 ? `ข้อมูลเดือน ${formatMonth(status.dataMonth)}` : 'NQC Master (ทั้งโรงงาน)'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {status.count > 0
                  ? `${status.count.toLocaleString()} parts · อัปโหลดเมื่อ ${new Date(status.updatedAt).toLocaleString('th-TH')}`
                  : 'ยังไม่มีข้อมูล — อัปโหลดไฟล์ NQC ครั้งแรก'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenPreview}
              disabled={status.count === 0}
              className="flex items-center gap-2 bg-white border border-gray-200 text-dark px-4 py-3 rounded-xl font-bold hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              <Eye size={18} />
              Preview
            </button>

            <button
              onClick={() => fileInputRef.current.click()}
              disabled={isUploading}
              className="flex items-center gap-2 bg-dark text-white px-6 py-3 rounded-xl font-bold hover:bg-primary transition-colors disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={18} className="animate-spin" /> : success ? <CheckCircle2 size={18} className="text-success" /> : <UploadCloud size={18} />}
              {isUploading ? 'Uploading...' : success ? 'Saved!' : 'Upload New Revision'}
            </button>
          </div>

          <input type="file" accept=".xls,.xlsx" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
        </div>

        {/* Month picker — required before an upload is accepted, since the
            file itself doesn't reliably say which month it's for. */}
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-bold text-dark">เดือนของข้อมูลที่จะอัปโหลด</p>
            <p className="text-xs text-gray-500 mt-0.5">ระบุก่อนกด Upload — แต่ละครั้งที่อัปโหลดจะเก็บเป็นประวัติแยกไว้ ไม่ทับของเดิม</p>
          </div>
          <input
            type="month"
            value={dataMonth}
            onChange={(e) => setDataMonth(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-dark outline-none"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700 font-semibold">
            {error}
          </div>
        )}

        {isStale && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 font-semibold">
              ข้อมูลนี้ไม่ได้อัปเดตมา {daysSinceUpdate} วันแล้ว (เกิน {STALE_AFTER_DAYS} วัน) — ควรอัปโหลดไฟล์ NQC รอบใหม่
            </p>
          </div>
        )}
      </div>

      {/* UPLOAD HISTORY — every past revision, newest first. Nothing is
          ever deleted on upload, so this always reflects everything
          that's ever been loaded. */}
      <div className="bg-white rounded-[32px] border border-gray-100 p-10 w-full shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-gray-50 text-gray-500 rounded-xl flex items-center justify-center">
            <History size={18} />
          </div>
          <div>
            <h3 className="font-bold text-dark text-lg leading-tight">Upload History</h3>
            <p className="text-sm text-gray-500 mt-0.5">อัปโหลดไปแล้วทั้งหมด {history.length} ครั้ง</p>
          </div>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-gray-400 font-semibold py-6 text-center">ยังไม่เคยอัปโหลด</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {history.map((rev, i) => (
              <div key={rev.id} className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${i === 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <div>
                    <p className="text-sm font-bold text-dark">
                      ข้อมูลเดือน {formatMonth(rev.data_month)}
                      {i === 0 && <span className="ml-2 text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full align-middle">ล่าสุด · กำลังใช้งาน</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{new Date(rev.uploaded_at).toLocaleString('th-TH')}</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-gray-400">{rev.row_count.toLocaleString()} parts</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PREVIEW MODAL — same layout as Template Manager's format preview */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in p-6">
          <div className="bg-white rounded-[24px] p-8 w-[95%] max-w-7xl shadow-2xl animate-in zoom-in-95 relative flex flex-col max-h-[90vh]">
            <button
              onClick={() => setIsPreviewOpen(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors"
            >
              <X size={24} />
            </button>

            <div className="mb-6">
              <h3 className="text-2xl font-bold text-dark mb-2">NQC Master Preview</h3>
              <p className="text-sm text-gray-500">แสดง 20 แถวแรกของข้อมูล NQC master revision ล่าสุด</p>
            </div>

            <div className="overflow-auto border border-gray-200 rounded-xl flex-1 bg-white">
              {previewLoading ? (
                <div className="p-10 flex items-center justify-center text-gray-400">
                  <Loader2 size={24} className="animate-spin" />
                </div>
              ) : (
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50">
                      {previewColumns.map((col) => (
                        <th key={col} className="px-5 py-3 border-r border-b border-gray-200 last:border-r-0 font-bold text-dark uppercase">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-gray-50 transition-colors text-dark">
                        {previewColumns.map((col) => (
                          <td key={col} className="px-5 py-3 border-r border-gray-100 last:border-0">
                            {row[col] !== undefined && row[col] !== null ? String(row[col]) : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end items-center gap-4 mt-8 pt-6 border-t border-gray-100">
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NqcMasterManager;