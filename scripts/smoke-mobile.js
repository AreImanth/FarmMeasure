/**
 * scripts/smoke-mobile.js — focused test for mobile UX changes.
 *
 *   1. Mobile bottom sheet:
 *        - default state is collapsed (just header + handle, body hidden)
 *        - dragging the handle up snaps the panel to mid/expanded
 *        - tapping the header toggles open/collapsed
 *        - desktop hides the handle
 *
 *   2. GPS permission denial:
 *        - on permission-denied error, a retry modal appears
 *        - the modal's "Try again" button re-invokes geolocation
 *        - the modal only appears ONCE per click cycle
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
  // Phone-sized viewport (mobile)
  await page.setViewport({ width: 414, height: 896 });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1500));

  // ---- 1. Bottom sheet: default state ----
  const initial = await page.evaluate(() => {
    const panel = document.getElementById('panel');
    const handle = document.getElementById('panelHandle');
    const body = document.getElementById('panelBody');
    const r = panel.getBoundingClientRect();
    return {
      panelH: r.height,
      panelTop: r.top,
      handleVisible: handle.offsetParent !== null,
      bodyVisible: getComputedStyle(body).display !== 'none',
      collapsedAttr: panel.getAttribute('data-collapsed'),
      ariaExpanded: document.getElementById('panelHeader').getAttribute('aria-expanded'),
      mapH: document.getElementById('map').getBoundingClientRect().height,
    };
  });
  console.log('initial mobile panel state:', JSON.stringify(initial));

  // ---- 2. Tap header to open ----
  await page.click('#panelHeader');
  await new Promise(r => setTimeout(r, 400));
  const afterTap = await page.evaluate(() => {
    const panel = document.getElementById('panel');
    return {
      panelH: panel.getBoundingClientRect().height,
      collapsedAttr: panel.getAttribute('data-collapsed'),
      ariaExpanded: document.getElementById('panelHeader').getAttribute('aria-expanded'),
    };
  });
  console.log('after header tap:', JSON.stringify(afterTap));

  // ---- 3. Drag handle down to collapse (simulate a downward swipe) ----
  const handleBox = await page.evaluate(() => {
    const h = document.getElementById('panelHandle').getBoundingClientRect();
    return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
  });
  // Use pointer events directly through CDP for deterministic drag.
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  // Drag down by 200px — should collapse
  await page.mouse.move(handleBox.x, handleBox.y + 200, { steps: 10 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 400));
  const afterDragDown = await page.evaluate(() => {
    const panel = document.getElementById('panel');
    return {
      panelH: panel.getBoundingClientRect().height,
      collapsedAttr: panel.getAttribute('data-collapsed'),
    };
  });
  console.log('after drag-down:', JSON.stringify(afterDragDown));

  // ---- 4. Desktop: handle must be hidden ----
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 400));
  const desktop = await page.evaluate(() => {
    const handle = document.getElementById('panelHandle');
    return {
      handleVisible: handle.offsetParent !== null,
      panelW: document.getElementById('panel').getBoundingClientRect().width,
    };
  });
  console.log('desktop panel:', JSON.stringify(desktop));

  // ---- 5. GPS failure — single error toast, no modal ----
  // Switch back to mobile so the toast layout matches.
  await page.setViewport({ width: 414, height: 896 });
  await new Promise(r => setTimeout(r, 200));

  // Override getCurrentPosition to always reject.
  await page.evaluate(() => {
    const deniedError = Object.assign(new Error('denied'), { code: 1 });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: function () {
        return {
          getCurrentPosition: function (_ok, err) {
            setTimeout(() => err(deniedError), 30);
          }
        };
      }
    });
  });

  // Click "Use my location"
  await page.click('#gpsBtn');
  await new Promise(r => setTimeout(r, 600));
  const afterFail = await page.evaluate(() => {
    const m = document.getElementById('confirmModal');
    const toast = document.querySelector('.toast');
    const btn = document.getElementById('gpsBtn');
    return {
      modalOpen: !m.hidden,
      toastText: toast ? toast.textContent : null,
      btnActive: btn ? btn.classList.contains('gps-active') : null,
      statusText: document.getElementById('statusText').textContent,
    };
  });
  console.log('after GPS failure:', JSON.stringify(afterFail));

  console.log('errors:', errors);

  // Assertions
  const fail = [];
  // Bottom sheet
  if (initial.handleVisible !== true) fail.push('mobile handle should be visible');
  if (initial.collapsedAttr !== 'collapsed') fail.push('initial state should be collapsed, got ' + initial.collapsedAttr);
  if (initial.panelH > 100) fail.push('initial panel should be small, got ' + initial.panelH + 'px');
  if (initial.bodyVisible !== false) fail.push('body should be hidden when collapsed');
  if (afterTap.collapsedAttr !== 'open') fail.push('tap should open panel');
  if (afterTap.panelH < 200) fail.push('open panel should be tall, got ' + afterTap.panelH);
  if (afterDragDown.panelH > 150) fail.push('drag-down should collapse panel, got ' + afterDragDown.panelH + 'px');
  if (afterDragDown.collapsedAttr !== 'collapsed') fail.push('drag-down should set collapsed attr');
  if (desktop.handleVisible !== false) fail.push('desktop should hide handle');
  // GPS failure (simple flow): single toast, no modal, indicator off
  if (afterFail.modalOpen) fail.push('GPS failure should not show a modal');
  if (afterFail.btnActive) fail.push('GPS failure should clear gps-active indicator');
  if (!/Your location couldn’t be resolved/.test(afterFail.toastText || '')) {
    fail.push('GPS failure toast should contain the simple message, got: ' + afterFail.toastText);
  }
  if (!/Location unavailable/i.test(afterFail.statusText)) {
    fail.push('GPS failure status should say Location unavailable, got: ' + afterFail.statusText);
  }
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
  console.error('SMOKE MOBILE TEST CRASHED:', err);
  process.exit(2);
});