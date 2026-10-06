/**
 * scripts/smoke-theme-toggle.js — focused check for the theme toggle wiring
 * and the unit-select color change.
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
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1200));

  // Force light mode first so the test is deterministic.
  const STORAGE_KEY = 'fac:fields:v1:theme';
  await page.evaluate((k) => {
    document.documentElement.dataset.theme = 'light';
    try { localStorage.setItem(k, 'light'); } catch (e) {}
  }, STORAGE_KEY);

  const before = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    btnExists: !!document.getElementById('themeToggleBtn'),
  }));

  // Click the toggle once → should go dark.
  await page.click('#themeToggleBtn');
  await new Promise(r => setTimeout(r, 300));
  const afterClick1 = await page.evaluate((k) => ({
    theme: document.documentElement.dataset.theme,
    stored: (() => { try { return localStorage.getItem(k); } catch (e) { return null; } })(),
  }), STORAGE_KEY);

  // Click again → should go back to light.
  await page.click('#themeToggleBtn');
  await new Promise(r => setTimeout(r, 300));
  const afterClick2 = await page.evaluate((k) => ({
    theme: document.documentElement.dataset.theme,
    stored: (() => { try { return localStorage.getItem(k); } catch (e) { return null; } })(),
  }), STORAGE_KEY);

  // Verify the unit-select got the new light-green background.
  const colors = await page.evaluate(() => {
    const el = document.getElementById('unitSelect');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      color: cs.color,
      borderColor: cs.borderTopColor,
      fontWeight: cs.fontWeight,
    };
  });

  console.log('=== THEME TOGGLE TEST ===');
  console.log('before:', JSON.stringify(before));
  console.log('after click 1 (expect dark):', JSON.stringify(afterClick1));
  console.log('after click 2 (expect light):', JSON.stringify(afterClick2));
  console.log('unit-select computed:', JSON.stringify(colors));
  console.log('errors:', errors);

  // Assertions
  const fail = [];
  if (!before.btnExists) fail.push('theme toggle button missing');
  if (afterClick1.theme !== 'dark') fail.push('toggle did not switch to dark');
  if (afterClick2.theme !== 'light') fail.push('toggle did not switch back to light');
  if (afterClick1.stored !== 'dark') fail.push('theme not persisted as dark');
  if (afterClick2.stored !== 'light') fail.push('theme not persisted as light');
  if (!colors) fail.push('unit-select missing');
  else {
    // Accept either light-mode token (#9bd16a) or dark-mode token (#6fa83d) — both light-green.
    const lightOk = /155,\s*209,\s*106/.test(colors.background);
    const darkOk  = /111,\s*168,\s*61/.test(colors.background);
    if (!lightOk && !darkOk) fail.push('unit-select bg not light green: ' + colors.background);
    // Accept either near-black text color.
    const textLightOk = /31,\s*36,\s*33/.test(colors.color);
    const textDarkOk  = /14,\s*18,\s*8/.test(colors.color);
    if (!textLightOk && !textDarkOk) fail.push('unit-select color not dark text: ' + colors.color);
  }
  if (errors.length) fail.push('console/page errors: ' + errors.join(' | '));

  await browser.close();

  if (fail.length) {
    console.log('FAIL:', fail.join('; '));
    process.exit(1);
  } else {
    console.log('PASS');
    process.exit(0);
  }
})().catch(err => {
  console.error('SMOKE THEME TEST CRASHED:', err);
  process.exit(2);
});