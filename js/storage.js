/**
 * storage.js — localStorage persistence layer.
 *
 * Stores a GeoJSON FeatureCollection of all drawn polygons. We trust
 * localStorage less than fresh data: every read is validated via
 * geometry.isValidFeatureCollection before being handed back. If validation
 * fails we return null and remove the bad blob.
 *
 * SECURITY:
 * - Never exec/eval stored data.
 * - Render paths consume validated objects only.
 * - Storage operations are wrapped so access errors (private mode) don't
 *   crash the app.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const UTILS = global.FAC_UTILS;
  const GEOM = global.FAC_GEOMETRY;

  /** Schema version of the stored blob. Bumped only on breaking format changes. */
  const SCHEMA_VERSION = 1;

  /** Reason for the most recent save/load failure, or null. Cleared on success. */
  let lastError = null;

  function schemaKey() { return CONFIG.storage.key + ':schema'; }

  /**
   * Save a FeatureCollection of polygons to localStorage.
   * @param {Object} fc — a valid GeoJSON FeatureCollection
   * @returns {boolean} true if saved
   */
  function save(fc) {
    return saveDetailed(fc).ok;
  }

  /**
   * Save with a machine-readable failure reason. The data blob keeps its
   * legacy bare-FeatureCollection shape (old app versions and existing saves
   * keep working); the version lives in a sidecar key so a future format can
   * be detected without ever risking stored fields.
   * @returns {{ok:boolean, reason:string|null}} reason: 'invalid' | 'quota' | 'unavailable' | null
   */
  function saveDetailed(fc) {
    if (!fc || fc.type !== 'FeatureCollection') return { ok: false, reason: 'invalid' };
    let serialized;
    try {
      serialized = JSON.stringify(fc);
    } catch (e) {
      console.warn('[storage] could not serialize FeatureCollection', e);
      return { ok: false, reason: 'invalid' };
    }
    // Sidecar first: if the data write then fails, a lone version key is harmless.
    UTILS.storage.set(schemaKey(), String(SCHEMA_VERSION));
    const res = UTILS.storage.setDetailed(CONFIG.storage.key, serialized);
    lastError = res.ok ? null : res.reason;
    return res;
  }

  /** Reason for the most recent save/load failure ('quota' | 'unavailable' | 'newer-version' | 'invalid' | null). */
  function getLastError() { return lastError; }

  /**
   * Load a FeatureCollection from localStorage.
   * Validates strictly. Returns null on any error or invalid data,
   * and removes the bad blob to prevent repeated corruption.
   */
  function load() {
    // A newer app version may have written a format we cannot read — never
    // delete or trust it, just report and stay empty. Missing sidecar means
    // a legacy save, which loads exactly as before.
    const schemaRaw = UTILS.storage.get(schemaKey());
    if (schemaRaw !== null && schemaRaw !== undefined && schemaRaw !== '') {
      const schemaV = Number(schemaRaw);
      if (Number.isFinite(schemaV) && schemaV > SCHEMA_VERSION) {
        lastError = 'newer-version';
        return null;
      }
    }
    const raw = UTILS.storage.get(CONFIG.storage.key);
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      UTILS.storage.remove(CONFIG.storage.key);
      return null;
    }
    if (!GEOM.isValidFeatureCollection(parsed)) {
      UTILS.storage.remove(CONFIG.storage.key);
      return null;
    }
    return parsed;
  }

  /** Clear all stored data (fields blob + schema sidecar). */
  function clearAll() {
    UTILS.storage.remove(schemaKey());
    return UTILS.storage.remove(CONFIG.storage.key);
  }

  /**
   * Create a debounced save so rapid edits don't hammer storage.
   * Returns the wrapped function. Caller may call .flush() to force-write.
   */
  function debouncedSave(fn) {
    return UTILS.debounce(fn, CONFIG.storage.debounceMs);
  }

  global.FAC_STORAGE = { save, saveDetailed, load, clearAll, debouncedSave, getLastError, SCHEMA_VERSION };
})(window);
