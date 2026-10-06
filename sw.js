/**
 * sw.js — Service Worker for FarmMeasure.
 *
 * Goals (Manager/Dev/Auditor):
 *  - Offline shell: after once loading, HTML/CSS/JS/vendor all work offline (LAN or AWS).
 *  - Offline maps: tiles fetched once are cached (CacheFirst) so farmer can revisit field
 *    in flight mode and still see satellite/bunds.
 *  - Privacy: no analytics, cache is local device only. No tile data leaves device except
 *    initial fetch to OSM/MapTiler (already required).
 *  - Scalable: versioned caches, LRU cap on tile cache to avoid storage blow-up.
 *
 * Strategy:
 *  - STATIC_CACHE (precache on install): app shell + vendor — staleWhileRevalidate.
 *  - TILES_CACHE (runtime): map tiles — cacheFirst, max 300 entries with FIFO trim on insert (no TTL, no indexedDB, keeps SW tiny).
 *
 * NOTE: Service Worker requires HTTPS or http://localhost. On LAN 192.168.x.x
 * plain http, SW will not register — expected. On AWS (https) or localhost it works.
 */
'use strict';

const STATIC_CACHE = 'fac-static-v2';
const TILES_CACHE = 'fac-tiles-v1';
const TILES_MAX_ENTRIES = 300;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './vendor/leaflet/leaflet.css',
  './vendor/geoman/leaflet-geoman.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet-rotate.js',
  './vendor/geoman/leaflet-geoman.js',
  './vendor/turf/turf.min.js',
  './vendor/pako/pako.min.js',
  './vendor/jspdf/jspdf.umd.min.js',
  './vendor/html2canvas/html2canvas.min.js',
  './js/config.js',
  './js/utils.js',
  './js/units.js',
  './js/geometry.js',
  './js/storage.js',
  './js/map.js',
  './js/drawing.js',
  './js/geolocation.js',
  './js/ui.js',
  './js/pdf.js',
  './js/ui-state.js',
  './js/import.js',
  './js/bottom-sheet.js',
  './js/share.js',
  './js/mobile-menu.js',
  './js/tileview.js',
  './js/reporter.js',
  './js/i18n.js',
  './js/app.js',
  './lang/en.json',
  './lang/hi.json',
  './fonts/NotoSansDevanagari-Regular.ttf',
  './fonts/NotoSansDevanagari-Bold.ttf',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

function isTileRequest(url) {
  const host = url.hostname;
  return (
    host === 'api.maptiler.com' ||
    host.endsWith('.tile.openstreetmap.org') ||
    host.endsWith('.tile.opentopomap.org') ||
    host === 'server.arcgisonline.com'
  );
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept') && request.headers.get('accept').includes('text/html'));
}

// Install — precache shell
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () {
      return self.skipWaiting();
    }).catch(function (err) {
      // Precaching may fail on first install if some vendor file 404 — don't block install
      console.warn('[sw] precache failed', err);
    })
  );
});

// Activate — clean old caches, claim clients
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== STATIC_CACHE && k !== TILES_CACHE) {
          return caches.delete(k);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

async function trimTilesCache() {
  try {
    const cache = await caches.open(TILES_CACHE);
    const keys = await cache.keys();
    if (keys.length > TILES_MAX_ENTRIES) {
      const toDelete = keys.slice(0, keys.length - TILES_MAX_ENTRIES);
      await Promise.all(toDelete.map(function (r) { return cache.delete(r); }));
    }
  } catch (_) {}
}

// Fetch
self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Tiles — cacheFirst (offline maps after once loading)
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILES_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          return fetch(request).then(function (resp) {
            // Only cache valid images
            if (resp && resp.ok && resp.status === 200 && request.url.startsWith('http')) {
              const clone = resp.clone();
              cache.put(request, clone).then(function () { trimTilesCache(); });
            }
            return resp;
          }).catch(function () {
            // Offline and not cached — return cached fallback if any, else error
            return cached || Promise.reject('tile offline and not cached');
          });
        });
      })
    );
    return;
  }

  // Navigation — networkFirst fallback to cache (offline shell)
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then(function (resp) {
        // Update static cache with fresh index.html (staleWhileRevalidate for shell)
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(function (c) { c.put(request, clone); });
        }
        return resp;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match('./index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  // Static assets — staleWhileRevalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        const fetched = fetch(request).then(function (resp) {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then(function (c) { c.put(request, clone); });
          }
          return resp;
        }).catch(function () { return cached; });
        return cached || fetched;
      })
    );
  }
});

// Allow page to trigger skipWaiting via postMessage
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
