/**
 * scripts/smoke-storage.js — verifies GeoJSON export and localStorage persistence.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8765/';
const DOWNLOAD_DIR = path.join(__dirname, '..', 'test-downloads');

(async () => {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
  });

  // Clean slate
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1000));

  // Add a polygon, trigger a save manually (simulating what pm:create would do)
  await page.evaluate(() => {
    const ctx = window.__fac.mapCtx;
    const ui = window.__fac.ui;
    const d = 0.0009009;
    const poly = L.polygon([[0, 20], [d, 20], [d, 20 + d], [0, 20 + d]], { color: '#2d5016' });
    poly.options.facMeta = { id: 'persist_test', name: 'Persistence Test', color: '#2d5016', createdAt: Date.now() };
    ctx.fieldGroup.addLayer(poly);

    // Manually trigger save (real flow goes through drawing event)
    const fc = ctx.toFeatureCollection();
    localStorage.setItem('fac:fields:v1', JSON.stringify(fc));
    ui.render();
  });

  // Wait a beat, then verify storage has data
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('fac:fields:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      type: parsed.type,
      featureCount: parsed.features?.length,
      firstFeatureType: parsed.features?.[0]?.geometry?.type,
      props: parsed.features?.[0]?.properties,
      metaName: parsed.features?.[0]?.properties?.name,
    };
  });
  console.log('=== STORAGE CHECK ===');
  console.log(JSON.stringify(stored, null, 2));

  // Click GeoJSON export
  await page.click('#exportGeoJsonBtn');
  // Reporter prompt: name is mandatory
  await page.waitForFunction(() => { const m = document.getElementById('reporterModal'); return m && !m.hidden; }, { timeout: 8000 });
  await page.type('#reporterName', 'Test User');
  await page.click('#reporterOk');
  await new Promise(r => setTimeout(r, 1500));
  const geoFiles = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.geojson'));
  console.log('=== GEOJSON EXPORT ===');
  console.log('Files:', geoFiles);
  if (geoFiles.length > 0) {
    const content = fs.readFileSync(path.join(DOWNLOAD_DIR, geoFiles[0]), 'utf8');
    const parsed = JSON.parse(content);
    console.log('Type:', parsed.type);
    console.log('Feature count:', parsed.features?.length);
    console.log('First feature props:', JSON.stringify(parsed.features?.[0]?.properties));
  }

  // Now reload and verify the field is restored
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1500));

  const restored = await page.evaluate(() => {
    return {
      fieldCount: window.__fac.mapCtx.fieldGroup.getLayers().length,
      fieldItemsRendered: document.querySelectorAll('.field-item').length,
      fieldName: document.querySelector('.field-name')?.value,
    };
  });
  console.log('=== RELOAD + RESTORE ===');
  console.log(JSON.stringify(restored, null, 2));

  console.log('\nErrors:', errors.length);
  errors.forEach(e => console.log(' -', e));
  await browser.close();

  const allOk = stored && stored.featureCount === 1
    && restored.fieldCount === 1
    && restored.fieldName === 'Persistence Test'
    && errors.length === 0;
  if (!allOk) {
    console.error('STORAGE TEST FAILED');
    process.exit(1);
  }
  console.log('\nSTORAGE TEST PASSED');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
