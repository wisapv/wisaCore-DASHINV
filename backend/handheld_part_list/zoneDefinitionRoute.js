const express = require('express');
const { connectDB } = require('../database');
const { emitEvent, EVENTS } = require('../lib/socketHub');

const router = express.Router();

function normalize(value) {
  return String(value || '').trim();
}

function validateCode(code) {
  if (!code) return 'Zone code cannot be empty.';
  if (/[/\\:*?"<>|]/.test(code)) return 'Zone code contains an invalid character.';
  return '';
}

async function handleListZones(req, res) {
  try {
    const db = await connectDB();
    const rows = await db.all('SELECT id, code, dock, status FROM zone_definitions ORDER BY created_at ASC');
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load zone definitions' });
  }
}

async function handleAddZone(req, res) {
  try {
    const code = normalize(req.body.code).toUpperCase();
    const dock = normalize(req.body.dock).toUpperCase() || 'FREE';
    const error = validateCode(code);
    if (error) return res.status(400).json({ error });

    const db = await connectDB();
    const id = code;

    const existing = await db.get('SELECT id FROM zone_definitions WHERE id = ?', id);
    if (existing) return res.status(409).json({ error: 'A zone with this code already exists.' });

    await db.run(
      'INSERT INTO zone_definitions (id, code, dock, status) VALUES (?, ?, ?, ?)',
      id, code, dock, 'active'
    );
    emitEvent(EVENTS.ZONE_DEFINITIONS_UPDATED, {});
    res.json({ data: { id, code, dock, status: 'active' } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add zone definition' });
  }
}

// Handles rename (code/dock) and/or status change — one endpoint covers
// whatever fields are present in the body, same pattern as deviceRoute's
// handleUpdateDevice.
async function handleUpdateZone(req, res) {
  try {
    const { id } = req.params;
    const db = await connectDB();
    const zone = await db.get('SELECT id, code, dock, status FROM zone_definitions WHERE id = ?', id);
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    let nextCode = zone.code;
    if (req.body.code !== undefined) {
      const code = normalize(req.body.code).toUpperCase();
      const error = validateCode(code);
      if (error) return res.status(400).json({ error });

      if (code !== id) {
        const clash = await db.get('SELECT id FROM zone_definitions WHERE id = ? AND id != ?', code, id);
        if (clash) return res.status(409).json({ error: 'A zone with this code already exists.' });
      }
      nextCode = code;
    }

    let nextDock = zone.dock;
    if (req.body.dock !== undefined) {
      const dock = normalize(req.body.dock).toUpperCase();
      if (!dock) return res.status(400).json({ error: 'Dock cannot be empty.' });
      nextDock = dock;
    }

    let nextStatus = zone.status;
    if (req.body.status !== undefined) {
      if (!['active', 'inactive'].includes(req.body.status)) {
        return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
      }
      nextStatus = req.body.status;
    }

    await db.run('UPDATE zone_definitions SET code = ?, dock = ?, status = ? WHERE id = ?', nextCode, nextDock, nextStatus, id);
    emitEvent(EVENTS.ZONE_DEFINITIONS_UPDATED, {});
    res.json({ data: { id, code: nextCode, dock: nextDock, status: nextStatus } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update zone definition' });
  }
}

async function handleDeleteZone(req, res) {
  try {
    const { id } = req.params;
    const db = await connectDB();
    const result = await db.run('DELETE FROM zone_definitions WHERE id = ?', id);
    if (result.changes === 0) return res.status(404).json({ error: 'Zone not found' });
    emitEvent(EVENTS.ZONE_DEFINITIONS_UPDATED, {});
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete zone definition' });
  }
}

router.get('/', handleListZones);
router.post('/', handleAddZone);
router.patch('/:id', handleUpdateZone);
router.delete('/:id', handleDeleteZone);

module.exports = router;
module.exports.handleListZones = handleListZones;
module.exports.handleAddZone = handleAddZone;
module.exports.handleUpdateZone = handleUpdateZone;
module.exports.handleDeleteZone = handleDeleteZone;
