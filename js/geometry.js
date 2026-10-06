/**
 * geometry.js — area calculation and GeoJSON validation.
 *
 * Uses Turf.js (@turf/area) which implements the spherical-excess formula.
 * This is the correct way to compute polygon areas on a curved Earth and is
 * significantly more accurate than Leaflet's planar default.
 *
 * SECURITY: All input is validated before being passed to Turf. We never
 * eval, never render raw coordinates, never trust the input shape.
 */
(function (global) {
  'use strict';

  const turf = global.turf;
  const CONFIG = global.FAC_CONFIG;

  if (!turf || typeof turf.area !== 'function') {
    console.error('[geometry] Turf.js not loaded — area calculation will fail.');
  }

  /**
   * Compute the area of a polygon in square meters.
   * @param {Array<[number,number]>} ring — closed ring of [lng, lat] pairs.
   *   First and last coordinates must be equal (Leaflet convention).
   * @returns {number} area in m² (0 on invalid input)
   */
  function polygonAreaSquareMeters(ring) {
    if (!Array.isArray(ring) || ring.length < CONFIG.geoValidation.minVerticesForValid) {
      return 0;
    }
    if (ring.length > CONFIG.drawing.maxVerticesPerPolygon + 1) {
      console.warn('[geometry] polygon exceeds max vertices; clipping for area calc only');
    }
    try {
      // Turf wants GeoJSON: [lng, lat] order, closed ring, polygon needs
      // at least 4 points (3 unique + closing repeat). We feed it directly.
      const safeRing = ring.slice(0, CONFIG.drawing.maxVerticesPerPolygon + 1);
      const polygon = turf.polygon([safeRing]);
      return turf.area(polygon);
    } catch (err) {
      console.error('[geometry] area calc failed:', err);
      return 0;
    }
  }

  /**
   * Compute the area of a Leaflet LatLng[] array (what geoman gives us).
   * @param {Array<{lat:number, lng:number}>} latlngs
   * @returns {number} area in m²
   */
  function areaFromLatLngs(latlngs) {
    if (!Array.isArray(latlngs) || latlngs.length < 3) return 0;
    const ring = latlngs.map(p => [p.lng, p.lat]);
    // Ensure closed
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    return polygonAreaSquareMeters(ring);
  }

  /**
   * Compute the perimeter (geodesic length) of a polygon in meters.
   * Useful for Phase 2 (fencing estimates). Implemented now since it's free.
   * @param {Array<{lat:number, lng:number}>} latlngs
   * @returns {number} perimeter in meters
   */
  function perimeterMeters(latlngs) {
    if (!Array.isArray(latlngs) || latlngs.length < 2) return 0;
    try {
      const ring = latlngs.map(p => [p.lng, p.lat]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      if (ring.length < 4) return 0;
      const line = turf.polygonToLine(turf.polygon([ring]));
      return turf.length(line, { units: 'meters' });
    } catch (err) {
      console.error('[geometry] perimeter calc failed:', err);
      return 0;
    }
  }

  /**
   * Compute the centroid (lng, lat) of a polygon.
   * Used for placing labels and zooming to a field.
   */
  function centroidLngLat(latlngs) {
    if (!Array.isArray(latlngs) || latlngs.length < 3) return null;
    try {
      const ring = latlngs.map(p => [p.lng, p.lat]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      const c = turf.centroid(turf.polygon([ring]));
      const coords = c.geometry.coordinates;
      return { lng: coords[0], lat: coords[1] };
    } catch (_) {
      return null;
    }
  }

  /**
   * Validate that a value looks like a sanitized GeoJSON FeatureCollection of
   * Polygons. Used when loading from localStorage — refuses anything weird.
   *
   * NOTE: We only validate the STRUCTURE here (geometry, types, numeric coords).
   * Property contents are not validated by this function — they are filtered
   * to a known-safe shape by map.js's loadFeatureCollection.
   */
  function isValidFeatureCollection(value) {
    if (!value || typeof value !== 'object') return false;
    if (value.type !== 'FeatureCollection') return false;
    if (!Array.isArray(value.features)) return false;
    for (const f of value.features) {
      if (!f || f.type !== 'Feature') return false;
      if (!f.geometry || f.geometry.type !== 'Polygon') return false;
      if (!Array.isArray(f.geometry.coordinates)) return false;
      const ring = f.geometry.coordinates[0];
      if (!Array.isArray(ring) || ring.length < 4) return false;
      for (const pt of ring) {
        if (!Array.isArray(pt) || pt.length !== 2) return false;
        if (typeof pt[0] !== 'number' || typeof pt[1] !== 'number') return false;
        if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false;
      }
      // Properties may be absent or an object — accept either.
      if (f.properties !== undefined && (typeof f.properties !== 'object' || f.properties === null)) {
        return false;
      }
    }
    return true;
  }

  global.FAC_GEOMETRY = {
    polygonAreaSquareMeters,
    areaFromLatLngs,
    perimeterMeters,
    centroidLngLat,
    isValidFeatureCollection,
  };
})(window);
