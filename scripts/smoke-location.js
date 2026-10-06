/**
 * scripts/smoke-location.js — verifies the simple GPS flow.
 *
 * Expected behaviour (post-simplification):
 *   - Click "Use my location" → calls navigator.geolocation.getCurrentPosition directly
 *   - No pre-prompt modal, no permission-state branching, no err.code routing
 *   - On success: map recentred, status says "Centered on your location",
 *                success toast, gps-active privacy indicator on
 *   - On failure (any reason): single error toast "Your location couldn't
 *                be resolved.", status "Location unavailable",
 *                gps-active indicator cleared
 *   - No auto-fetch on page load
 */
const puppeteer = require('puppeteer-core');

const URL = 'http://127.0.0.1:8765/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const errors = [];
  async function newPage(viewport) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.setViewport(viewport || { width: 1280, height: 800 });
    page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
    });
    return page;
  }

  // Install geolocation mock via Object.defineProperty (direct assignment
  // gets clobbered by Chromium before page scripts run).
  async function installGeoMock(page, behaviour) {
    await page.evaluateOnNewDocument((b) => {
      window.__behaviour = b;
      window.__myGeo = {
        getCurrentPosition: function (ok, err) {
          window.__geo_called = (window.__geo_called || 0) + 1;
          setTimeout(() => {
            if (b === 'success') {
              ok({
                coords: { latitude: 17.385, longitude: 78.486, accuracy: 50 },
                timestamp: Date.now(),
              });
            } else {
              // Reject with a realistic error shape. Code value is ignored
              // by the simple flow.
              err({ code: 1, message: 'denied', PERMISSION_DENIED: true });
            }
          }, 30);
        }
      };
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        get: function () { return window.__myGeo; }
      });
    }, behaviour);
  }

  async function readState(page) {
    return page.evaluate(() => {
      const m = document.getElementById('confirmModal');
      const btn = document.getElementById('gpsBtn');
      const toast = document.querySelector('.toast');
      return {
        modalOpen: m && !m.hidden,
        btnActive: btn ? btn.classList.contains('gps-active') : null,
        statusText: document.getElementById('statusText').textContent,
        toastText: toast ? toast.textContent : null,
      };
    });
  }

  const fail = [];

  // ---- Case 1: success path ----
  {
    const page = await newPage();
    await installGeoMock(page, 'success');
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1200));

    const before = await readState(page);
    if (before.btnActive) fail.push('case1 setup: button should not be active before click');

    await page.click('#gpsBtn');
    await new Promise(r => setTimeout(r, 500));
    const after = await readState(page);
    console.log('case1 (success):', JSON.stringify(after));
    if (after.modalOpen) fail.push('case1: no modal should appear');
    if (!after.btnActive) fail.push('case1: gps-active indicator should be on after success');
    if (!/Centered/.test(after.statusText)) fail.push('case1: status should say Centered, got ' + after.statusText);
    if (!/Centered/.test(after.toastText || '')) fail.push('case1: success toast missing, got ' + after.toastText);
    await page.close();
  }

  // ---- Case 2: failure path (single toast) ----
  {
    const page = await newPage();
    await installGeoMock(page, 'failure');
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1200));

    await page.click('#gpsBtn');
    await new Promise(r => setTimeout(r, 500));
    const after = await readState(page);
    console.log('case2 (failure):', JSON.stringify(after));
    if (after.modalOpen) fail.push('case2: no modal should appear on failure');
    if (after.btnActive) fail.push('case2: gps-active indicator should be OFF after failure');
    if (!/Location unavailable/i.test(after.statusText)) fail.push('case2: status should say Location unavailable, got ' + after.statusText);
    if (!/Your location couldn’t be resolved/.test(after.toastText || '')) {
      fail.push('case2: toast text should contain the simple message');
    }
    await page.close();
  }

  // ---- Case 3: NO auto-fetch on page load ----
  {
    const page = await newPage();
    await page.evaluateOnNewDocument(() => {
      window.__myGeo = {
        getCurrentPosition: function () { window.__autoFetched = true; }
      };
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        get: function () { return window.__myGeo; }
      });
    });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));
    const autoFetched = await page.evaluate(() => !!window.__autoFetched);
    console.log('case3 auto-fetched on load:', autoFetched);
    if (autoFetched) fail.push('case3: location was auto-fetched on page load');
    await page.close();
  }

  console.log('errors:', errors);

  await browser.close();

  if (fail.length) {
    console.log('FAIL:', fail.join('; '));
    process.exit(1);
  } else {
    console.log('PASS');
    process.exit(0);
  }
})().catch(err => {
  console.error('SMOKE LOCATION TEST CRASHED:', err);
  process.exit(2);
});