/**
 * drawing.js — leaflet-geoman wrapper.
 *
 * Geoman gives us:
 *   - polygon draw mode (click to add vertices)
 *   - edit mode (drag vertices, drag polygon)
 *   - removal mode (click polygon to delete)
 *   - live area readout while drawing/editing
 *
 * We add:
 *   - color cycling: new polygons get the next color from the palette
 *   - metadata attachment: id/name/color persist through GeoJSON round-trips
 *   - event normalization: emits a small set of events that app.js consumes
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const UTILS = global.FAC_UTILS;
  const GEOM = global.FAC_GEOMETRY;
  const L = global.L;

  /**
   * Translate with hardcoded English fallback (lazy: i18n.js loads later).
   */
  function t(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  /**
   * Configure geoman on a map.
   * @param {Object} ctx — the object returned by FAC_MAP.create(...)
   * @returns {Object} drawing API
   */
  function setup(ctx) {
    const map = ctx.map;
    const fieldGroup = ctx.fieldGroup;
    const distanceGroup = ctx.distanceGroup;

    if (!global.L || !global.L.PM) {
      throw new Error('[drawing] leaflet-geoman not loaded');
    }

    // Track how many fields we've created so we can cycle colors.
    let fieldCount = countExistingFields(ctx);

    // Configure geoman global options. We only allow polygon creation/editing.
    map.pm.addControls({
      position: 'topleft',
      drawCircle: false,
      drawCircleMarker: false,
      drawMarker: false,
      drawPolygon: true,
      drawPolyline: false,
      drawRectangle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
      editMode: true,
      dragMode: false,
      removalMode: true,
    });

    // Polish: set the geoman language to English (already default but explicit)
    map.pm.setLang('en');

    // Style new polygons: filled with the next palette color, semi-transparent.
    map.pm.setGlobalOptions({
      snappable: true,
      snapDistance: 20,
      allowSelfIntersection: false,
      requireSnapToFinish: false,
      finishOn: 'dblclick',
      // Hide Geoman's follow-cursor tooltip ("Click to continue drawing")
      // that sits under the last vertex and blocks the map. Our own
      // #drawingHint covers the first-point instruction and auto-hides.
      tooltips: false,
      pathOptions: {
        color: nextColor(fieldCount),
        fillColor: nextColor(fieldCount),
        fillOpacity: 0.25,
        weight: 2,
      },
    });

    /** Compute the color a freshly-drawn polygon should get. */
    function nextColor(idx) {
      return CONFIG.drawing.palette[idx % CONFIG.drawing.palette.length];
    }

    /** Haversine distance between two lat/lng points in meters. */
    function haversineMeters(lat1, lng1, lat2, lng2) {
      const R = 6371000; // Earth radius in meters
      const toRad = function (deg) { return deg * Math.PI / 180; };
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return R * 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
    }

    /** Total geodesic distance of a polyline's lat/lng sequence in meters. */
    function measureDistance(latLngs) {
      const points = latLngs instanceof L.LatLng ? [latLngs] : Array.isArray(latLngs) ? latLngs : [];
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        total += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      }
      return total;
    }

    function countExistingFields(ctxLocal) {
      return ctxLocal.fieldGroup.getLayers().filter(l => l instanceof L.Polygon).length;
    }

    // --- Event: polygon finished being drawn ---
    map.on('pm:create', function (e) {
      const layer = e.layer;
      if (!(layer instanceof L.Polygon)) {
        // Geoman can create other shapes if controls re-enabled; drop them.
        fieldGroup.removeLayer(layer);
        return;
      }
      const idx = fieldCount++;
      const meta = {
        id: UTILS.makeId(),
        name: t('panel.fieldWord', null, 'Field') + ' ' + (idx + 1),
        color: CONFIG.drawing.palette[idx % CONFIG.drawing.palette.length],
        createdAt: Date.now(),
      };
      layer.options.facMeta = meta;
      layer.setStyle({
        color: meta.color,
        fillColor: meta.color,
        fillOpacity: 0.25,
      });
      fieldGroup.addLayer(layer);
      emit('field:created', { layer, meta });
    });

    // --- Event: vertex or polygon edited ---
    map.on('pm:edit', function (e) {
      // Geoman emits one edit event per affected layer.
      const layers = Array.isArray(e.layer) ? e.layer : [e.layer];
      for (const layer of layers) {
        if (fieldGroup.hasLayer(layer)) {
          emit('field:edited', { layer });
        }
      }
    });

    // --- Event: polygon removed ---
    map.on('pm:remove', function (e) {
      const layer = e.layer;
      if (fieldGroup.hasLayer(layer)) {
        fieldGroup.removeLayer(layer);
        emit('field:removed', { layer });
      }
    });

    // --- Event: polyline created for distance measurement ---
    // Polylines are added to distanceGroup, not fieldGroup.
    // They use the next color from the palette for visual consistency.
    map.on('pm:create', function (e) {
      const layer = e.layer;
      if (!(layer instanceof L.Polyline)) return;
      // Only handle distance polylines when polyline draw mode is active.
      const idx = fieldCount++;
      const color = CONFIG.drawing.palette[idx % CONFIG.drawing.palette.length];
      layer.setStyle({
        color: color,
        weight: 3,
        opacity: 0.8,
      });
      distanceGroup.addLayer(layer);
      const distMeters = measureDistance(layer.getLatLngs());
      emit('distance:created', { layer, distanceMeters: distMeters, color: color });
    });

    // --- Event: distance polyline removed ---
    map.on('pm:remove', function (e) {
      const layer = e.layer;
      if (distanceGroup.hasLayer(layer)) {
        distanceGroup.removeLayer(layer);
        emit('distance:removed', { layer });
      }
    });

    // --- Hint visibility: show a banner while drawing ---
    // Senior: banner only for first vertex, then hidden to avoid covering the field.
    // Help modal + help (?) button above toolbar provide persistent instructions instead.
    map.on('pm:drawstart', function () { emit('draw:start'); });
    map.on('pm:drawend',   function () { emit('draw:end'); });
    // Hide the banner after the first vertex is placed — free screen for plotting
    map.on('pm:vertexadded', function () { emit('draw:vertexadded'); });
    // Fallback for geoman versions that emit `pm:change` with vertex count
    map.on('pm:change', function () { emit('draw:vertexadded'); });

    // --- Listen for live area updates (geoman displays on-polygon text) ---
    // We don't need to handle this; geoman renders it natively. We re-compute
    // totals in our own UI on pm:create / pm:edit / pm:remove.

    // --- Simple event bus local to this module ---
    const listeners = {};
    function on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
    }
    function emit(evt, payload) {
      (listeners[evt] || []).forEach(fn => {
        try { fn(payload); } catch (err) { console.error('[drawing] listener error', err); }
      });
    }

    /**
     * Cancel any active draw mode. Useful if user clicks Cancel in the UI.
     */
    function cancelDraw() {
      try { map.pm.Draw.Polygon.revertLayers(); } catch (_) {}
      try { map.pm.Draw.Polyline.revertLayers(); } catch (_) {}
      try { map.pm.disableDraw('Polygon'); } catch (_) {}
      try { map.pm.disableDraw('Polyline'); } catch (_) {}
    }

    /**
     * Switch to polyline drawing mode for distance measurement.
     * Disables polygon drawing and enables polyline drawing.
     */
    function drawDistance() {
      try { map.pm.disableDraw('Polygon'); } catch (_) {}
      try { map.pm.enableDraw('Polyline'); } catch (_) {}
    }

    /**
     * Switch back to polygon drawing mode. Disables polyline drawing.
     */
    function stopDistance() {
      try { map.pm.disableDraw('Polyline'); } catch (_) {}
      try { map.pm.enableDraw('Polygon'); } catch (_) {}
    }

    /**
     * Check if polyline drawing mode is currently active.
     */
    function isDistanceMode() {
      try { return map.pm.Draw && map.pm.Draw.Polyline && map.pm.isDrawing('Polyline'); } catch (_) { return false; }
    }

    /**
     * Programmatically remove a single polygon layer. Used by the UI list.
     */
    function removeLayer(layer) {
      if (fieldGroup.hasLayer(layer)) {
        fieldGroup.removeLayer(layer);
        emit('field:removed', { layer });
      }
    }

    /**
     * Update a layer's metadata. Used when the user renames a field.
     */
    function updateMeta(layer, partial) {
      ctx.writeMeta(layer, partial);
      // Re-style if color changed
      if (partial.color) {
        layer.setStyle({
          color: partial.color,
          fillColor: partial.color,
          fillOpacity: 0.25,
        });
      }
      emit('field:edited', { layer });
    }

    /**
     * Get a layer's area in m² — convenience.
     */
    function areaOf(layer) {
      if (layer instanceof L.Polygon) {
        return GEOM.areaFromLatLngs(layer.getLatLngs()[0]);
      }
      return 0;
    }

    /**
     * Get a layer's boundary length in meters (geodesic) — fencing estimates.
     */
    function perimeterOf(layer) {
      if (layer instanceof L.Polygon) {
        return GEOM.perimeterMeters(layer.getLatLngs()[0]);
      }
      return 0;
    }

    return { on, cancelDraw, removeLayer, updateMeta, areaOf, perimeterOf, drawDistance, stopDistance, isDistanceMode, getFieldCount: function () { return fieldCount; }, setFieldCount: function (n) { fieldCount = n; } };
  }

  global.FAC_DRAWING = { setup };
})(window);
