/**
 * i18n.js — tiny internationalisation layer (English + Hindi for now).
 *
 * Design (privacy-first, offline-first, no dependencies):
 *  - Dictionaries live in lang/*.json, fetched same-origin at boot.
 *    If fetch fails (file://, offline-first-load), the app runs in English.
 *  - t(key, vars) falls back active → English → key itself. English output
 *    is byte-identical to the pre-i18n hardcoded strings.
 *  - Static DOM uses data-i18n / data-i18n-html / data-i18n-aria-label /
 *    data-i18n-title / data-i18n-ph attributes, applied by applyStatic().
 *  - Dynamic strings (toasts, dialogs, PDF labels) call t() at render time.
 *  - Choice persists in localStorage (fac:lang). Unit symbols, numbers and
 *    user-typed field names are never translated.
 *
 * SECURITY: dictionary strings are ours (shipped files). data-i18n-html is
 * only applied to static help content from those files — never user input,
 * which always flows through textContent elsewhere.
 */
(function (global) {
  'use strict';

  const DEFAULT_LANG = 'en';
  const STORAGE_KEY = 'fac:lang';

  const LANGS = [
    { id: 'en', label: 'English', native: 'English' },
    { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
  ];

  const cache = {};      // lang id -> dict object
  let current = DEFAULT_LANG;
  const listeners = [];
  let memLang = null;  // in-memory fallback when localStorage is unavailable

  function readStored() {
    try {
      if (memLang) return memLang;
      if (typeof global.localStorage === 'undefined') return null;
      return global.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return memLang;
    }
  }

  function writeStored(lang) {
    memLang = lang;
    try {
      if (typeof global.localStorage !== 'undefined') {
        global.localStorage.setItem(STORAGE_KEY, lang);
      }
    } catch (_) {}
  }

  function isSupported(lang) {
    for (let i = 0; i < LANGS.length; i++) {
      if (LANGS[i].id === lang) return true;
    }
    return false;
  }

  function lookup(dict, key) {
    if (!dict || typeof dict !== 'object') return undefined;
    const v = dict[key];
    return typeof v === 'string' ? v : undefined;
  }

  /**
   * Translate a key, substituting {placeholders} from vars.
   * Fallback chain: active language → English → explicit fallback → key.
   * Pass the English string as `fallback` at call sites so the UI can
   * never render a raw key, even if lang/*.json fails to load.
   */
  function t(key, vars, fallback) {
    let s = lookup(cache[current], key);
    if (s === undefined) s = lookup(cache[DEFAULT_LANG], key);
    if (s === undefined) s = (fallback !== undefined) ? fallback : key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (k) {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return s;
  }

  /**
   * Translated display label for a unit id (state-unit descriptions).
   * Falls back to the canonical English label from UNITS.meta.
   */
  function unitLabel(id) {
    const s = lookup(cache[current], 'units.' + id);
    if (s !== undefined) return s;
    try {
      if (global.FAC_UNITS && typeof global.FAC_UNITS.meta === 'function') {
        const m = global.FAC_UNITS.meta(id);
        if (m && typeof m.label === 'string') return m.label;
      }
    } catch (_) {}
    return id;
  }

  function setDocLang() {
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('lang', current);
      }
    } catch (_) {}
  }

  /**
   * Apply data-i18n* attributes under root (default: whole document).
   * Safe to call repeatedly (language switch) and before dictionaries load
   * (falls back to English once en.json arrives, else leaves markup as-is).
   */
  function applyStatic(root) {
    let scope = null;
    try {
      scope = root || (typeof document !== 'undefined' ? document : null);
      if (!scope || typeof scope.querySelectorAll !== 'function') return;
    } catch (_) { return; }
    function each(sel, fn) {
      let els = null;
      try { els = scope.querySelectorAll(sel); } catch (_) { return; }
      Array.prototype.forEach.call(els, fn);
    }
    function setText(el, key) {
      // Never overwrite markup with a raw key: missing translation keeps
      // the hardcoded English already in the HTML.
      const v = t(key);
      if (v !== key && typeof el.textContent === 'string') el.textContent = v;
    }
    function setAttr(el, attr, key) {
      if (typeof el.setAttribute !== 'function') return;
      const v = t(key);
      if (v !== key) el.setAttribute(attr, v);
    }
    each('[data-i18n]', function (el) { setText(el, el.getAttribute('data-i18n')); });
    each('[data-i18n-html]', function (el) {
      // Static help content from our own dictionaries only — never user data.
      const key = el.getAttribute('data-i18n-html');
      const v = t(key);
      if (v !== key) el.innerHTML = v;
    });
    each('[data-i18n-aria-label]', function (el) { setAttr(el, 'aria-label', el.getAttribute('data-i18n-aria-label')); });
    each('[data-i18n-title]', function (el) { setAttr(el, 'title', el.getAttribute('data-i18n-title')); });
    each('[data-i18n-ph]', function (el) { setAttr(el, 'placeholder', el.getAttribute('data-i18n-ph')); });
    each('[data-i18n-label]', function (el) { setAttr(el, 'label', el.getAttribute('data-i18n-label')); });
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(current); } catch (e) { console.error('[i18n] listener failed', e); }
    });
  }

  function loadDict(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    if (typeof fetch === 'undefined') return Promise.resolve(null);
    return fetch('lang/' + lang + '.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res || !res.ok) return null;
        return res.json();
      })
      .then(function (json) {
        if (json && typeof json === 'object') cache[lang] = json;
        return cache[lang] || null;
      })
      .catch(function () { return null; });
  }

  /**
   * Boot: read stored choice, load English (fallback base) + active dict.
   * Never throws — worst case the app runs in hardcoded English.
   */
  function init() {
    const stored = readStored();
    current = isSupported(stored) ? stored : DEFAULT_LANG;
    return loadDict(DEFAULT_LANG)
      .then(function () {
        if (current !== DEFAULT_LANG) return loadDict(current);
        return null;
      })
      .then(function () {
        setDocLang();
        return current;
      })
      .catch(function () {
        setDocLang();
        return current;
      });
  }

  /**
   * Switch language at runtime. Persists, reloads dict if needed,
   * re-applies static DOM and notifies listeners (ui re-renders).
   * @returns {Promise<string>} the active language id
   */
  function setLanguage(lang) {
    if (!isSupported(lang)) return Promise.resolve(current);
    return loadDict(lang).then(function () {
      current = lang;
      writeStored(lang);
      setDocLang();
      applyStatic();
      notify();
      return current;
    });
  }

  function getLanguage() { return current; }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  global.FAC_I18N = {
    LANGS: LANGS,
    DEFAULT_LANG: DEFAULT_LANG,
    init: init,
    t: t,
    unitLabel: unitLabel,
    setLanguage: setLanguage,
    getLanguage: getLanguage,
    onChange: onChange,
    applyStatic: applyStatic,
  };
})(typeof window !== 'undefined' ? window : this);
