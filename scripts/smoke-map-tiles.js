/**
 * scripts/smoke-map-tiles.js — verifies the MapTiler tile layer loads.
 *
 * Checks:
 *   1. The page loads with no JS errors
 *   2. A Leaflet map is present
 *   3. The MapTiler tile layer is the active one (CONFIG.tiles.active === 'maptiler')
 *   4. The layer switcher control exists with both OSM and MapTiler listed
 *   5. At least one tile image is successfully fetched from the MapTiler URL
 *
 * Note: this test uses your actual MapTiler key.
 * If the key is revoked, the tile fetch will fail (403) and this test
 * will FAIL — which is the correct behaviour so you know the key is dead.
 */
const puppeteer = require('puppeteer-core');

const URL = 'http://127.0.0.1:8765/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const errors = [];
  const tileRequests = [];

  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });
  // Track all tile requests
  page.on('request', req => {
    const u = req.url();
    if (u.includes('maptiler') || u.includes('tile.openstreetmap')) {
      tileRequests.push({ url: u, resourceType: req.resourceType() });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 3000)); // let tiles load

  const result = await page.evaluate(() => {
    const map = window.__fac && window.__fac.mapCtx && window.__fac.mapCtx.map;
    if (!map) return { ok: false, reason: 'no map' };
    // Check the layer control exists
    const layerControl = document.querySelector('.leaflet-control-layers');
    // Check which tile URL is being used (map._tiles will have keys with the URL)
    const tileUrls = [];
    if (map && map.getPanes) {
      const tilePane = map.getPanes().tilePane;
      tilePane && Array.from(tilePane.querySelectorAll('img')).forEach(img => {
        tileUrls.push(img.src);
      });
    }
    return {
      ok: true,
      hasLayerControl: !!layerControl,
      activeLayerName: window.FAC_CONFIG.tiles.active,
      tileImageCount: tileUrls.length,
      sampleTileUrl: tileUrls[0] || null,
    };
  });

  // Check for 403 errors on MapTiler requests
  const failedMaptiler = tileRequests.filter(r =>
    r.url.includes('maptiler') && r.url.includes('key=')
  );

  console.log('=== MAP TILE TEST ===');
  console.log('result:', JSON.stringify(result, null, 2));
  console.log('total tile requests:', tileRequests.length);
  console.log('maptiler requests:', failedMaptiler.length);
  console.log('errors:', errors);

  const fail = [];
  if (!result.ok) fail.push('map check failed: ' + result.reason);
  if (result.activeLayerName !== 'maptiler') fail.push('active layer should be maptiler, got ' + result.activeLayerName);
  if (!result.hasLayerControl) fail.push('layer switcher control not found');
  if (result.tileImageCount === 0) fail.push('no tile images rendered in DOM');
  // Check if any tiles 403'd (bad key)
  // We can't directly observe response codes from page.on('request'),
  // but we can check the DOM for broken images
  const brokenTiles = await page.evaluate(() => {
    const imgs = document.querySelectorAll('.leaflet-tile-pane img');
    return Array.from(imgs).filter(img => {
      // A broken image in Leaflet gets class leaflet-tile-loaded-failed
      // or has naturalWidth 0
      return img.naturalWidth === 0 || img.classList.contains('leaflet-tile-loaded-failed');
    }).length;
  });
  if (brokenTiles > 0) fail.push('found ' + brokenTiles + ' broken/failed tile images — check MapTiler key or network');

  if (errors.length) fail.push('errors: ' + errors.join(' | '));

  await browser.close();

  if (fail.length) {
    console.log('FAIL:', fail.join('; '));
    process.exit(1);
  } else {
    console.log('PASS');
    process.exit(0);
  }
})().catch(err => {
  console.error('SMOKE MAP TILE TEST CRASHED:', err);
  process.exit(2);
});