/**
 * config.js — Application configuration constants.
 * All values that might need tweaking in one place.
 */

(function (global) {
  'use strict';

  const CONFIG = Object.freeze({
    version: '1.0.0',

    // Default map center: India-first. GPS / saved fields override on load.
    // Geographic centre of India ≈ 22.97 N, 78.65 E (zoom 5 shows whole country).
    defaultCenter: { lat: 22.97, lng: 78.65 },
    defaultZoom: 5,
    minZoom: 2,
    // Map may zoom to 22 for boundary tracing; tile layers overzoom past
    // their maxNativeZoom (vectors stay crisp, imagery scales gracefully).
    maxZoom: 22,

    // Tile providers. OSM raster is the free fallback; MapTiler Hybrid
    // satellite is the current active provider (set by `active` below).
    //
    // API KEY: placeholder __MAPTILER_KEY__ is replaced at build time via:
    //   MAPTILER_KEY=<key> npm run build   (scripts/inject-key.js)
    // Set MAPTILER_KEY in Cloudflare Pages (Settings > Environment variables)
    // or Amplify Console (Hosting > Environment variables) — never in git.
    // Locally, run `npm run key:local` to generate js/secrets.js (gitignored)
    // from your .env; it sets window.__MAPTILER_KEY__ before this file.
    tiles: Object.freeze({
      active: 'maptiler',
      osm: Object.freeze({
        name: 'OpenStreetMap',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22,
        maxNativeZoom: 19,
        subdomains: 'abc',
      }),
      maptiler: Object.freeze({
        name: 'MapTiler Hybrid',
        url:
          'https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?' +
          'key=' + (typeof window !== 'undefined' && window.__MAPTILER_KEY__ && window.__MAPTILER_KEY__ !== '__MAPTILER_KEY__' ? window.__MAPTILER_KEY__ : '__MAPTILER_KEY__'),
        attribution:
          '&copy; <a href="https://www.maptiler.com/">MapTiler</a>' +
          ' &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
        maxZoom: 22,
        maxNativeZoom: 19,
        subdomains: '', // MapTiler hybrid jpg tiles don't use subdomains
      }),
    }),

    // Geolocation
    geo: Object.freeze({
      enableHighAccuracy: true,
      timeoutMs: 10000,
      maximumAge: 0,
      // When GPS fails, stay over India so the map is never on a blank ocean
      fallbackOnError: { lat: 22.97, lng: 78.65, zoom: 5 },
    }),

    // Persistence
    storage: Object.freeze({
      key: 'fac:fields:v1',
      debounceMs: 500,
    }),

    // Drawing
    drawing: Object.freeze({
      // Colors used to cycle through polygons. Index by field creation order.
      palette: [
        '#2d5016', '#b8763b', '#6b4226', '#c4a83a',
        '#4a7c59', '#8c3a2e', '#5d6b8a', '#9b7a3f',
      ],
      maxVerticesPerPolygon: 1000, // DoS guard
      minVerticesForValid: 3,
    }),

    // Geometry
    geoValidation: Object.freeze({
      // Reject polygons whose bounding box exceeds this (in degrees).
      // 360 = whole earth. We accept anything; only block obvious garbage.
      maxBboxDegrees: 360,
      minAreaM2: 0.01, // anything smaller is considered a click, not a field
    }),

    // Report trust & legal — shown in every generated file + help.
    report: Object.freeze({
      disclaimer: 'Indicative measurement from user-drawn boundaries on satellite imagery. Not a legal survey — verify against revenue records or a licensed surveyor before financial or legal use.',
      disclaimerShort: 'Indicative measurement only — not a legal survey. Verify before financial/legal use.',
    }),
  });

  global.FAC_CONFIG = CONFIG;
})(window);
