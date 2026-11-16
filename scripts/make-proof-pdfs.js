/**
 * scripts/make-proof-pdfs.js — regenerate proof_read/*.pdf from the live app.
 *
 * Produces the review pack documented in proof_read/README.md:
 *   field-report-<lang>.pdf          bulk report (3 fields)
 *   field-report-single-<lang>.pdf   single-field report
 * for en, hi, te and ta. Sample data is identical in every language so a
 * reviewer can compare line by line. Map tiles may be unavailable offline —
 * the grey photo boxes are expected; only the words/fonts are up for review.
 *
 * Run:  npm run prove:pdf      (or: node scripts/make-proof-pdfs.js)
 * Needs the app served at http://localhost:8765/ (npm run serve).
 */
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8765/';
const OUT = path.join(__dirname, '..', 'proof_read');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LANGS = ['en', 'hi', 'te', 'ta'];

const REPORTER = {
  name: 'Rama Rao',
  phone: '98765 43210',
  village: 'Kollipara',
  mandal: 'Tenali',
  district: 'Guntur',
};

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitForPdf(dir, beforeSet, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = fs.readdirSync(dir).filter(function (f) {
      return f.endsWith('.pdf') && !beforeSet.has(f);
    });
    for (let i = 0; i < files.length; i++) {
      const full = path.join(dir, files[i]);
      const stat = fs.statSync(full);
      if (stat.size > 10000 && Date.now() - stat.mtimeMs > 300) return full;
    }
    await delay(400);
  }
  throw new Error('PDF download timed out');
}

async function generate(dir, beforeSet, target) {
  const file = await waitForPdf(dir, beforeSet, 90000);
  const dest = path.join(dir, target);
  fs.copyFileSync(file, dest);
  fs.unlinkSync(file);
  beforeSet.add(path.basename(file));
  beforeSet.add(target);
  const size = fs.statSync(dest).size;
  console.log('  wrote ' + target + ' (' + Math.round(size / 1024) + ' KB)');
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });

  page.on('pageerror', function (e) { console.warn('PAGE ERROR:', e.message); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#map.leaflet-container', { timeout: 15000 });
  await delay(1500);

  for (const lang of LANGS) {
    console.log(lang + ':');
    await page.evaluate(async function (lang) {
      await window.FAC_I18N.setLanguage(lang);
    }, lang);
    const stateUnit = lang === 'hi' ? 'bigha_up' : 'cent';
    await page.evaluate(function (unit) {
      window.FAC_UI_STATE.write(unit);
      const select = document.getElementById('stateUnitSelect');
      if (select) {
        select.value = unit;
        select.dispatchEvent(new Event('change'));
      }
    }, stateUnit);

    await page.evaluate(function () {
      const ctx = window.__fac.mapCtx;
      const ui = window.__fac.ui;
      ctx.fieldGroup.clearLayers();
      const specs = [
        { n: 3, color: '#2d5016', ring: [[16.2390, 80.6480], [16.2410, 80.6480], [16.2410, 80.6510], [16.2390, 80.6510]] },
        { n: 5, color: '#b8763b', ring: [[16.2350, 80.6540], [16.2368, 80.6540], [16.2368, 80.6566], [16.2350, 80.6566]] },
        { n: 7, color: '#6b4226', ring: [[16.2430, 80.6560], [16.2444, 80.6560], [16.2444, 80.6582], [16.2430, 80.6582]] },
      ];
      window.__facProofLayers = [];
      specs.forEach(function (spec) {
        const poly = L.polygon(spec.ring, {
          color: spec.color, fillColor: spec.color, fillOpacity: 0.25,
        });
        poly.options.facMeta = {
          id: 'proof-' + spec.n,
          name: 'Field ' + spec.n,
          color: spec.color,
          createdAt: Date.now(),
        };
        ctx.fieldGroup.addLayer(poly);
        window.__facProofLayers.push(poly);
      });
      ui.render();
      ctx.fitToFields();
    });
    await delay(2500);

    let before = new Set(fs.readdirSync(OUT));
    await page.evaluate(async function (reporter) {
      await window.FAC_PDF.generate({
        mapCtx: window.__fac.mapCtx,
        drawing: window.__fac.drawing,
        ui: window.__fac.ui,
        reporter: reporter,
      });
    }, REPORTER);
    await generate(OUT, before, 'field-report-' + lang + '.pdf');
    await delay(600);

    before = new Set(fs.readdirSync(OUT));
    await page.evaluate(async function (reporter) {
      await window.FAC_PDF.generateForLayer(window.__facProofLayers[0], {
        mapCtx: window.__fac.mapCtx,
        drawing: window.__fac.drawing,
        ui: window.__fac.ui,
        reporter: reporter,
      });
    }, REPORTER);
    await generate(OUT, before, 'field-report-single-' + lang + '.pdf');
    await delay(600);
  }

  await browser.close();
  console.log('done');
})().catch(function (err) {
  console.error('FATAL:', err);
  process.exit(1);
});
