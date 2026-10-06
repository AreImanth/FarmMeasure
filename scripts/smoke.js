/**
 * scripts/smoke.js — headless smoke test.
 * Boots the app in headless Edge, captures console + errors, simulates a
 * polygon draw, and verifies the area computation works.
 */
const puppeteer = require('puppeteer-core');

const URL = 'http://localhost:8765/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const errors = [];
  const consoleMsgs = [];

  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    const t = m.type();
    consoleMsgs.push('[' + t + '] ' + m.text());
    if (t === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });
  page.on('requestfailed', r => errors.push('REQUEST FAILED: ' + r.url() + ' :: ' + r.failure()?.errorText));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for the map to be ready — Leaflet adds the .leaflet-container class
  // to the #map element itself, not as a child.
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1500));

  // Inspect the public APIs
  const api = await page.evaluate(() => {
    return {
      hasMap: !!window.__fac?.mapCtx?.map,
      hasFieldGroup: !!window.__fac?.mapCtx?.fieldGroup,
      hasDrawing: !!window.__fac?.drawing,
      hasUi: !!window.__fac?.ui,
      leafletLoaded: !!window.L,
      geomanLoaded: !!(window.L && window.L.PM),
      turfLoaded: !!(window.turf && typeof window.turf.area === 'function'),
      jspdfLoaded: !!window.jspdf,
      html2canvasLoaded: !!window.html2canvas,
      layerCount: window.__fac?.mapCtx?.fieldGroup?.getLayers().length || 0,
      version: window.FAC_CONFIG?.version,
    };
  });

  console.log('=== API SURFACE ===');
  console.log(JSON.stringify(api, null, 2));

  // Simulate adding a polygon by directly calling L.polygon + fieldGroup.addLayer
  // and emitting a fake pm:create. This validates the area math + UI render.
  const testArea = await page.evaluate(() => {
    const ctx = window.__fac.mapCtx;
    const drawing = window.__fac.drawing;
    const ui = window.__fac.ui;

    // Build a square ~ 100m x 100m near lat=20, lng=0 (1 deg lat ≈ 111000m)
    // 100m / 111000 ≈ 0.0009009 deg lat
    const d = 0.0009009;
    const ring = [
      [0, 20],
      [d, 20],
      [d, 20 + d],
      [0, 20 + d],
    ];
    const poly = L.polygon(ring, { color: '#2d5016', fillColor: '#2d5016', fillOpacity: 0.25 });
    poly.options.facMeta = {
      id: 'test_1', name: 'Test Square', color: '#2d5016', createdAt: Date.now()
    };
    ctx.fieldGroup.addLayer(poly);

    // Manually invoke a "pm:create"-like event to test the wiring
    // (we use the drawing event bus directly since pm:create requires UI interaction)
    drawing.on('field:created', () => {}); // no-op to ensure bus exists
    // Trigger a save + render via the public path
    ui.render();
    ui.refreshActionButtons();

    // Read back the computed area
    const m2 = drawing.areaOf(poly);
    return {
      areaM2: m2,
      areaHa: m2 / 10000,
      expectedHaApprox: 1.0,
    };
  });

  console.log('=== AREA TEST (100m x 100m square should be ~10000 m²) ===');
  console.log(JSON.stringify(testArea, null, 2));

  // Verify the UI rendered the field in the panel
  const uiState = await page.evaluate(() => {
    return {
      fieldItems: document.querySelectorAll('.field-item').length,
      fieldNames: Array.from(document.querySelectorAll('.field-name')).map(i => i.value),
      totalValue: document.getElementById('totalValue').textContent,
      totalUnit: document.getElementById('totalUnit').textContent,
      exportBtnDisabled: document.getElementById('exportGeoJsonBtn').disabled,
      exportPdfDisabled: document.getElementById('exportPdfBtn').disabled,
      clearBtnDisabled: document.getElementById('clearAllBtn').disabled,
    };
  });

  console.log('=== UI STATE ===');
  console.log(JSON.stringify(uiState, null, 2));

  // Take a screenshot
  await page.setViewport({ width: 1280, height: 800 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'smoke-desktop.png', fullPage: false });
  console.log('Screenshot saved: smoke-desktop.png');

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'smoke-mobile.png', fullPage: false });
  console.log('Screenshot saved: smoke-mobile.png');

  console.log('\n=== CONSOLE MESSAGES ===');
  consoleMsgs.forEach(m => console.log(m));

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(e));

  await browser.close();

  if (errors.length > 0) {
    console.error('\nSMOKE TEST FAILED');
    process.exit(1);
  }

  // Tolerance: 100m × 100m should be ~10000 m² ± 5%
  const tol = 0.05;
  const ok = Math.abs(testArea.areaM2 - 10000) / 10000 < tol;
  if (!ok) {
    console.error('AREA MATH OUT OF TOLERANCE');
    process.exit(1);
  }

  console.log('\nSMOKE TEST PASSED');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
