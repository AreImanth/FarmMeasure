/**
 * scripts/smoke-pdf-render.js — render the PDF and the map screenshot to PNG
 * so we can visually inspect whether the polygon is highlighted in the PDF.
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
  await page.setViewport({ width: 1280, height: 800 });

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#map.leaflet-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1500));

  // Add a clearly visible bright-orange polygon
  await page.evaluate(() => {
    const ctx = window.__fac.mapCtx;
    const ui = window.__fac.ui;
    // Big rectangle: ~1km x ~500m centered on lat=20,lng=0
    const ring = [
      [-0.005, 19.997],
      [0.005, 19.997],
      [0.005, 20.002],
      [-0.005, 20.002],
    ];
    const poly = L.polygon(ring, {
      color: '#ff5722',
      fillColor: '#ff5722',
      fillOpacity: 0.45,
      weight: 4,
    });
    poly.options.facMeta = {
      id: 'highlight_test',
      name: 'Bright Test Field',
      color: '#ff5722',
      createdAt: Date.now(),
    };
    ctx.fieldGroup.addLayer(poly);
    ui.render();
    // Pan to fit
    ctx.map.fitBounds(poly.getBounds(), { padding: [40, 40] });
  });
  await new Promise(r => setTimeout(r, 1500));

  // Capture the on-screen map state BEFORE PDF gen (what user sees)
  await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'before-pdf-map.png') });

  // Look at the SVG overlay inside the map to confirm polygons are in the DOM
  const svgInfo = await page.evaluate(() => {
    const svg = document.querySelector('#map svg');
    if (!svg) return { hasSvg: false };
    const paths = svg.querySelectorAll('path');
    const samples = [];
    paths.forEach((p, i) => {
      if (i < 5) {
        samples.push({
          d: (p.getAttribute('d') || '').slice(0, 80) + '…',
          fill: p.getAttribute('fill'),
          stroke: p.getAttribute('stroke'),
          'fill-opacity': p.getAttribute('fill-opacity'),
          'stroke-width': p.getAttribute('stroke-width'),
        });
      }
    });
    return { hasSvg: true, pathCount: paths.length, samples };
  });
  console.log('=== MAP SVG STATE ===');
  console.log(JSON.stringify(svgInfo, null, 2));

  // Now generate the PDF
  await page.click('#exportPdfBtn');
  // Reporter prompt: name is mandatory
  await page.waitForFunction(() => { const m = document.getElementById('reporterModal'); return m && !m.hidden; }, { timeout: 8000 });
  await page.type('#reporterName', 'Test User');
  await page.click('#reporterOk');
  await new Promise(r => setTimeout(r, 4000));

  await browser.close();

  const pdfs = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.pdf'));
  console.log('PDFs generated:', pdfs);
  console.log('Visual check files: before-pdf-map.png + the .pdf itself');
  console.log('Open the PDF and compare against before-pdf-map.png');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
