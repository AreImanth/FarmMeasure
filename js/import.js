/**
 * import.js — GeoJSON / KML import handling.
 *
 * Parses user-supplied files, validates them strictly, converts to a
 * sanitized GeoJSON FeatureCollection of Polygons, and loads them into
 * the map. All parsing is local, no network.
 *
 * SECURITY:
 *  - Never eval() file content. JSON via JSON.parse, XML via DOMParser.
 *  - File size capped (5 MiB) and feature count capped (100) to avoid DoS.
 *  - Coordinates are numeric-validated; properties are whitelisted to string.
 *  - KML is parsed with DOMParser; we never innerHTML user data.
 *  - Invalid features are skipped with a count, not crash.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const GEOM = global.FAC_GEOMETRY;
  const UTILS = global.FAC_UTILS;
  const L = global.L;

  const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
  const MAX_FEATURES = 100;
  const MAX_VERTICES = CONFIG.drawing.maxVerticesPerPolygon;

  // -------------------------------------------------------------------------
  // GeoJSON handling
  // -------------------------------------------------------------------------

  /**
   * Normalize any valid GeoJSON input that contains polygon data into a
   * FeatureCollection<Polygon>. Accepts:
   *  - FeatureCollection
   *  - Feature (Polygon / MultiPolygon)
   *  - Geometry (Polygon / MultiPolygon)
   *  - Bare Polygon coordinates array is NOT accepted.
   * MultiPolygon is exploded into individual Polygon features.
   * Non-polygon geometries are dropped.
   * @param {*} parsed — result of JSON.parse
   * @returns {{ ok:boolean, fc: Object|null, error:string|null, skipped:number }}
   */
  function normalizeGeoJson(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, fc: null, error: t('imp.errNotJson', null, 'File is not valid JSON object.'), skipped: 0 };
    }

    let features = [];
    let skipped = 0;

    function pushPolygon(coords, props) {
      // coords is number[][][] for Polygon (first ring only for v1)
      if (!Array.isArray(coords) || !Array.isArray(coords[0])) {
        skipped += 1;
        return;
      }
      const ring = coords[0];
      if (!Array.isArray(ring) || ring.length < 4) {
        skipped += 1;
        return;
      }
      // Validate numeric coords
      for (let i = 0; i < ring.length; i += 1) {
        const pt = ring[i];
        if (!Array.isArray(pt) || pt.length < 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number' || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
          skipped += 1;
          return;
        }
      }
      // Clip vertices if needed
      const safeRing = ring.length > MAX_VERTICES + 1 ? ring.slice(0, MAX_VERTICES + 1) : ring;
      // Ensure closed
      const first = safeRing[0];
      const last = safeRing[safeRing.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        safeRing.push([first[0], first[1]]);
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [safeRing] },
        properties: sanitizeProps(props),
      });
    }

    if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
      for (let i = 0; i < parsed.features.length; i += 1) {
        const f = parsed.features[i];
        if (!f || f.type !== 'Feature' || !f.geometry) { skipped += 1; continue; }
        const g = f.geometry;
        if (g.type === 'Polygon') {
          pushPolygon(g.coordinates, f.properties);
        } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
          for (let j = 0; j < g.coordinates.length; j += 1) {
            pushPolygon(g.coordinates[j], f.properties);
          }
        } else {
          skipped += 1;
        }
      }
    } else if (parsed.type === 'Feature' && parsed.geometry) {
      const g = parsed.geometry;
      if (g.type === 'Polygon') {
        pushPolygon(g.coordinates, parsed.properties);
      } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
        for (let j = 0; j < g.coordinates.length; j += 1) {
          pushPolygon(g.coordinates[j], parsed.properties);
        }
      } else {
        skipped += 1;
      }
    } else if (parsed.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
      pushPolygon(parsed.coordinates, null);
    } else if (parsed.type === 'MultiPolygon' && Array.isArray(parsed.coordinates)) {
      for (let j = 0; j < parsed.coordinates.length; j += 1) {
        pushPolygon(parsed.coordinates[j], null);
      }
    } else {
      return { ok: false, fc: null, error: t('imp.errBadGeo', null, 'Unsupported GeoJSON type. Expected FeatureCollection of Polygons.'), skipped: skipped };
    }

    if (features.length === 0) {
      return { ok: false, fc: null, error: t('imp.errNoPoly', { skip: (skipped ? t('imp.errNoPolySkip', { n: skipped }, ' Skipped ' + skipped + ' non-polygon feature(s).') : '') }, 'No valid Polygon features found.' + (skipped ? ' Skipped ' + skipped + ' non-polygon feature(s).' : '')), skipped: skipped };
    }
    if (features.length > MAX_FEATURES) {
      skipped += features.length - MAX_FEATURES;
      features = features.slice(0, MAX_FEATURES);
    }

    const fc = { type: 'FeatureCollection', features: features };
    // Validate final shape via existing geometry validator
    if (!GEOM.isValidFeatureCollection(fc)) {
      return { ok: false, fc: null, error: t('imp.errValidFail', null, 'Parsed data failed validation.'), skipped: skipped };
    }
    return { ok: true, fc: fc, error: null, skipped: skipped };
  }

  /**
   * Parse raw text as GeoJSON.
   * @param {string} text
   * @returns {{ ok:boolean, fc:Object|null, error:string|null, skipped:number }}
   */
  function parseGeoJsonText(text) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, fc: null, error: t('imp.errEmpty', null, 'File is empty.'), skipped: 0 };
    }
    if (text.length > MAX_FILE_BYTES) {
      return { ok: false, fc: null, error: t('imp.errBig', null, 'File too large (max 5 MB).'), skipped: 0 };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, fc: null, error: t('imp.errJson', { e: (e.message || String(e)) }, 'Invalid JSON: ' + (e.message || String(e))), skipped: 0 };
    }
    return normalizeGeoJson(parsed);
  }

  // -------------------------------------------------------------------------
  // KML handling
  // -------------------------------------------------------------------------

  /**
   * Convert KML coordinates text ("lng,lat,alt lng,lat,alt ...") to [lng,lat] ring.
   * @param {string} coordText
   * @returns {Array<[number,number]>|null}
   */
  function kmlCoordsToRing(coordText) {
    if (!coordText || typeof coordText !== 'string') return null;
    const tokens = coordText.trim().split(/\s+/);
    const ring = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i].trim();
      if (!t) continue;
      const parts = t.split(',');
      if (parts.length < 2) continue;
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      // Clamp to valid world range silently; invalid lat/lng dropped
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      ring.push([lng, lat]);
    }
    if (ring.length < 3) return null;
    // Ensure closed
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
    if (ring.length < 4) return null;
    if (ring.length > MAX_VERTICES + 1) ring.length = MAX_VERTICES + 1; // truncate; caller re-closes if needed
    return ring;
  }

  /** Whitelist properties to safe string shape. */
  function sanitizeProps(raw) {
    if (!raw || typeof raw !== 'object') return { name: null };
    const out = {};
    if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 80);
    else if (typeof raw.Name === 'string' && raw.Name.trim()) out.name = raw.Name.trim().slice(0, 80);
    else out.name = null;
    return out;
  }

  /**
   * Parse KML text into FeatureCollection<Polygon>.
   * Supports Polygon outerBoundaryIs/LinearRing/coordinates. Inner holes ignored.
   * Supports MultiGeometry containing Polygons (exploded).
   * @param {string} text
   * @returns {{ ok:boolean, fc:Object|null, error:string|null, skipped:number }}
   */
  function parseKmlText(text) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, fc: null, error: t('imp.errEmpty', null, 'File is empty.'), skipped: 0 };
    }
    if (text.length > MAX_FILE_BYTES) {
      return { ok: false, fc: null, error: t('imp.errBig', null, 'File too large (max 5 MB).'), skipped: 0 };
    }
    let doc;
    try {
      const parser = new global.DOMParser();
      doc = parser.parseFromString(text, 'application/xml');
      const parserError = doc.getElementsByTagName('parsererror');
      if (parserError.length > 0) {
        return { ok: false, fc: null, error: t('imp.errKmlStruct', null, 'Invalid KML/XML structure.'), skipped: 0 };
      }
    } catch (e) {
      return { ok: false, fc: null, error: t('imp.errKml', { e: (e.message || String(e)) }, 'Failed to parse KML: ' + (e.message || String(e))), skipped: 0 };
    }

    const placemarks = doc.getElementsByTagName('Placemark');
    // KML may also use namespaced Placemark; getElementsByTagName handles it in most parsers.
    // Fallback: query all with localName
    const features = [];
    let skipped = 0;

    function extractRingsFromPlacemark(pm) {
      const rings = [];
      // Try to find all outerBoundaryIs -> coordinates inside this placemark
      // Use getElementsByTagName on the placemark node to scope search.
      const coordsEls = pm.getElementsByTagName('coordinates');
      // But only those inside a Polygon outerBoundaryIs should be considered.
      // We manually walk: Polygon -> outerBoundaryIs -> LinearRing -> coordinates
      const polygons = pm.getElementsByTagName('Polygon');
      if (polygons.length > 0) {
        for (let pi = 0; pi < polygons.length; pi += 1) {
          const poly = polygons[pi];
          // Find outerBoundaryIs within this polygon only
          let outer = null;
          for (let c = 0; c < poly.childNodes.length; c += 1) {
            const child = poly.childNodes[c];
            if (child.nodeType === 1 && child.localName === 'outerBoundaryIs') { outer = child; break; }
            if (child.nodeType === 1 && child.nodeName === 'outerBoundaryIs') { outer = child; break; }
          }
          // Fallback: query inside poly
          if (!outer) {
            const outers = poly.getElementsByTagName('outerBoundaryIs');
            if (outers.length > 0) outer = outers[0];
          }
          if (!outer) continue;
          const coordEl = outer.getElementsByTagName('coordinates')[0];
          if (!coordEl || !coordEl.textContent) continue;
          const ring = kmlCoordsToRing(coordEl.textContent);
          if (ring) rings.push({ ring: ring, nameEl: pm.getElementsByTagName('name')[0] });
        }
      } else if (coordsEls.length > 0) {
        // Edge: some exporters put coordinates directly under Placemark without Polygon wrapper
        // We treat as polygon if it looks like a ring
        for (let ci = 0; ci < coordsEls.length; ci += 1) {
          const el = coordsEls[ci];
          // Ensure not inside Point/LineString by checking ancestor
          let parent = el.parentNode;
          let isPolygonCoord = false;
          while (parent && parent !== pm) {
            const ln = parent.localName || parent.nodeName;
            if (ln === 'LinearRing' || ln === 'outerBoundaryIs' || ln === 'Polygon') { isPolygonCoord = true; break; }
            if (ln === 'Point' || ln === 'LineString') { isPolygonCoord = false; break; }
            parent = parent.parentNode;
          }
          // If no Polygon ancestor but direct, still try
          if (!isPolygonCoord && polygons.length === 0) isPolygonCoord = true;
          if (!isPolygonCoord) continue;
          const ring = kmlCoordsToRing(el.textContent);
          if (ring) rings.push({ ring: ring, nameEl: pm.getElementsByTagName('name')[0] });
        }
      }
      return rings;
    }

    const placemarkCount = placemarks.length;
    // Also consider case where KML has no Placemark but has bare Polygon at root
    if (placemarkCount === 0) {
      const polygons = doc.getElementsByTagName('Polygon');
      if (polygons.length > 0) {
        // Create synthetic placemarks
        for (let pi = 0; pi < polygons.length; pi += 1) {
          const poly = polygons[pi];
          const outerList = poly.getElementsByTagName('outerBoundaryIs');
          if (outerList.length === 0) { skipped += 1; continue; }
          const coordEl = outerList[0].getElementsByTagName('coordinates')[0];
          if (!coordEl || !coordEl.textContent) { skipped += 1; continue; }
          const ring = kmlCoordsToRing(coordEl.textContent);
          if (!ring) { skipped += 1; continue; }
          features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: { name: null },
          });
        }
      }
    } else {
      for (let i = 0; i < placemarks.length; i += 1) {
        const pm = placemarks[i];
        const nameEl = pm.getElementsByTagName('name')[0];
        const name = nameEl && nameEl.textContent ? nameEl.textContent.trim().slice(0, 80) : null;
        const rings = extractRingsFromPlacemark(pm);
        if (rings.length === 0) { skipped += 1; continue; }
        for (let r = 0; r < rings.length; r += 1) {
          if (features.length >= MAX_FEATURES) { skipped += rings.length - r; break; }
          features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [rings[r].ring] },
            properties: { name: name },
          });
        }
        if (features.length >= MAX_FEATURES) break;
      }
    }

    if (features.length === 0) {
      return { ok: false, fc: null, error: t('imp.errKmlNoPoly', { skip: (skipped ? t('imp.errKmlNoPolySkip', { n: skipped }, ' Skipped ' + skipped + '.') : '') }, 'No Polygon features found in KML.' + (skipped ? ' Skipped ' + skipped + '.' : '')), skipped: skipped };
    }
    if (features.length > MAX_FEATURES) {
      skipped += features.length - MAX_FEATURES;
      features.length = MAX_FEATURES;
    }

    const fc = { type: 'FeatureCollection', features: features };
    if (!GEOM.isValidFeatureCollection(fc)) {
      return { ok: false, fc: null, error: t('imp.errKmlValid', null, 'KML parsed but validation failed.'), skipped: skipped };
    }
    return { ok: true, fc: fc, error: null, skipped: skipped };
  }

  // -------------------------------------------------------------------------
  // Map integration
  // -------------------------------------------------------------------------

  /**
   * Import a FeatureCollection into the map.
   * @param {Object} fc — validated FeatureCollection<Polygon>
   * @param {Object} mapCtx — FAC_MAP context
   * @param {Object} [opts]
   * @param {boolean} [opts.replace=false] — if true, clear existing before import
   * @returns {{ imported:number, skipped:number }}
   */
  function importFeatureCollection(fc, mapCtx, opts) {
    if (!fc || !mapCtx) return { imported: 0, skipped: 0 };
    opts = opts || {};
    const replace = !!opts.replace;

    if (replace) {
      mapCtx.fieldGroup.clearLayers();
    }

    // Enforce global polygon limit (existing + new)
    const existingCount = mapCtx.fieldGroup.getLayers().filter(function (l) { return l instanceof L.Polygon; }).length;
    const room = Math.max(0, MAX_FEATURES - existingCount);
    let toImport = fc.features;
    let skippedDueToCap = 0;
    if (toImport.length > room) {
      skippedDueToCap = toImport.length - room;
      toImport = toImport.slice(0, room);
    }

    let imported = 0;
    const palette = CONFIG.drawing.palette;
    const startIdx = existingCount;

    for (let i = 0; i < toImport.length; i += 1) {
      const f = toImport[i];
      const ring = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
      if (!ring) continue;
      // Convert GeoJSON ring [lng,lat] to Leaflet LatLngs
      const latlngs = ring.map(function (pt) { return L.latLng(pt[1], pt[0]); });
      // Remove closing duplicate for Leaflet (it auto-closes)
      if (latlngs.length > 1 && latlngs[0].equals(latlngs[latlngs.length - 1])) {
        latlngs.pop();
      }
      const idx = startIdx + i;
      const color = palette[idx % palette.length];
      const name = (f.properties && typeof f.properties.name === 'string' && f.properties.name.trim())
        ? f.properties.name.trim().slice(0, 80)
        : 'Field ' + (idx + 1);
      const poly = L.polygon(latlngs, { color: color, fillColor: color, fillOpacity: 0.25 });
      poly.options.facMeta = {
        id: UTILS.makeId(),
        name: name,
        color: color,
        createdAt: Date.now(),
      };
      mapCtx.fieldGroup.addLayer(poly);
      imported += 1;
    }

    if (imported > 0) {
      mapCtx.fitToFields();
    }

    return { imported: imported, skipped: skippedDueToCap, totalSkipped: skippedDueToCap };
  }

  function t(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  /**
   * Handle a File object (from <input> or drop). Reads text, detects type,
   * parses, and imports. Shows toasts via ui.
   * @param {File} file
   * @param {Object} mapCtx
   * @param {Object} ui
   * @param {Object} drawing
   * @param {boolean} replace — true to replace, false to append
   * @returns {Promise<void>}
   */
  function handleFile(file, mapCtx, ui, drawing, replace) {
    return new Promise(function (resolve) {
      if (!file) {
        ui.toast(t('toast.impNoFile', null, 'No file selected.'), 'warn');
        resolve();
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        ui.toast(t('toast.impTooLarge', null, 'File too large. Max 5 MB.'), 'error', 5000);
        resolve();
        return;
      }
      const name = (file.name || '').toLowerCase();
      const isKml = name.endsWith('.kml');

      // Detect by content if extension missing: try JSON first
      const reader = new global.FileReader();
      reader.onerror = function () {
        ui.toast(t('toast.impReadFail', null, 'Failed to read file.'), 'error');
        resolve();
      };
      reader.onload = function (e) {
        const text = e.target.result;
        if (typeof text !== 'string') {
          ui.toast(t('toast.impNotText', null, 'Could not read file as text.'), 'error');
          resolve();
          return;
        }
        let result;
        // Heuristic: if filename says .kml OR content starts with <?xml/<kml, treat as KML
        const looksKml = isKml || text.trim().slice(0, 500).indexOf('<kml') !== -1 || text.trim().slice(0, 500).indexOf('<Folder') !== -1 || text.trim().slice(0, 500).indexOf('<Placemark') !== -1;
        if (looksKml) {
          result = parseKmlText(text);
        } else {
          result = parseGeoJsonText(text);
          // If JSON parse failed but looks like KML, try KML fallback
          if (!result.ok && text.indexOf('<coordinates') !== -1) {
            const kmlTry = parseKmlText(text);
            if (kmlTry.ok) result = kmlTry;
          }
        }

        if (!result.ok) {
          ui.toast(result.error || 'Import failed.', 'error', 6000);
          resolve();
          return;
        }

        // Confirm replace vs append if not already decided
        function doImport(doReplace) {
          const out = importFeatureCollection(result.fc, mapCtx, { replace: doReplace });
          // Persist
          const fc = mapCtx.toFeatureCollection();
          if (!global.FAC_STORAGE.save(fc)) {
            ui.toast(t('toast.importSaveFail', null, 'Imported, but could not save to this device — export GeoJSON to keep your fields.'), 'warn', 5000);
          }
          // Refresh UI
          ui.render();
          ui.refreshActionButtons();
          if (drawing && typeof drawing.on === 'function') {
            // Trigger save debounce listeners handled in app.js? We already saved directly.
          }
          let msg = t('imp.done', { n: out.imported }, 'Imported ' + out.imported + ' field(s).');
          if (result.skipped) msg += t('imp.skippedInvalid', { n: result.skipped }, ' Skipped ' + result.skipped + ' invalid.');
          if (out.skipped) msg += t('imp.skippedCap', { n: out.skipped, max: MAX_FEATURES }, ' Skipped ' + out.skipped + ' (limit ' + MAX_FEATURES + ').');
          ui.toast(msg, 'success', 4000);
          resolve();
        }

        const existingCount = mapCtx.fieldGroup.getLayers().length;
        if (existingCount > 0 && replace !== true && replace !== false) {
          // Step 1: offer Append. "Replace…" opens step 2 (replace confirmation).
          // Backdrop/Escape on step 2 cancels cleanly.
          ui.showConfirm({
            title: t('imp.title', { n: result.fc.features.length }, 'Import ' + result.fc.features.length + ' field(s)?'),
            message: t('imp.message', { n: existingCount }, 'You already have ' + existingCount + ' field(s). Append the imported fields, or replace everything?'),
            okLabel: t('imp.append', null, 'Append'),
            cancelLabel: t('imp.replace', null, 'Replace…'),
            onOk: function () { doImport(false); },
            onCancel: function () {
              ui.showConfirm({
                title: t('imp.replaceTitle', null, 'Replace all fields?'),
                message: t('imp.replaceMsg', { n: existingCount, m: result.fc.features.length },
                  'This will remove ' + existingCount + ' existing field(s) and import ' + result.fc.features.length + ' new.'),
                okLabel: t('imp.replaceOk', null, 'Replace all'),
                onOk: function () { doImport(true); },
                onCancel: function () { ui.toast(t('toast.importCancelled', null, 'Import cancelled.'), 'info'); resolve(); },
              });
            },
          });
        } else {
          doImport(!!replace);
        }
      };
      reader.readAsText(file);
    });
  }

  global.FAC_IMPORT = {
    parseGeoJsonText: parseGeoJsonText,
    parseKmlText: parseKmlText,
    importFeatureCollection: importFeatureCollection,
    handleFile: handleFile,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_FEATURES: MAX_FEATURES,
  };
})(window);
