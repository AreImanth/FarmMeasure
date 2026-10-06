/**
 * scripts/smoke-pdf.js — verifies the PDF export pipeline.
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
  // Force a desktop viewport — at mobile widths the export button is inside
  // the collapsed bottom sheet, which is the default state on mobile.
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text());
  });

  // Configure download behavior — Puppeteer's CDP
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1500));

  // Add a couple of test polygons
  await page.evaluate(() => {
    const ctx = window.__fac.mapCtx;
    const drawing = window.__fac.drawing;
    const ui = window.__fac.ui;

    // Polygon 1: ~100m x 100m
    const d = 0.0009009;
    const poly1 = L.polygon([
      [0, 20], [d, 20], [d, 20 + d], [0, 20 + d],
    ], { color: '#2d5016', fillColor: '#2d5016', fillOpacity: 0.25 });
    poly1.options.facMeta = { id: 't1', name: 'North Field', color: '#2d5016', createdAt: Date.now() };
    ctx.fieldGroup.addLayer(poly1);

    // Polygon 2: ~200m x 200m (2x bigger)
    const d2 = d * 2;
    const poly2 = L.polygon([
      [0.001, 20.001], [0.001 + d2, 20.001], [0.001 + d2, 20.001 + d2], [0.001, 20.001 + d2],
    ], { color: '#b8763b', fillColor: '#b8763b', fillOpacity: 0.25 });
    poly2.options.facMeta = { id: 't2', name: 'South Field', color: '#b8763b', createdAt: Date.now() };
    ctx.fieldGroup.addLayer(poly2);

    ui.render();
  });

  console.log('Clicking PDF export button…');
  await page.click('#exportPdfBtn');

  // Reporter prompt: name is mandatory
  await page.waitForFunction(() => { const m = document.getElementById('reporterModal'); return m && !m.hidden; }, { timeout: 8000 });
  await page.type('#reporterName', 'Test User');
  await page.click('#reporterOk');

  // Wait for the download
  const start = Date.now();
  let pdfFile = null;
  while (Date.now() - start < 15000) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.pdf'));
    if (files.length > 0) {
      pdfFile = path.join(DOWNLOAD_DIR, files[0]);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!pdfFile) {
    console.error('No PDF generated within 15s');
    console.error('Errors:', errors);
    process.exit(1);
  }

  const stat = fs.statSync(pdfFile);
  console.log('PDF generated:', pdfFile);
  console.log('Size:', stat.size, 'bytes');

  // Quick sanity: PDF should start with %PDF and end with %%EOF
  const buf = fs.readFileSync(pdfFile);
  const head = buf.slice(0, 8).toString('latin1');
  const tail = buf.slice(-6).toString('latin1');
  console.log('Header:', JSON.stringify(head));
  console.log('Tail:', JSON.stringify(tail));

  if (!head.startsWith('%PDF-')) {
    console.error('PDF header missing — file is not a valid PDF');
    process.exit(1);
  }
  if (!tail.includes('%%EOF')) {
    console.error('PDF EOF marker missing');
    process.exit(1);
  }
  if (stat.size < 10000) {
    console.error('PDF suspiciously small:', stat.size);
    process.exit(1);
  }

  console.log('\nErrors during run:', errors.length);
  errors.forEach(e => console.log(' -', e));
  await browser.close();

  if (errors.length > 0) {
    console.error('PDF TEST FAILED — errors above');
    process.exit(1);
  }

  console.log('\nPDF EXPORT TEST PASSED');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
