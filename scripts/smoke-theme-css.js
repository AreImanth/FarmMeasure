/**
 * scripts/smoke-theme.css.js — verifies the theme toggle actually changes
 * the visible colors on every key surface (panel, body, header, button).
 *
 * For each theme (light and dark), we read the computed background of:
 *   - body
 *   - .panel (sidebar / bottom-sheet)
 *   - .app-header (banner)
 *   - .panel-totals
 *   - .unit-select (the metric dropdown)
 *
 * and assert they match the expected tokens.
 */
const puppeteer = require('puppeteer-core');

const URL = 'http://127.0.0.1:8765/';

// Expected RGB values (computed by browser from hex tokens)
// light: bg=#f7f6f1, panel=#ffffff, header=#2d5016, totals=#e6efdb, metric=#9bd16a
// dark:  bg=#15171a, panel=#1d2125, header=#6fa83d, totals=#2a3818, metric=#6fa83d
const EXPECT = {
  light: {
    bodyBg:      /247,\s*246,\s*241/,  // #f7f6f1
    panelBg:     /255,\s*255,\s*255/,  // #ffffff
    headerBg:    /45,\s*80,\s*22/,     // #2d5016 leaf green
    totalsBg:    /230,\s*239,\s*219/,  // #e6efdb
    metricBg:    /155,\s*209,\s*106/,  // #9bd16a
    panelColor:  /31,\s*36,\s*33/,     // #1f2421 dark text
    bodyColor:   /31,\s*36,\s*33/,
  },
  dark: {
    bodyBg:      /21,\s*23,\s*26/,     // #15171a
    panelBg:     /29,\s*33,\s*37/,     // #1d2125
    headerBg:    /111,\s*168,\s*61/,   // #6fa83d
    totalsBg:    /42,\s*56,\s*24/,     // #2a3818
    metricBg:    /111,\s*168,\s*61/,   // #6fa83d
    panelColor:  /230,\s*232,\s*227/,  // #e6e8e3 light text
    bodyColor:   /230,\s*232,\s*227/,
  },
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1200));

  // Force light first to start clean.
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
        bodyColor: get('body', 'color'),
        panelBg: get('.panel', 'backgroundColor'),
        panelColor: get('.panel', 'color'),
        headerBg: get('.app-header', 'backgroundColor'),
        totalsBg: get('.panel-totals', 'backgroundColor'),
        metricBg: get('#unitSelect', 'backgroundColor'),
        metricColor: get('#unitSelect', 'color'),
      };
    });
  }

  const lightColors = await readColors();
  console.log('LIGHT:', JSON.stringify(lightColors, null, 2));

  // Click toggle → dark.
  await page.click('#themeToggleBtn');
  await new Promise(r => setTimeout(r, 300));
  const darkColors = await readColors();
  console.log('DARK :', JSON.stringify(darkColors, null, 2));

  // Click toggle → back to light.
  await page.click('#themeToggleBtn');
  await new Promise(r => setTimeout(r, 300));
  const lightColors2 = await readColors();
  console.log('LIGHT2:', JSON.stringify(lightColors2, null, 2));

  console.log('errors:', errors);

  const fail = [];
  // ---- Light assertions ----
  if (lightColors.dataTheme !== 'light') fail.push('light: data-theme not light');
  for (const [k, re] of Object.entries(EXPECT.light)) {
    const got = lightColors[k];
    if (!got || !re.test(got)) fail.push('light ' + k + ' got "' + got + '"');
  }
  // ---- Dark assertions ----
  if (darkColors.dataTheme !== 'dark') fail.push('dark: data-theme not dark');
  for (const [k, re] of Object.entries(EXPECT.dark)) {
    const got = darkColors[k];
    if (!got || !re.test(got)) fail.push('dark ' + k + ' got "' + got + '"');
  }
  // ---- Light → Dark → Light actually changed colors ----
  if (lightColors.panelBg === darkColors.panelBg) fail.push('panel bg did not change between light/dark');
  if (lightColors.bodyBg === darkColors.bodyBg) fail.push('body bg did not change between light/dark');
  if (lightColors.bodyColor === darkColors.bodyColor) fail.push('body color did not change between light/dark');
  if (lightColors.headerBg === darkColors.headerBg) fail.push('header bg did not change between light/dark');
  // ---- Round-trip ----
  if (lightColors2.panelBg !== lightColors.panelBg) fail.push('panel bg not restored after second toggle');
  if (lightColors2.bodyBg !== lightColors.bodyBg) fail.push('body bg not restored after second toggle');

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
  console.error('SMOKE THEME CSS TEST CRASHED:', err);
  process.exit(2);
});