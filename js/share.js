/**
 * share.js — per-field hash sharing (LAN -> AWS free, no backend).
 *
 * One field = one hash:  https://example.com/#f=<base64url(pako(deflate(json)))>
 *
 * Design:
 *  - Payload is minimal: {v:1, n:name, c:color, g:[[lng,lat],...]}
 *  - Coordinates rounded to 6 decimals (~10cm) to save ~35% chars.
 *  - Compressed with pako (vendored) -> base64url. Fallback to plain base64 json if pako missing.
 *  - Decoded only via strict validation (geometry + whitelist) before touching map.
 *  - Hash is #f= so it never hits server/logs; cleared via replaceState after import.
 *
 * SCALABILITY:
 *  - This module is transport-agnostic. Later `/s/<id>` short links can reuse
 *    `encodePayload`/`decodePayload` and just store the blob in DynamoDB/S3.
 *
 * SECURITY:
 *  - Never eval, never innerHTML. Payload validated same as import.js.
 *  - Name truncated to 80, color validated to hex, coords clamped to world, vertices capped.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const GEOM = global.FAC_GEOMETRY;
  const STORAGE = global.FAC_STORAGE;
  const UTILS = global.FAC_UTILS;
  const L = global.L;

  const HASH_KEY = 'f';
  const PAYLOAD_VERSION = 1;
  const MAX_VERTICES = CONFIG ? CONFIG.drawing.maxVerticesPerPolygon : 1000;
  const COORD_PRECISION = 6;
  const MAX_ENCODED_LEN = 4000; // single field should never exceed this; guard for abuse
  const HASH_PREFIX = '#' + HASH_KEY + '=';

  // -------------------------------------------------------------------------
  // Encoding helpers — base64url + pako
  // -------------------------------------------------------------------------

  function toBase64Url(bytes) {
    // bytes: Uint8Array -> binary string -> btoa -> url safe
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = global.btoa(binary);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(b64url) {
    // base64url -> base64 -> Uint8Array
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    // pad
    while (b64.length % 4) b64 += '=';
    const binary = global.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function roundCoord(n) {
    // 6 decimals, no trailing zeros bloat (JSON will serialize minimal)
    const p = Math.pow(10, COORD_PRECISION);
    return Math.round(n * p) / p;
  }

  function sanitizeName(raw) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().slice(0, 80);
    return t.length ? t : null;
  }

  function isValidHexColor(raw) {
    return typeof raw === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw);
  }

  // -------------------------------------------------------------------------
  // Payload create / validate
  // -------------------------------------------------------------------------

  /**
   * Build minimal share payload from a Leaflet polygon layer.
   * @param {L.Polygon} layer
   * @param {Object} meta — from mapCtx.readMeta(layer)
   * @returns {Object|null} payload or null if invalid
   */
  function createPayloadForLayer(layer, meta) {
    if (!layer || !(layer instanceof L.Polygon)) return null;
    const latlngs = layer.getLatLngs()[0];
    if (!Array.isArray(latlngs) || latlngs.length < 3) return null;
    // Convert to [lng,lat] with 6-decimal rounding, world-clamped
    const ring = [];
    for (let i = 0; i < latlngs.length; i++) {
      const p = latlngs[i];
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
      if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return null;
      ring.push([roundCoord(p.lng), roundCoord(p.lat)]);
    }
    // Ensure closed (first === last) for GeoJSON spec; receiver will handle both
    if (ring.length > 0) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
    }
    if (ring.length < 4) return null;
    // Cap vertices (DoS guard) — truncate, re-close
    let safeRing = ring;
    if (ring.length > MAX_VERTICES + 1) {
      safeRing = ring.slice(0, MAX_VERTICES);
      const f = safeRing[0];
      const l = safeRing[safeRing.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) safeRing.push([f[0], f[1]]);
    }
    const name = sanitizeName(meta && meta.name);
    const color = isValidHexColor(meta && meta.color) ? meta.color : (CONFIG.drawing.palette[0] || '#2d5016');
    return {
      v: PAYLOAD_VERSION,
      n: name,
      c: color,
      g: safeRing,
    };
  }

  function isValidPayload(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.v !== PAYLOAD_VERSION) return false;
    if (obj.n !== null && typeof obj.n !== 'string') return false;
    if (obj.n && obj.n.length > 80) return false;
    if (typeof obj.c !== 'string' || !isValidHexColor(obj.c)) return false;
    if (!Array.isArray(obj.g) || obj.g.length < 4) return false;
    if (obj.g.length > MAX_VERTICES + 1) return false;
    for (let i = 0; i < obj.g.length; i++) {
      const pt = obj.g[i];
      if (!Array.isArray(pt) || pt.length !== 2) return false;
      if (typeof pt[0] !== 'number' || typeof pt[1] !== 'number') return false;
      if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false;
      if (pt[1] < -90 || pt[1] > 90 || pt[0] < -180 || pt[0] > 180) return false;
    }
    // Must be closed
    const first = obj.g[0];
    const last = obj.g[obj.g.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return false;
    // Also validate via geometry helper by building a FeatureCollection
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [obj.g] }, properties: {} },
      ],
    };
    return GEOM.isValidFeatureCollection(fc);
  }

  // -------------------------------------------------------------------------
  // Encode / decode
  // -------------------------------------------------------------------------

  function encodePayload(payload) {
    const json = JSON.stringify(payload);
    // Prefer pako deflate if available
    if (global.pako && typeof global.pako.deflate === 'function') {
      try {
        const bytes = global.pako.deflate(json);
        const b64url = toBase64Url(bytes);
        // Mark as compressed with leading '.'? No — try decompress first, fallback to plain
        return b64url;
      } catch (_) {
        // fall through to plain
      }
    }
    // Fallback: plain utf8 -> base64url (no compression)
    try {
      const bytes = new TextEncoder().encode(json);
      return toBase64Url(bytes);
    } catch (_) {
      // Last fallback: btoa on json (ascii safe? names may be unicode)
      return toBase64Url(new TextEncoder().encode(json));
    }
  }

  function decodePayload(b64url) {
    if (typeof b64url !== 'string' || !b64url.length) return null;
    if (b64url.length > MAX_ENCODED_LEN) return null;
    // Sanitize: only base64url chars
    if (!/^[A-Za-z0-9_-]+$/.test(b64url)) return null;
    let bytes;
    try {
      bytes = fromBase64Url(b64url);
    } catch (_) {
      return null;
    }
    // Try pako inflate first, then plain utf8
    let json = null;
    if (global.pako && typeof global.pako.inflate === 'function') {
      try {
        json = global.pako.inflate(bytes, { to: 'string' });
        // Validate it looks like json
        if (json && json[0] === '{') {
          const parsed = JSON.parse(json);
          return parsed;
        }
      } catch (_) {
        // not pako-compressed, try plain
      }
    }
    try {
      json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function buildLink(b64url) {
    const base = global.location.href.split('#')[0];
    return base + HASH_PREFIX + b64url;
  }

  function parseHash() {
    const hash = global.location.hash || '';
    if (!hash.startsWith(HASH_PREFIX)) return null;
    const b64url = hash.slice(HASH_PREFIX.length).trim();
    if (!b64url) return null;
    return b64url;
  }

  // -------------------------------------------------------------------------
  // Public: generate link for a layer
  // -------------------------------------------------------------------------

  function generateLinkForLayer(layer, meta) {
    const payload = createPayloadForLayer(layer, meta);
    if (!payload) return null;
    const b64url = encodePayload(payload);
    if (!b64url || b64url.length > MAX_ENCODED_LEN) return null;
    return buildLink(b64url);
  }

  function t(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  // -------------------------------------------------------------------------
  // Public: try to load shared field from hash on boot
  // Returns true if a valid shared field was handled (even if user cancelled)
  // -------------------------------------------------------------------------

  function tryLoadFromHash(mapCtx, ui) {
    const b64url = parseHash();
    if (!b64url) return false;
    const payload = decodePayload(b64url);
    if (!payload || !isValidPayload(payload)) {
      // Invalid hash — clear it quietly, don't break boot
      clearHash();
      if (ui && ui.toast) ui.toast(t('toast.shareInvalid', null, 'Invalid or corrupted share link.'), 'error', 5000);
      return false;
    }

    // Payload valid — ask user to Add. We don't auto-save/view-only silently
    // because the link holder may have existing fields they don't want to mix.
    const name = payload.n || 'Shared field';
    // Compute area for confirmation message (safe, validated ring)
    let areaM2 = 0;
    try {
      areaM2 = GEOM.polygonAreaSquareMeters(payload.g);
    } catch (_) { areaM2 = 0; }
    const areaStr = areaM2 ? UTILS.formatNumber(global.FAC_UNITS.fromSquareMeters(areaM2, 'ha')) + ' ha' : '';

    const doAdd = function () {
      try {
        const latlngs = payload.g.map(function (pt) { return L.latLng(pt[1], pt[0]); });
        // Remove closing duplicate for Leaflet
        if (latlngs.length > 1 && latlngs[0].equals(latlngs[latlngs.length - 1])) latlngs.pop();
        // Check global cap (100 fields)
        const existing = mapCtx.fieldGroup.getLayers().filter(function (l) { return l instanceof L.Polygon; }).length;
        if (existing >= 100) {
          if (ui && ui.toast) ui.toast(t('toast.shareLimit', null, 'Cannot add shared field — limit of 100 fields reached.'), 'warn', 5000);
          clearHash();
          return;
        }
        const poly = L.polygon(latlngs, { color: payload.c, fillColor: payload.c, fillOpacity: 0.25 });
        poly.options.facMeta = {
          id: UTILS.makeId(),
          name: name,
          color: payload.c,
          createdAt: Date.now(),
        };
        mapCtx.fieldGroup.addLayer(poly);
        // Persist + render
        try {
          const fc = mapCtx.toFeatureCollection();
          if (!STORAGE.save(fc) && ui && ui.toast) {
            ui.toast(t('toast.shareSaveFail', null, 'Field added, but could not save to this device — export GeoJSON to keep it.'), 'warn', 5000);
          }
        } catch (_) {}
        if (ui && ui.render) ui.render();
        if (mapCtx.fitToFields) mapCtx.fitToFields();
        // Zoom to the new field specifically
        try {
          const b = poly.getBounds();
          if (b.isValid()) mapCtx.map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
        } catch (_) {}
        if (ui && ui.toast) ui.toast(t('toast.shareAdded', { name: name, area: (areaStr ? ' (' + areaStr + ')' : '') },
          'Added shared field "' + name + '"' + (areaStr ? ' (' + areaStr + ')' : '') + '.'), 'success', 4000);
      } catch (e) {
        if (ui && ui.toast) ui.toast(t('toast.shareFailed', null, 'Failed to add shared field.'), 'error');
        console.error('[share] add failed', e);
      } finally {
        clearHash();
      }
    };

    const doCancel = function () {
      clearHash();
      if (ui && ui.toast) ui.toast(t('toast.shareDismissed', null, 'Share link dismissed.'), 'info', 2500);
    };

    // Use existing confirm modal — no new UI needed on boot
    if (ui && ui.showConfirm) {
      ui.showConfirm({
        title: t('share.openTitle', null, 'Open shared field?'),
        message: t('share.openMsg', { name: name, area: (areaStr ? ' — ' + areaStr : '') },
          '"' + name + '"' + (areaStr ? ' — ' + areaStr : '') + ' — Add this field to your map? (Hash link works offline and is not stored on any server. Measurements are indicative, not a legal survey.)'),
        okLabel: t('share.openOk', null, 'Add to map'),
        cancelLabel: t('share.openCancel', null, 'Dismiss'),
        onOk: doAdd,
        onCancel: doCancel,
      });
    } else {
      doAdd();
    }
    return true;
  }

  function clearHash() {
    try {
      // Keep query search, drop hash only; use replaceState so back button not polluted
      const clean = global.location.pathname + global.location.search;
      global.history.replaceState(null, '', clean);
    } catch (_) {
      // fallback
      global.location.hash = '';
    }
  }

  // -------------------------------------------------------------------------
  // Sharing helpers (clipboard, Web Share, WhatsApp)
  // -------------------------------------------------------------------------

  function copyText(text) {
    // Modern async clipboard, fallback to execCommand
    if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
      return global.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    return new Promise(function (resolve) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        resolve(!!ok);
      } catch (_) {
        resolve(false);
      }
    });
  }

  function canWebShare() {
    return !!(global.navigator && typeof global.navigator.share === 'function');
  }

  function whatsappLink(url, name) {
    const text = 'Field "' + (name || 'Shared field') + '" — ' + url + ' — open in FarmMeasure';
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  global.FAC_SHARE = {
    createPayloadForLayer: createPayloadForLayer,
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    buildLink: buildLink,
    parseHash: parseHash,
    generateLinkForLayer: generateLinkForLayer,
    tryLoadFromHash: tryLoadFromHash,
    clearHash: clearHash,
    copyText: copyText,
    canWebShare: canWebShare,
    whatsappLink: whatsappLink,
    HASH_KEY: HASH_KEY,
    MAX_ENCODED_LEN: MAX_ENCODED_LEN,
  };
})(window);
