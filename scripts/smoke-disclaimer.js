/**
 * scripts/smoke-disclaimer.js — focused test for the drawing-hint disclaimer.
 * Verifies: (a) Cancel hides the hint and stops draw mode,
 *           (b) Clear all also hides the hint,
 *           (c) geoman toolbar position on desktop.
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
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width: 1440, height: 900 }); // desktop

  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1200));

  // Start a draw by enabling polygon draw mode directly via the geoman API.
  // The polygon toolbar button transforms into action sub-buttons while
  // drawing, so clicking it from a test is unreliable — we drive the API.
  const started = await page.evaluate(() => {
    if (!window.__fac) return { ok: false, reason: 'no __fac' };
    // Find the map via __fac or via Leaflet DOM
    const map = window.__fac.mapCtx.map;
    if (!map || !map.pm) return { ok: false, reason: 'no map.pm' };
    try {
      map.pm.enableDraw('Polygon');
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  });
  console.log('start draw:', JSON.stringify(started));

  await new Promise(r => setTimeout(r, 400));

  const afterStart = await page.evaluate(() => ({
    hintHidden: document.getElementById('drawingHint').hidden,
    btnTitle: document.getElementById('cancelDrawingBtn').textContent,
  }));
  console.log('after start (hint should be visible):', JSON.stringify(afterStart));

  // Click cancel.
  await page.click('#cancelDrawingBtn');
  await new Promise(r => setTimeout(r, 500));

  const afterCancel = await page.evaluate(() => {
    const hint = document.getElementById('drawingHint');
    const toolbar = document.querySelector('.leaflet-pm-toolbar');
    const polyBtn = toolbar && (toolbar.querySelector('a.leaflet-pm-icon-polygon') ||
      Array.from(toolbar.querySelectorAll('a')).find(a => a.className.includes('polygon')));
    return {
      hintHidden: hint.hidden,
      hintDisplay: getComputedStyle(hint).display,
      polyBtnActive: polyBtn ? polyBtn.classList.contains('active') : null,
    };
  });
  console.log('after cancel (hint should be hidden):', JSON.stringify(afterCancel));

  // ---- Clear all should also dismiss hint ----
  // Seed a field so Clear all is enabled, then start draw again and click Clear.
  await page.evaluate(() => {
    // Drop a simple polygon via the drawing module
    const ctx = window.__fac.mapCtx;
    const drawing = window.__fac.drawing;
    const L = window.L;
    const ring = [[20, 0], [20, 0.0002], [20.0002, 0.0002], [20.0002, 0], [20, 0]];
    const latlngs = ring.map(p => [p[0], p[1]]);
    const poly = L.polygon(latlngs, { color: '#2d5016' });
    ctx.fieldGroup.addLayer(poly);
    drawing.updateMeta(poly, { id: 'test_clear_field', name: 'Test field', color: '#2d5016' });
    // Now enable draw mode
    ctx.map.pm.enableDraw('Polygon');
  });
  await new Promise(r => setTimeout(r, 300));
  const beforeClear = await page.evaluate(() => ({ hintHidden: document.getElementById('drawingHint').hidden }));
  console.log('draw restarted (hint visible):', JSON.stringify(beforeClear));

  // Open confirm modal and click OK.
  await page.click('#clearAllBtn');
  await new Promise(r => setTimeout(r, 200));
  // The confirm modal OK button is #confirmOk.
  await page.click('#confirmOk');
  await new Promise(r => setTimeout(r, 400));

  const afterClear = await page.evaluate(() => {
    const hint = document.getElementById('drawingHint');
    return {
      hintHidden: hint.hidden,
      hintDisplay: getComputedStyle(hint).display,
    };
  });
  console.log('after clear all (hint should be hidden):', JSON.stringify(afterClear));

  // ---- Desktop positioning: leaflet-top leaflet-left should be vertically centered ----
  const pos = await page.evaluate(() => {
    const tl = document.querySelector('.leaflet-top.leaflet-left');
    if (!tl) return null;
    const r = tl.getBoundingClientRect();
    const map = document.getElementById('map').getBoundingClientRect();
    return {
      mapH: map.height,
      toolbarTop: r.top,
      toolbarH: r.height,
      offsetFromMapTop: r.top - map.top,
      // expect roughly at vertical middle (within ~50px of mapH/2 - r.height/2)
      expectedTopApprox: (map.height - r.height) / 2,
    };
  });
  console.log('toolbar position on desktop:', JSON.stringify(pos));

  console.log('errors:', errors);

  // Assertions
  const fail = [];
  if (!started.ok) fail.push('could not start draw: ' + started.reason);
  if (afterStart.hintHidden) fail.push('hint not visible after draw start');
  if (!afterCancel.hintHidden) fail.push('hint still visible after Cancel click');
  if (beforeClear.hintHidden) fail.push('hint should be visible after second draw start (got hidden=true)');
  if (!afterClear.hintHidden) fail.push('hint still visible after Clear all');
  if (errors.length) fail.push('errors: ' + errors.join(' | '));
  if (pos) {
    const target = pos.expectedTopApprox;
    const diff = Math.abs(pos.offsetFromMapTop - target);
    if (diff > 80) fail.push('toolbar not vertically centered on desktop (offset=' + pos.offsetFromMapTop + ' expected~' + target + ')');
  } else {
    fail.push('toolbar container not found');
  }

  await browser.close();

  if (fail.length) {
    console.log('FAIL:', fail.join('; '));
    process.exit(1);
  } else {
    console.log('PASS');
    process.exit(0);
  }
})().catch(err => {
  console.error('SMOKE DISCLAIMER TEST CRASHED:', err);
  process.exit(2);
});