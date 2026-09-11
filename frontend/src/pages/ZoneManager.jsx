import React, { useEffect, useState } from 'react';
import { Plus, X, Power, Trash2, MapPin, Pencil, Loader2 } from 'lucide-react';
import { API_BASE } from '../hooks/useActiveBatch';

const STATUS_STYLES = {
  active: { label: 'Active', dot: 'bg-success' },
  inactive: { label: 'Inactive', dot: 'bg-gray-300' },
};

function validateCodeLocal(value) {
  const trimmed = value.trim();
  if (!trimmed) return 'Zone code cannot be empty.';
  return '';
}

// Reads the server's { error } message when a request fails, falling back
// to a generic message if the response isn't JSON (e.g. a network error).
async function extractErrorMessage(res, fallback) {
  try {
    const body = await res.json();
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

// Manage Free Zone definitions (S1_S-LANE, WH3_OVERFLOW, ...) — these have
// no real Address Master row behind them (see design discussion), so
// they're just a manually-managed code + dock label, CRUD'd here the same
// way handheld devices are. AssignHandheld.jsx merges the active ones into
// its address-derived groups so they can be dragged onto a device exactly
// like a real PIC/ShortAddr group.
const ZoneManager = () => {
  const [zones, setZones] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDock, setNewDock] = useState('');
  const [addModalError, setAddModalError] = useState('');
  const [isSavingAdd, setIsSavingAdd] = useState(false);

  // Editing an existing zone — one modal handles rename + dock + activate/
  // deactivate + delete, opened by clicking the zone's card.
  const [editTarget, setEditTarget] = useState(null);
  const [editCodeValue, setEditCodeValue] = useState('');
  const [editDockValue, setEditDockValue] = useState('');
  const [editError, setEditError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadZones = () => {
    setIsLoading(true);
    setLoadError('');
    fetch(`${API_BASE}/api/zone-definitions`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((result) => setZones(result.data || []))
      .catch(() => setLoadError('Could not load zones from the server.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { loadZones(); }, []);

  const openAddModal = () => {
    setNewCode('');
    setNewDock('');
    setAddModalError('');
    setIsAddModalOpen(true);
  };

  const handleConfirmAddZone = async () => {
    const localError = validateCodeLocal(newCode);
    if (localError) { setAddModalError(localError); return; }

    setIsSavingAdd(true);
    try {
      const res = await fetch(`${API_BASE}/api/zone-definitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newCode.trim(), dock: newDock.trim() }),
      });
      if (!res.ok) {
        setAddModalError(await extractErrorMessage(res, 'Failed to add zone.'));
        return;
      }
      const result = await res.json();
      setZones((prev) => [...prev, result.data]);
      setIsAddModalOpen(false);
    } catch {
      setAddModalError('Could not reach the server.');
    } finally {
      setIsSavingAdd(false);
    }
  };

  const openEditModal = (zone) => {
    setEditTarget(zone);
    setEditCodeValue(zone.code);
    setEditDockValue(zone.dock);
    setEditError('');
    setConfirmingDelete(false);
  };

  const closeEditModal = () => {
    setEditTarget(null);
    setConfirmingDelete(false);
  };

  const handleSaveEdit = async () => {
    const localError = validateCodeLocal(editCodeValue);
    if (localError) { setEditError(localError); return; }

    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API_BASE}/api/zone-definitions/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editCodeValue.trim(), dock: editDockValue.trim() }),
      });
      if (!res.ok) {
        setEditError(await extractErrorMessage(res, 'Failed to update zone.'));
        return;
      }
      const result = await res.json();
      setZones((prev) => prev.map((z) => (z.id === editTarget.id ? result.data : z)));
      setEditTarget(result.data);
      setEditError('');
    } catch {
      setEditError('Could not reach the server.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleToggleStatus = async () => {
    const nextStatus = editTarget.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`${API_BASE}/api/zone-definitions/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) { setEditError(await extractErrorMessage(res, 'Failed to update status.')); return; }
      const result = await res.json();
      setZones((prev) => prev.map((z) => (z.id === editTarget.id ? result.data : z)));
      setEditTarget(result.data);
    } catch {
      setEditError('Could not reach the server.');
    }
  };

  const handleConfirmDelete = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/zone-definitions/${editTarget.id}`, { method: 'DELETE' });
      if (!res.ok) { setEditError(await extractErrorMessage(res, 'Failed to remove zone.')); return; }
      setZones((prev) => prev.filter((z) => z.id !== editTarget.id));
      closeEditModal();
    } catch {
      setEditError('Could not reach the server.');
    }
  };

  const activeCount = zones.filter((z) => z.status === 'active').length;

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500 pb-10">

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-dark tracking-tight">Free Zones</h2>
          <p className="text-sm text-gray-500">
            {zones.length === 0
              ? 'No zones defined yet.'
              : `${activeCount} of ${zones.length} zone${zones.length === 1 ? '' : 's'} active`}
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="self-start sm:self-auto flex items-center gap-2 bg-dark text-white px-6 py-3 rounded-xl font-bold hover:bg-primary transition-colors"
        >
          <Plus size={18} /> Add Zone
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white border border-gray-100 rounded-[32px] p-16 flex flex-col items-center justify-center text-center gap-3 shadow-sm">
          <Loader2 size={28} className="animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Loading zones…</p>
        </div>
      ) : loadError ? (
        <div className="bg-white border border-red-100 rounded-[32px] p-16 flex flex-col items-center justify-center text-center gap-4 shadow-sm">
          <p className="text-sm text-red-500 font-semibold">{loadError}</p>
          <button onClick={loadZones} className="bg-dark text-white px-6 py-2.5 rounded-xl font-bold hover:bg-primary transition-colors">
            Try again
          </button>
        </div>
      ) : zones.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-[32px] p-16 flex flex-col items-center justify-center text-center gap-4 shadow-sm">
          <div className="w-14 h-14 bg-orange-50 text-primary rounded-xl flex items-center justify-center">
            <MapPin size={26} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-dark mb-1">No Free Zones yet</h3>
            <p className="text-sm text-gray-500 max-w-sm">Add zones like S1_S-LANE or WH3_OVERFLOW — they'll show up as draggable groups on the Assign Handheld page alongside address groups.</p>
          </div>
          <button onClick={openAddModal} className="flex items-center gap-2 bg-dark text-white px-6 py-3 rounded-xl font-bold hover:bg-primary transition-colors">
            <Plus size={18} /> Add Zone
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-[32px] border border-gray-100 p-10 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {zones.map((zone) => {
              const statusStyle = STATUS_STYLES[zone.status];
              return (
                <button
                  key={zone.id}
                  onClick={() => openEditModal(zone)}
                  className={`group bg-gray-50 rounded-xl border border-gray-100 px-4 py-3.5 flex items-center gap-3 text-left transition-all hover:border-primary/40 hover:shadow-md ${
                    zone.status === 'inactive' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg bg-white flex items-center justify-center border border-gray-100">
                    <MapPin size={16} className="text-gray-300 group-hover:text-primary/60 transition-colors" />
                  </div>

                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${statusStyle.dot}`}></span>
                      <span className="font-bold text-sm text-dark truncate">{zone.code}</span>
                    </div>

                    <span className="text-[10px] font-bold text-gray-400 tracking-wide pl-3">{zone.dock}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[24px] p-8 w-[400px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={() => setIsAddModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors"><X size={22} /></button>

            <div className="w-14 h-14 mx-auto rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden mb-4">
              <MapPin size={22} className="text-gray-300" />
            </div>

            <h3 className="text-xl font-bold text-dark mb-2 text-center">Add Zone</h3>
            <p className="text-sm text-gray-500 mb-6 text-center">A short code (e.g. S1_S-LANE) and the dock it belongs to (e.g. S1) — this is what shows up as a draggable group on the Assign Handheld page.</p>

            <label className="text-xs font-bold text-gray-400 mb-1.5 block">Zone Code</label>
            <input
              type="text"
              autoFocus
              value={newCode}
              onChange={(e) => { setNewCode(e.target.value); if (addModalError) setAddModalError(''); }}
              placeholder="S1_S-LANE"
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmAddZone(); }}
              className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-sm font-mono text-dark focus:outline-none focus:ring-2 transition-colors mb-4 ${addModalError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-primary/30'}`}
            />

            <label className="text-xs font-bold text-gray-400 mb-1.5 block">Dock</label>
            <input
              type="text"
              value={newDock}
              onChange={(e) => setNewDock(e.target.value)}
              placeholder="S1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmAddZone(); }}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono text-dark focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
            />

            {addModalError && (
              <p className="text-xs font-semibold text-red-500 mt-2 text-center">{addModalError}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsAddModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">Cancel</button>
              <button
                onClick={handleConfirmAddZone}
                disabled={isSavingAdd}
                className="bg-dark text-white px-6 py-2.5 rounded-xl font-bold hover:bg-primary transition-colors shadow-md disabled:opacity-60 flex items-center gap-2"
              >
                {isSavingAdd && <Loader2 size={14} className="animate-spin" />}
                {isSavingAdd ? 'Adding…' : 'Add Zone'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[24px] p-8 w-[420px] shadow-2xl animate-in zoom-in-95 relative">
            <button onClick={closeEditModal} className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors"><X size={22} /></button>

            <div className="w-14 h-14 mx-auto rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden mb-5">
              <MapPin size={22} className="text-gray-300" />
            </div>

            {!confirmingDelete ? (
              <>
                <label className="text-xs font-bold text-gray-400 mb-1.5 block">Zone Code</label>
                <input
                  type="text"
                  value={editCodeValue}
                  onChange={(e) => { setEditCodeValue(e.target.value); if (editError) setEditError(''); }}
                  className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-sm font-mono text-dark focus:outline-none focus:ring-2 transition-colors mb-4 ${editError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-primary/30'}`}
                />

                <label className="text-xs font-bold text-gray-400 mb-1.5 block">Dock</label>
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="text"
                    value={editDockValue}
                    onChange={(e) => setEditDockValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); }}
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono text-dark focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  />
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSavingEdit}
                    title="Save"
                    className="flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-dark p-2.5 rounded-xl transition-colors disabled:opacity-60"
                  >
                    {isSavingEdit ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                  </button>
                </div>
                {editError && <p className="text-xs font-semibold text-red-500 mb-3">{editError}</p>}

                <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 mt-4 mb-6 border border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${STATUS_STYLES[editTarget.status].dot}`}></span>
                    <span className="text-sm font-bold text-dark">{STATUS_STYLES[editTarget.status].label}</span>
                  </div>
                  <button
                    onClick={handleToggleStatus}
                    className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg transition-colors ${
                      editTarget.status === 'active' ? 'bg-gray-200 text-dark hover:bg-gray-300' : 'bg-orange-50 text-primary hover:bg-orange-100'
                    }`}
                  >
                    <Power size={13} /> {editTarget.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>

                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="w-full flex items-center justify-center gap-2 text-sm font-bold text-red-500 hover:bg-red-50 py-2.5 rounded-xl transition-colors"
                >
                  <Trash2 size={15} /> Remove zone
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-dark mb-2 text-center">Remove this zone?</h3>
                <p className="text-sm text-gray-500 mb-6 text-center">
                  <span className="font-mono font-bold text-dark">{editTarget.code}</span> will no longer show up on the Assign Handheld page. This can't be undone.
                </p>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setConfirmingDelete(false)} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">Cancel</button>
                  <button
                    onClick={handleConfirmDelete}
                    className="bg-red-500 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-red-600 transition-colors shadow-md"
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ZoneManager;