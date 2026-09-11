// Thin, generic wrapper around the socket.io server instance. Route handlers
// call emitEvent(name, payload) instead of touching `io` directly, so this
// stays the single place that knows how events actually get broadcast — a
// future feature (e.g. handheld-device events) can reuse the same
// initSocketHub/emitEvent mechanism with its own event-name constants
// without any of this module needing to change.
let ioInstance = null;

function initSocketHub(io) {
  ioInstance = io;
}

function getSocketHub() {
  return ioInstance;
}

// Events only ever carry a light payload (e.g. { batchId }) — clients are
// expected to refetch the real data via REST, never reconstruct state from
// the event itself.
function emitEvent(eventName, payload = {}) {
  if (!ioInstance) return;
  ioInstance.emit(eventName, payload);
}

const EVENTS = Object.freeze({
  BATCH_CHANGED: 'batch:changed',
  BATCH_UPLOAD_UPDATED: 'batch:uploadUpdated',
  BATCH_MERGE_UPDATED: 'batch:mergeUpdated',
  HANDHELD_UPDATED: 'handheld:updated',
  HANDHELD_DEVICES_UPDATED: 'handheld:devicesUpdated',
  ZONE_DEFINITIONS_UPDATED: 'zone:definitionsUpdated',
});

module.exports = { initSocketHub, getSocketHub, emitEvent, EVENTS };