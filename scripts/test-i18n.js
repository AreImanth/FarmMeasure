/**
 * scripts/test-i18n.js — Node test suite for js/i18n.js + lang/*.json.
 *
 * Covers, without a browser:
 *  - t() fallback chain: active → English → explicit fallback → key
 *  - {placeholder} substitution (provided vars only; unknown kept intact)
 *  - setLanguage persistence + listener notification + unsupported rejection
 *  - unitLabel() fallback to canonical English label
 *  - Dictionary audit: every en.json key exists in hi.json, and every
 *    {placeholder} in English exists in the Hindi string (a missing {n}
 *    would print a literal "{n}" to a farmer)
 *
 * Run:  node scripts/test-i18n.js      (or: npm run test:i18n)
 * Exits 0 when every test passes, 1 otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ */
/* Tiny harness (mirrors scripts/test-math.js)                         */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        function () { passed++; },
        function (e) {
          failed++;
          failures.push(name + ' — ' + (e && e.message ? e.message : String(e)));
        }
      );
    }
    passed++;
  } catch (e) {
    failed++;
    failures.push(name + ' — ' + (e && e.message ? e.message : String(e)));
  }
  return Promise.resolve();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/* ------------------------------------------------------------------ */
/* Sandbox: i18n.js reads window/document/localStorage/fetch defensively,
 * so plain stubs are enough. fetch serves the real lang/*.json files.  */
/* ------------------------------------------------------------------ */

const store = new Map();
const sandbox = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
  document: { documentElement: { setAttribute: () => {} } },
  fetch: (url) => {
    const file = path.join(ROOT, String(url).replace(/^\.\//, ''));
    return Promise.resolve({
      ok: fs.existsSync(file),
      json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))),
    });
  },
  console: console,
};

function loadI18n() {
  const code = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'localStorage', 'fetch', 'console', code);
  const win = {};
  // Mirror the browser: localStorage lives on window.
  win.localStorage = sandbox.localStorage;
  fn.call(win, win, sandbox.document, sandbox.localStorage, sandbox.fetch, console);
  return win.FAC_I18N;
}

function placeholders(s) {
  const out = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m = null;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out.sort();
}

async function main() {
  const I18N = loadI18n();
  assert(I18N && typeof I18N.t === 'function', 'FAC_I18N.t exists');

  await test('i18n: boots in English by default', async () => {
    store.clear();
    await I18N.init();
    assert(I18N.getLanguage() === 'en', 'default is en, got ' + I18N.getLanguage());
  });

  await test('i18n: t() returns English strings', async () => {
    assert(I18N.t('panel.title', null, 'X') === 'Fields');
    assert(I18N.t('btn.clear', null, 'X') === 'Clear all');
  });

  await test('i18n: missing key returns explicit fallback, else the key', async () => {
    assert(I18N.t('no.such.key', null, 'FB') === 'FB');
    assert(I18N.t('no.such.key') === 'no.such.key');
  });

  await test('i18n: {placeholder} substitution', async () => {
    assert(I18N.t('toast.restored', { n: 3 }, 'X') === 'Restored 3 field(s) from this device.');
    assert(I18N.t('delete.message', { name: 'A' }, 'X') === '"A" will be removed.');
  });

  await test('i18n: setLanguage(hi) persists + notifies + translates', async () => {
    let seen = null;
    I18N.onChange(function (lang) { seen = lang; });
    await I18N.setLanguage('hi');
    assert(I18N.getLanguage() === 'hi', 'active should be hi');
    assert(store.get('fac:lang') === 'hi', 'choice persisted');
    assert(seen === 'hi', 'listener notified');
    assert(I18N.t('panel.title', null, 'X') === 'खेत', 'got: ' + I18N.t('panel.title', null, 'X'));
    assert(I18N.t('btn.clear', null, 'X') === 'सभी साफ़ करें');
    assert(I18N.t('toast.restored', { n: 3 }, 'X') === 'इस डिवाइस से 3 खेत वापस लाए गए।');
  });

  await test('i18n: unsupported language is rejected', async () => {
    const before = I18N.getLanguage();
    await I18N.setLanguage('xx');
    assert(I18N.getLanguage() === before, 'stays on ' + before);
  });

  await test('i18n: unitLabel falls back to canonical English', async () => {
    await I18N.setLanguage('hi');
    assert(I18N.unitLabel('cent') === 'सेंट — दक्षिण (AP/TN/KL/KA)');
    await I18N.setLanguage('en');
  });

  await test('i18n: dictionary audit — every en key exists in hi', async () => {
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/en.json'), 'utf8'));
    const hi = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/hi.json'), 'utf8'));
    const missing = Object.keys(en).filter((k) => k !== '_meta' && typeof hi[k] !== 'string');
    assert(missing.length === 0, 'hi.json missing keys: ' + missing.join(', '));
  });

  await test('i18n: dictionary audit — {placeholders} match per key', async () => {
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/en.json'), 'utf8'));
    const hi = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/hi.json'), 'utf8'));
    const bad = [];
    Object.keys(en).forEach(function (k) {
      if (k === '_meta' || typeof en[k] !== 'string' || typeof hi[k] !== 'string') return;
      const a = placeholders(en[k]).join(',');
      const b = placeholders(hi[k]).join(',');
      if (a !== b) bad.push(k + ' (en:{' + a + '} hi:{' + b + '})');
    });
    assert(bad.length === 0, 'placeholder mismatch: ' + bad.join('; '));
  });

  await test('i18n: supported language list is en + hi', async () => {
    const ids = I18N.LANGS.map(function (l) { return l.id; });
    assert(ids.length === 2 && ids[0] === 'en' && ids[1] === 'hi', 'got: ' + ids.join(','));
  });

  console.log('\n=== I18N TESTS ===');
  console.log('passed: ' + passed + ', failed: ' + failed);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('ALL TESTS PASSED');
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exit(2);
});
