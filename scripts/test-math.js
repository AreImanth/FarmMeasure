/**
 * scripts/test-math.js — Node test suite for the pure-logic modules.
 *
 * Covers the revenue-critical math and data layer without a browser:
 *   - units.js    : area conversions (standard + Indian state units)
 *   - geometry.js : spherical-excess area, perimeter, centroid, GeoJSON validation
 *   - storage.js  : save/load round-trip, corruption handling, quota errors,
 *                   schema-version sidecar (legacy saves keep working)
 *   - utils.js    : number formatting, safe localStorage wrapper
 *
 * Run:  node scripts/test-math.js      (or: npm run test:math)
 * Exits 0 when every test passes, 1 otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const turf = require('../vendor/turf/turf.min.js');

/* ------------------------------------------------------------------ */
/* Tiny harness                                                        */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];
const asyncTests = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(name + ' — ' + (e && e.message ? e.message : String(e)));
  }
}

function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertClose(actual, expected, tol, msg) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error((msg ? msg + ' — ' : '') + 'expected ' + expected + ' ±' + tol + ', got ' + actual);
  }
}
function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  if (!threw) throw new Error((msg || 'expected throw') + ' — nothing thrown');
}

/* ------------------------------------------------------------------ */
/* Module loader — the app modules are IIFEs that attach to `window`.  */
/* Evaluate them against a shared mock window so the exact production  */
/* code paths run under test.                                          */
/* ------------------------------------------------------------------ */

const ROOT = path.join(__dirname, '..');

function makeWindow() {
  return {};
}

function loadModule(win, relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const fn = new Function('window', code);
  fn(win);
  return win;
}

/* ------------------------------------------------------------------ */
/* Mock localStorage                                                   */
/* ------------------------------------------------------------------ */

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _map: store,
  };
}

function makeQuotaLocalStorage() {
  const ls = makeLocalStorage();
  ls.setItem = () => {
    throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });
  };
  return ls;
}

function makeUnavailableLocalStorage() {
  return {
    getItem: () => { throw new Error('storage disabled'); },
    setItem: () => { throw new Error('storage disabled'); },
    removeItem: () => { throw new Error('storage disabled'); },
  };
}

/* ------------------------------------------------------------------ */
/* Shared window: config → utils → storage → geometry                  */
/* ------------------------------------------------------------------ */

const win = makeWindow();
loadModule(win, 'js/config.js');
loadModule(win, 'js/utils.js');
loadModule(win, 'js/units.js');
win.turf = turf;
loadModule(win, 'js/geometry.js');
loadModule(win, 'js/storage.js');

const UNITS = win.FAC_UNITS;
const GEOM = win.FAC_GEOMETRY;
const STORAGE = win.FAC_STORAGE;
const UTILS = win.FAC_UTILS;
const CONFIG = win.FAC_CONFIG;

/* ------------------------------------------------------------------ */
/* Test data — a true 100m × 100m square near lat 20.                  */
/* 1° lat ≈ 111,000 m; 1° lng at lat 20° is shorter by cos(20°), so     */
/* the lng step is widened to keep the square exactly square.          */
/* ------------------------------------------------------------------ */

const D_LAT = 100 / 111000;
const D_LNG = 100 / (111000 * Math.cos((20 * Math.PI) / 180));
const RING = [
  [0, 20],
  [D_LNG, 20],
  [D_LNG, 20 + D_LAT],
  [0, 20 + D_LAT],
  [0, 20],
];
const LATLNGS = RING.map((p) => ({ lat: p[1], lng: p[0] }));

function sampleFC() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [RING] },
        properties: { id: 'f1', name: 'Field 1', color: '#2d5016', createdAt: 1700000000000 },
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* units.js                                                            */
/* ------------------------------------------------------------------ */

test('units: 1 hectare = 10,000 m²', () => {
  assertClose(UNITS.fromSquareMeters(10000, 'ha'), 1, 1e-9);
  assertClose(UNITS.toSquareMeters(1, 'ha'), 10000, 1e-9);
});

test('units: 1 acre = 4046.8564224 m² (exact)', () => {
  assertClose(UNITS.fromSquareMeters(4046.8564224, 'ac'), 1, 1e-9);
  assertClose(UNITS.toSquareMeters(1, 'ac'), 4046.8564224, 1e-9);
});

test('units: 1 sq ft = 0.09290304 m² (NIST)', () => {
  assertClose(UNITS.toSquareMeters(1, 'sqft'), 0.09290304, 1e-12);
});

test('units: 1 cent = 1/100 acre', () => {
  assertClose(UNITS.toSquareMeters(1, 'cent'), 40.468564224, 1e-9);
  assertClose(UNITS.toSquareMeters(1, 'decimal'), 40.468564224, 1e-9);
});

test('units: 1 guntha = 1/40 acre', () => {
  assertClose(UNITS.toSquareMeters(1, 'guntha'), 101.17141056, 1e-9);
});

test('units: 1 ground = 2400 sq ft (Tamil Nadu)', () => {
  assertClose(UNITS.toSquareMeters(1, 'ground'), 222.967296, 1e-9);
});

test('units: 1 kanal = 1/8 acre', () => {
  assertClose(UNITS.toSquareMeters(1, 'kanal'), 505.8570528, 1e-9);
});

test('units: 1 marla = 1/20 kanal', () => {
  assertClose(UNITS.toSquareMeters(1, 'marla'), 25.29285264, 1e-9);
});

test('units: bigha variants are distinct (RJ ≠ UP ≠ PB)', () => {
  const rj = UNITS.toSquareMeters(1, 'bigha_rj');
  const up = UNITS.toSquareMeters(1, 'bigha_up');
  const pb = UNITS.toSquareMeters(1, 'bigha_pb');
  assertClose(rj, 2529.285264, 1e-6);
  assertClose(up, 1337.803776, 1e-6);
  assertClose(pb, 2023.4282112, 1e-6);
  assert(rj !== up && up !== pb && rj !== pb, 'bigha variants must differ');
});

test('units: katha variants are distinct (WB ≠ Bihar)', () => {
  const wb = UNITS.toSquareMeters(1, 'katha_wb');
  const bihar = UNITS.toSquareMeters(1, 'katha_bihar');
  assertClose(wb, 66.8901888, 1e-9);
  assertClose(bihar, 126.4644, 1e-6);
  assert(wb !== bihar, 'katha variants must differ');
});

test('units: round-trip through every supported unit', () => {
  UNITS.allUnits().forEach((u) => {
    const m2 = UNITS.toSquareMeters(1234.5, u);
    const back = UNITS.fromSquareMeters(m2, u);
    assertClose(back, 1234.5, 1e-6, 'round-trip failed for ' + u);
  });
});

test('units: unknown unit throws', () => {
  assertThrows(() => UNITS.fromSquareMeters(1, 'furlong'));
  assertThrows(() => UNITS.toSquareMeters(1, 'furlong'));
});

test('units: non-finite input returns 0', () => {
  assert(UNITS.fromSquareMeters(NaN, 'ha') === 0);
  assert(UNITS.fromSquareMeters(Infinity, 'ha') === 0);
});

test('units: meta() returns label and short symbol', () => {
  assert(UNITS.meta('ha').short === 'ha');
  assert(UNITS.meta('cent').short === 'cent');
  assert(UNITS.meta('bigha_up').short === 'bigha (UP)');
  assert(UNITS.meta('nonexistent').short === 'ha', 'meta falls back to hectare');
});

test('units: allUnits / standardUnits / stateUnits partition', () => {
  const all = UNITS.allUnits();
  assert(all.includes('m2') && all.includes('cent'), 'allUnits covers both tiers');
  assert(UNITS.standardUnits().every((u) => UNITS.stateUnits().indexOf(u) === -1),
    'standard and state lists must not overlap');
  assert(UNITS.allUnits().length === UNITS.standardUnits().length + UNITS.stateUnits().length,
    'allUnits = standard + state');
});

/* ------------------------------------------------------------------ */
/* geometry.js                                                         */
/* ------------------------------------------------------------------ */

test('geometry: 100m × 100m square ≈ 10,000 m² (±2%)', () => {
  const a = GEOM.polygonAreaSquareMeters(RING);
  assertClose(a, 10000, 200);
});

test('geometry: areaFromLatLngs matches ring input', () => {
  const a1 = GEOM.polygonAreaSquareMeters(RING);
  const a2 = GEOM.areaFromLatLngs(LATLNGS);
  assertClose(a1, a2, 1e-6);
});

test('geometry: areaFromLatLngs closes an open ring', () => {
  const open = LATLNGS.slice(0, 4); // no closing repeat
  const a = GEOM.areaFromLatLngs(open);
  assertClose(a, 10000, 200);
});

test('geometry: invalid input returns 0 (never throws)', () => {
  // geometry.js logs to console.error before returning 0 — expected.
  const origErr = console.error;
  console.error = () => {};
  try {
    assert(GEOM.polygonAreaSquareMeters(null) === 0);
    assert(GEOM.polygonAreaSquareMeters([]) === 0);
    assert(GEOM.polygonAreaSquareMeters([[0, 0], [1, 1]]) === 0, 'too few vertices');
    assert(GEOM.areaFromLatLngs(null) === 0);
    assert(GEOM.areaFromLatLngs([]) === 0);
    assert(GEOM.areaFromLatLngs([{ lat: 1, lng: 1 }]) === 0);
  } finally {
    console.error = origErr;
  }
});

test('geometry: perimeter of 100m square ≈ 400 m (±5%)', () => {
  const p = GEOM.perimeterMeters(LATLNGS);
  assertClose(p, 400, 20);
});

test('geometry: perimeter invalid input returns 0', () => {
  assert(GEOM.perimeterMeters(null) === 0);
  assert(GEOM.perimeterMeters([]) === 0);
  assert(GEOM.perimeterMeters([{ lat: 1, lng: 1 }]) === 0);
});

test('geometry: centroid sits at square centre', () => {
  const c = GEOM.centroidLngLat(LATLNGS);
  assert(c !== null, 'centroid should exist');
  assertClose(c.lng, D_LNG / 2, 1e-9);
  assertClose(c.lat, 20 + D_LAT / 2, 1e-9);
});

test('geometry: centroid of invalid input is null', () => {
  assert(GEOM.centroidLngLat(null) === null);
  assert(GEOM.centroidLngLat([]) === null);
});

test('geometry: isValidFeatureCollection accepts a valid FC', () => {
  assert(GEOM.isValidFeatureCollection(sampleFC()) === true);
  assert(GEOM.isValidFeatureCollection({ type: 'FeatureCollection', features: [] }) === true,
    'empty FC is valid');
});

test('geometry: isValidFeatureCollection rejects malformed input', () => {
  assert(GEOM.isValidFeatureCollection(null) === false);
  assert(GEOM.isValidFeatureCollection({}) === false);
  assert(GEOM.isValidFeatureCollection({ type: 'Feature', features: [] }) === false);
  assert(GEOM.isValidFeatureCollection({ type: 'FeatureCollection' }) === false);
  assert(GEOM.isValidFeatureCollection({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }],
  }) === false, 'non-Polygon geometry rejected');
  assert(GEOM.isValidFeatureCollection({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] } }],
  }) === false, 'ring with <4 points rejected');
  assert(GEOM.isValidFeatureCollection({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[['a', 0], [1, 1], [2, 2], ['a', 0]]] } }],
  }) === false, 'non-numeric coords rejected');
  assert(GEOM.isValidFeatureCollection({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] }, properties: 'evil' }],
  }) === false, 'non-object properties rejected');
});

/* ------------------------------------------------------------------ */
/* storage.js                                                          */
/* ------------------------------------------------------------------ */

test('storage: save → load round-trip preserves data', () => {
  win.localStorage = makeLocalStorage();
  const fc = sampleFC();
  assert(STORAGE.save(fc) === true);
  const loaded = STORAGE.load();
  assert(loaded !== null, 'should load');
  assert(loaded.features.length === 1);
  assert(loaded.features[0].properties.name === 'Field 1');
  assert(loaded.features[0].properties.id === 'f1');
});

test('storage: load with nothing saved returns null', () => {
  win.localStorage = makeLocalStorage();
  assert(STORAGE.load() === null);
});

test('storage: corrupt JSON returns null and removes the blob', () => {
  win.localStorage = makeLocalStorage();
  win.localStorage.setItem(CONFIG.storage.key, '{not json');
  assert(STORAGE.load() === null);
  assert(win.localStorage.getItem(CONFIG.storage.key) === null, 'corrupt blob must be removed');
});

test('storage: invalid FeatureCollection returns null and removes the blob', () => {
  win.localStorage = makeLocalStorage();
  win.localStorage.setItem(CONFIG.storage.key, JSON.stringify({ type: 'FeatureCollection', features: 'nope' }));
  assert(STORAGE.load() === null);
  assert(win.localStorage.getItem(CONFIG.storage.key) === null, 'invalid blob must be removed');
});

test('storage: clearAll removes fields and schema sidecar', () => {
  win.localStorage = makeLocalStorage();
  STORAGE.save(sampleFC());
  assert(STORAGE.load() !== null);
  STORAGE.clearAll();
  assert(STORAGE.load() === null);
  assert(win.localStorage.getItem(CONFIG.storage.key + ':schema') === null, 'sidecar removed');
});

test('storage: saveDetailed rejects invalid FC with reason "invalid"', () => {
  win.localStorage = makeLocalStorage();
  const res = STORAGE.saveDetailed(null);
  assert(res.ok === false && res.reason === 'invalid');
  const res2 = STORAGE.saveDetailed({ type: 'NotAFeatureCollection' });
  assert(res2.ok === false && res2.reason === 'invalid');
});

test('storage: quota error is classified as "quota"', () => {
  win.localStorage = makeQuotaLocalStorage();
  const res = STORAGE.saveDetailed(sampleFC());
  assert(res.ok === false && res.reason === 'quota');
});

test('storage: other storage failures are classified as "unavailable"', () => {
  win.localStorage = makeUnavailableLocalStorage();
  const res = STORAGE.saveDetailed(sampleFC());
  assert(res.ok === false && res.reason === 'unavailable');
});

test('storage: legacy save (no schema sidecar) still loads', () => {
  win.localStorage = makeLocalStorage();
  win.localStorage.setItem(CONFIG.storage.key, JSON.stringify(sampleFC()));
  // no :schema key written — exactly what an old app version leaves behind
  assert(STORAGE.load() !== null, 'legacy blob must load');
});

test('storage: newer schema version is refused, never deleted', () => {
  win.localStorage = makeLocalStorage();
  win.localStorage.setItem(CONFIG.storage.key, JSON.stringify(sampleFC()));
  win.localStorage.setItem(CONFIG.storage.key + ':schema', String(STORAGE.SCHEMA_VERSION + 1));
  assert(STORAGE.load() === null, 'future format must not load');
  assert(STORAGE.getLastError() === 'newer-version');
  assert(win.localStorage.getItem(CONFIG.storage.key) !== null, 'future blob must be preserved');
});

test('storage: getLastError is null after a successful save', () => {
  win.localStorage = makeLocalStorage();
  STORAGE.save(sampleFC());
  assert(STORAGE.getLastError() === null);
});

test('storage: debouncedSave returns a function with flush()', () => {
  win.localStorage = makeLocalStorage();
  let calls = 0;
  const d = STORAGE.debouncedSave(() => { calls++; });
  assert(typeof d === 'function' && typeof d.flush === 'function');
  d(); d(); d();
  d.flush();
  assert(calls === 1, 'rapid calls coalesce into one save');
});

testAsync('storage: debouncedSave fires once after the wait', async () => {
  win.localStorage = makeLocalStorage();
  let calls = 0;
  const d = STORAGE.debouncedSave(() => { calls++; });
  d(); d(); d();
  await new Promise((r) => setTimeout(r, CONFIG.storage.debounceMs + 100));
  assert(calls === 1, 'should fire exactly once after debounce window');
});

/* ------------------------------------------------------------------ */
/* utils.js                                                            */
/* ------------------------------------------------------------------ */

test('utils: formatNumber ranges', () => {
  assert(UTILS.formatNumber(0) === '0');
  assert(UTILS.formatNumber(0.5) === '0.5000');
  assert(UTILS.formatNumber(50) === '50.00');
  assert(UTILS.formatNumber(500) === '500.0');
  assert(UTILS.formatNumber(50000) === '50,000');
  assert(UTILS.formatNumber(NaN) === '—');
  assert(UTILS.formatNumber(Infinity) === '—');
});

test('utils: storage wrapper round-trips through mock localStorage', () => {
  win.localStorage = makeLocalStorage();
  assert(UTILS.storage.set('k', 'v') === true);
  assert(UTILS.storage.get('k') === 'v');
  assert(UTILS.storage.remove('k') === true);
  assert(UTILS.storage.get('k') === null);
});

test('utils: storage wrapper survives a dead localStorage', () => {
  win.localStorage = makeUnavailableLocalStorage();
  assert(UTILS.storage.get('k') === null, 'get returns null instead of throwing');
  assert(UTILS.storage.set('k', 'v') === false, 'set returns false instead of throwing');
  assert(UTILS.storage.remove('k') === false);
});

test('utils: setDetailed classifies quota vs unavailable', () => {
  win.localStorage = makeQuotaLocalStorage();
  const q = UTILS.storage.setDetailed('k', 'v');
  assert(q.ok === false && q.reason === 'quota');
  win.localStorage = makeUnavailableLocalStorage();
  const u = UTILS.storage.setDetailed('k', 'v');
  assert(u.ok === false && u.reason === 'unavailable');
});

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

function report() {
  console.log('\n=== MATH/STORAGE TESTS ===');
  console.log('passed: ' + passed + ', failed: ' + failed);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('ALL TESTS PASSED');
  process.exit(0);
}

if (asyncTests.length === 0) {
  report();
} else {
  (async () => {
    for (const t of asyncTests) {
      try {
        await t.fn();
        passed++;
      } catch (e) {
        failed++;
        failures.push(t.name + ' — ' + (e && e.message ? e.message : String(e)));
      }
    }
    report();
  })();
}
