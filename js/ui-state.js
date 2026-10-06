/**
 * ui-state.js — helper for state-unit persistence (tiny, no deps).
 * Kept separate so ui.js stays focused on DOM; this file only handles
 * localStorage key + validation for the state-wise unit preference.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = global.FAC_CONFIG ? global.FAC_CONFIG.storage.key + ':stateUnit' : 'fac:fields:v1:stateUnit';

  function read() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return '';
      // Validate against known units — stale values after upgrade are ignored
      if (global.FAC_UNITS && typeof global.FAC_UNITS.meta === 'function') {
        const m = global.FAC_UNITS.meta(raw);
        // meta returns ha fallback for unknown; check TO_M2 directly
        if (global.FAC_UNITS.TO_M2 && !(raw in global.FAC_UNITS.TO_M2)) return '';
        // Only allow state-group units to be persisted as stateUnit
        if (m.group !== 'state' && raw !== '') return '';
      }
      return raw;
    } catch (_) { return ''; }
  }

  function write(unit) {
    try {
      if (!unit) global.localStorage.removeItem(STORAGE_KEY);
      else global.localStorage.setItem(STORAGE_KEY, unit);
    } catch (_) {}
  }

  global.FAC_UI_STATE = { read: read, write: write, STORAGE_KEY: STORAGE_KEY };
})(window);
