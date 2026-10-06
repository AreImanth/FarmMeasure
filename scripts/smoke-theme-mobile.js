/**
 * scripts/smoke-theme-mobile.js — verifies the theme toggle also flips the
 * mobile bottom-sheet panel + its body content.
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
  await page.setViewport({ width: 414, height: 896 }); // mobile

  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1200));

  // Open the panel so we can read the body color too.
  await page.click('#panelHeader');
  await new Promise(r => setTimeout(r, 400));

  // Seed a field so we can read the field-item color too.
  await page.evaluate(() => {
    const ctx = window.__fac.mapCtx;
    const drawing = window.__fac.drawing;
    const ui = window.__fac.ui;
    const d = 0.0009009;
    const p = L.polygon([[0,20],[d,20],[d,20+d],[0,20+d]], { color: '#2d5016', fillColor: '#2d5016', fillOpacity: 0.25 });
    p.options.facMeta = { id: 't1', name: 'Mobile Test Field', color: '#2d5016', createdAt: Date.now() };
    ctx.fieldGroup.addLayer(p);
    ui.render();
  });
  await new Promise(r => setTimeout(r, 200));

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });

  async function readColors() {
    return page.evaluate(() => {
      const get = (sel, prop) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return getComputedStyle(el)[prop];
      };
      return {
        dataTheme: document.documentElement.dataset.theme,
        bodyBg: get('body', 'backgroundColor'),
        panelBg: get('.panel', 'backgroundColor'),
        panelColor: get('.panel', 'color'),
        headerBg: get('.app-header', 'backgroundColor'),
        totalsBg: get('.panel-totals', 'backgroundColor'),
        metricBg: get('#unitSelect', 'backgroundColor'),
        fieldItemBg: get('.field-item', 'backgroundColor'),
        fieldItemColor: get('.field-item', 'color'),
        gpsBtnBg: get('#gpsBtn', 'backgroundColor'),
      };
    });
  }

  const lightColors = await readColors();
  console.log('MOBILE LIGHT:', JSON.stringify(lightColors));

  await page.click('#themeToggleBtn');
  await new Promise(r => setTimeout(r, 300));
  const darkColors = await readColors();
  console.log('MOBILE DARK :', JSON.stringify(darkColors));

  await page.click('#themeToggleBtn');
  await new Promise(r => setTimeout(r, 300));
  const lightColors2 = await readColors();
  console.log('MOBILE LIGHT2:', JSON.stringify(lightColors2));

  console.log('errors:', errors);

  const fail = [];
  // Light expected
  if (lightColors.dataTheme !== 'light') fail.push('mobile light: data-theme');
  if (!/247,\s*246,\s*241/.test(lightColors.bodyBg)) fail.push('mobile light bodyBg: ' + lightColors.bodyBg);
  if (!/255,\s*255,\s*255/.test(lightColors.panelBg)) fail.push('mobile light panelBg: ' + lightColors.panelBg);
  if (!/45,\s*80,\s*22/.test(lightColors.headerBg)) fail.push('mobile light headerBg: ' + lightColors.headerBg);
  if (!/155,\s*209,\s*106/.test(lightColors.metricBg)) fail.push('mobile light metricBg: ' + lightColors.metricBg);
  // Dark expected
  if (darkColors.dataTheme !== 'dark') fail.push('mobile dark: data-theme');
  if (!/21,\s*23,\s*26/.test(darkColors.bodyBg)) fail.push('mobile dark bodyBg: ' + darkColors.bodyBg);
  if (!/29,\s*33,\s*37/.test(darkColors.panelBg)) fail.push('mobile dark panelBg: ' + darkColors.panelBg);
  if (!/111,\s*168,\s*61/.test(darkColors.headerBg)) fail.push('mobile dark headerBg: ' + darkColors.headerBg);
  if (!/111,\s*168,\s*61/.test(darkColors.metricBg)) fail.push('mobile dark metricBg: ' + darkColors.metricBg);
  // Round-trip
  if (lightColors2.panelBg !== lightColors.panelBg) fail.push('mobile round-trip: panel bg not restored');
  if (lightColors2.bodyBg !== lightColors.bodyBg) fail.push('mobile round-trip: body bg not restored');
  // Things must have actually changed
  if (lightColors.panelBg === darkColors.panelBg) fail.push('mobile panel bg did not flip');
  if (lightColors.bodyBg === darkColors.bodyBg) fail.push('mobile body bg did not flip');

  if (errors.length) fail.push('errors: ' + errors.join(' | '));

  await browser.close();
  if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
  console.log('PASS');
  process.exit(0);
})().catch(err => { console.error('CRASH:', err); process.exit(2); });