import React, { useRef, useState, useEffect } from 'react';
import { FileSpreadsheet, CheckCircle2, UploadCloud, Loader2, Eye, X, Download, FileDown } from 'lucide-react';
import { API_BASE } from '../hooks/useActiveBatch';

const TemplateManager = () => {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [templateInfo, setTemplateInfo] = useState({ exists: false, lastUpdate: null });
  
  // States สำหรับ Modal Preview
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState([]);

  const fetchTemplateInfo = () => {
    fetch('http://localhost:3000/api/template/info')
      .then(res => res.json())
      .then(data => setTemplateInfo(data))
      .catch(err => console.error("Error fetching template info", err));
  };

  useEffect(() => {
    fetchTemplateInfo();
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setIsUploading(true);
    setSuccess(false);

    try {
      const response = await fetch('http://localhost:3000/api/template/upload', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        setSuccess(true);
        fetchTemplateInfo(); 
        setTimeout(() => setSuccess(false), 3000); 
      } else {
        alert('Failed to upload template.');
      }
    } catch (error) {
      alert('Server connection error.');
    } finally {
      setIsUploading(false);
      e.target.value = null; 
    }
  };

  // ดึงข้อมูล 5 บรรทัดแล้วเปิด Popup โชว์ตาราง
  const handleOpenPreview = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/template/preview-data');
      const result = await res.json();
      if (res.ok && result.exists) {
        setPreviewData(result.data);
        setIsPreviewModalOpen(true); // เปิด Modal
      } else {
        alert("Failed to load preview data.");
      }
    } catch (err) {
      alert("Error fetching preview data.");
    }
  };

  // ฟังก์ชันดาวน์โหลดไฟล์
  const handleDownloadExcel = () => {
    window.location.href = 'http://localhost:3000/api/template/preview-file';
  };

  const handleDownloadTargetListTemplate = () => {
    window.location.href = `${API_BASE}/api/getsudo/target-list-template`;
  };

  const handleDownloadLtboTemplate = () => {
    window.location.href = `${API_BASE}/api/process-stock/template`;
  };

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col">
        <h2 className="text-2xl font-bold text-dark tracking-tight">Template Management</h2>
        <p className="text-sm text-gray-500">Upload and manage Excel formats for report generation.</p>
      </div>

      <div className="bg-white rounded-[32px] border border-gray-100 p-10 w-full flex flex-col gap-8 shadow-sm">
        
        <div className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-50 text-primary rounded-xl flex items-center justify-center">
              <FileSpreadsheet size={24} />
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-dark text-lg leading-tight">Main Format (LTBO1010)</h3>
              <p className="text-sm text-gray-500 mt-1">
                {templateInfo.exists 
                  ? `Last Update: ${new Date(templateInfo.lastUpdate).toLocaleString('th-TH')}` 
                  : 'No template uploaded yet.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handleOpenPreview}
              disabled={!templateInfo.exists}
              className="flex items-center gap-2 bg-white border border-gray-200 text-dark px-4 py-3 rounded-xl font-bold hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              <Eye size={18} />
              Preview Format
            </button>

            <button 
              onClick={() => fileInputRef.current.click()}
              disabled={isUploading}
              className="flex items-center gap-2 bg-dark text-white px-6 py-3 rounded-xl font-bold hover:bg-primary transition-colors disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={18} className="animate-spin" /> : success ? <CheckCircle2 size={18} className="text-success" /> : <UploadCloud size={18} />}
              {isUploading ? 'Uploading...' : success ? 'Saved!' : 'Upload / Replace'}
            </button>
          </div>
          
          <input type="file" accept=".xls,.xlsx" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
        </div>
      </div>

      {/* TARGET LIST TEMPLATE — the blank file admins fill in and re-upload
          on the Getsudo > Target List page. Kept here so every downloadable
          template in the system lives in one place. */}
      <div className="bg-white rounded-[32px] border border-gray-100 p-10 w-full flex flex-col gap-8 shadow-sm">
        <div className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-50 text-primary rounded-xl flex items-center justify-center">
              <FileDown size={24} />
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-dark text-lg leading-tight">Target List Template (Getsudo)</h3>
              <p className="text-sm text-gray-500 mt-1">ไฟล์เปล่าสำหรับกรอก Part Number แล้วอัปโหลดที่หน้า Getsudo &gt; Target List</p>
            </div>
          </div>

          <button
            onClick={handleDownloadTargetListTemplate}
            className="flex items-center gap-2 bg-white border border-gray-200 text-dark px-6 py-3 rounded-xl font-bold hover:border-primary hover:text-primary transition-colors"
          >
            <Download size={18} />
            Download Template
          </button>
        </div>
      </div>

      {/* LTBO1021 UPLOAD TEMPLATE — the blank file Process Stock's own
          export step builds its files from (see the RUN OUT / Inventory
          Sum Export design discussion). Download-only reference, same
          pattern as the Target List Template above. */}
      <div className="bg-white rounded-[32px] border border-gray-100 p-10 w-full flex flex-col gap-8 shadow-sm">
        <div className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-50 text-primary rounded-xl flex items-center justify-center">
              <FileDown size={24} />
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-dark text-lg leading-tight">LTBO1021 Upload Template (RUN OUT)</h3>
              <p className="text-sm text-gray-500 mt-1">Inventory Result data upload/download format — used by Process Stock's Export step in Summary &gt; RUN OUT</p>
            </div>
          </div>

          <button
            onClick={handleDownloadLtboTemplate}
            className="flex items-center gap-2 bg-white border border-gray-200 text-dark px-6 py-3 rounded-xl font-bold hover:border-primary hover:text-primary transition-colors"
          >
            <Download size={18} />
            Download Template
          </button>
        </div>
      </div>

      {/* ================= PREVIEW POPUP MODAL (LARGE) ================= */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in p-6">
          
          {/* ขยายความกว้างเต็มที่ (max-w-7xl) และความสูง (max-h-[90vh]) */}
          <div className="bg-white rounded-[24px] p-8 w-[95%] max-w-7xl shadow-2xl animate-in zoom-in-95 relative flex flex-col max-h-[90vh]">
            
            <button 
              onClick={() => setIsPreviewModalOpen(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors"
            >
              <X size={24} />
            </button>

            <div className="mb-6">
              <h3 className="text-2xl font-bold text-dark mb-2">Template Preview</h3>
              <p className="text-sm text-gray-500">First 5 rows of the currently active 'Main Format' template.</p>
            </div>

            

            {/* ตารางแสดงผล เลื่อนซ้ายขวา/บนล่างได้สบายๆ โชว์ข้อมูลดิบๆ */}
            <div className="overflow-auto border border-gray-200 rounded-xl flex-1 bg-white">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <tbody className="divide-y divide-gray-200">
                  {previewData.map((row, rowIndex) => (
                    <tr 
                      key={rowIndex} 
                      className="hover:bg-gray-50 transition-colors text-dark"
                    >
                      {/* สร้าง Column ให้พอดีกับแถวที่ยาวที่สุด */}
                      {Array.from({ length: Math.max(...previewData.map(r => r.length)) }).map((_, colIndex) => (
                        <td key={colIndex} className="px-5 py-3 border-r border-gray-100 last:border-0">
                          {row[colIndex] !== undefined && row[colIndex] !== null ? String(row[colIndex]) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>



            {/* Footer พร้อมปุ่ม Download */}
            <div className="flex justify-end items-center gap-4 mt-8 pt-6 border-t border-gray-100">
              <button 
                onClick={() => setIsPreviewModalOpen(false)}
                className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Close Preview
              </button>
              <button 
                onClick={handleDownloadExcel}
                className="flex items-center gap-2 px-8 py-3 rounded-xl font-bold bg-dark text-white hover:bg-primary transition-colors shadow-lg shadow-dark/10"
              >
                <Download size={18} />
                Download Excel File
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateManager;