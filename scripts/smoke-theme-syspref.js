/**
 * scripts/smoke-theme-syspref.js — verifies that when the user has NOT made
 * an explicit choice (data-theme="auto" or no data-theme attr), the system
 * prefers-color-scheme still drives the appearance.
 */
const puppeteer = require('puppeteer-core');
const URL = 'http://127.0.0.1:8765/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const fail = [];

  async function readBg(page) {
    return page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
  }

  // --- Case 1: system dark, no data-theme attr → should be dark ---
  {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    // Clear data-theme so we test the fallback path
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    const bg = await readBg(page);
    console.log('sys=dark, no data-theme → body bg:', bg);
    if (!/21,\s*23,\s*26/.test(bg)) fail.push('sys dark fallback: expected #15171a, got ' + bg);
    await page.close();
  }

  // --- Case 2: system dark, user chose LIGHT → should be light ---
  {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    const bg = await readBg(page);
    console.log('sys=dark, user=light → body bg:', bg);
    if (!/247,\s*246,\s*241/.test(bg)) fail.push('explicit light overrides sys dark: expected #f7f6f1, got ' + bg);
    await page.close();
  }

  // --- Case 3: system light, user chose DARK → should be dark ---
  {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    const bg = await readBg(page);
    console.log('sys=light, user=dark → body bg:', bg);
    if (!/21,\s*23,\s*26/.test(bg)) fail.push('explicit dark overrides sys light: expected #15171a, got ' + bg);
    await page.close();
  }

  await browser.close();
  if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exit(1); }
  console.log('PASS');
  process.exit(0);
})().catch(err => { console.error('CRASH:', err); process.exit(2); });