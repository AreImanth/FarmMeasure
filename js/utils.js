/**
 * utils.js — small, dependency-free helpers.
 * All functions are pure unless noted.
 */
(function (global) {
  'use strict';

  /** Clamp a number to [min, max]. */
  function clamp(n, min, max) {
    if (Number.isNaN(n)) return min;
    return Math.min(Math.max(n, min), max);
  }

  /**
   * Format a number for display (Indian grouping).
   * - < 1: 4 decimal places
   * - < 100: 2 decimal places
   * - >= 100: Indian thousands separator (en-IN: 1,00,000), up to 1 decimal
   */
  function formatNumber(n) {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs === 0) return '0';
    if (abs < 1)   return n.toFixed(4);
    if (abs < 100) return n.toFixed(2);
    if (abs < 10000) return n.toFixed(1);
    return Math.round(n).toLocaleString('en-IN');
  }

  /**
   * Debounce a function. Returns a wrapped function that delays invocation
   * by `wait` ms after the last call. Includes a `flush()` to fire immediately
   * and a `cancel()` to drop a pending call.
   */
  function debounce(fn, wait) {
    let timer = null;
    let lastArgs = null;
    const wrapped = function (...args) {
      lastArgs = args;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const a = lastArgs;
        lastArgs = null;
        fn.apply(null, a);
      }, wait);
    };
    wrapped.flush = function () {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        const a = lastArgs;
        lastArgs = null;
        if (a) fn.apply(null, a);
      }
    };
    wrapped.cancel = function () {
      if (timer) { clearTimeout(timer); timer = null; }
      lastArgs = null;
    };
    return wrapped;
  }

  /** Generate a short, URL-safe id (no padding chars that need encoding). */
  function makeId() {
    // crypto.randomUUID is available in all modern browsers over HTTPS / localhost.
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // Fallback: time + random
    return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  /** Today's date as YYYY-MM-DD in local time. */
  function todayIso() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  /** Human-readable timestamp for PDF headers. */
  function formatTimestamp(d) {
    d = d || new Date();
    return d.toLocaleString('en-IN', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /**
   * Deep copy via JSON. Safe for plain objects / arrays / primitives — DO NOT
   * use on objects with functions, Dates, Maps, etc. Our domain data is plain.
   */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Classify a localStorage failure. Quota errors (full disk, private-mode
   * caps) deserve a different user message than a dead storage API.
   */
  function isQuotaError(err) {
    if (!err || typeof err !== 'object') return false;
    if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
    return err.code === 22 || err.code === 1014;
  }

  /** Safe localStorage wrapper. Returns null if access is denied. */
  const storage = {
    get(key) {
      try { return global.localStorage.getItem(key); } catch (_) { return null; }
    },
    set(key, value) {
      return storage.setDetailed(key, value).ok;
    },
    /**
     * Set with a machine-readable failure reason.
     * @returns {{ok:boolean, reason:string|null}} reason is 'quota', 'unavailable', or null
     */
    setDetailed(key, value) {
      try {
        global.localStorage.setItem(key, value);
        return { ok: true, reason: null };
      } catch (err) {
        return { ok: false, reason: isQuotaError(err) ? 'quota' : 'unavailable' };
      }
    },
    remove(key) {
      try { global.localStorage.removeItem(key); return true; }
      catch (_) { return false; }
    },
  };

  /**
   * Theme management.
   *
   * Theme is stored in localStorage under FAC_CONFIG.storage.key + ':theme'.
   * On first load, we read the stored preference (or default to 'auto' which
   * follows prefers-color-scheme). The actual CSS depends on
   * document.documentElement.dataset.theme = 'light' | 'dark'.
   *
   * NOTE: 'dark' here means the dark palette defined in :root on
   * prefers-color-scheme: dark. We do NOT use the CSS media query at runtime
   * once the user has made an explicit choice — their choice wins.
   */
  // const THEME_KEY = 'fac:theme:v1'; // kept for reference; actual key is FAC_CONFIG.storage.key + ':theme'
  // const THEME_STORAGE_KEY = 'fac:theme:v1';
  const _THEME_KEY_UNUSED = 'fac:theme:v1'; void _THEME_KEY_UNUSED;

  function readStoredTheme() {
    const raw = storage.get(FAC_CONFIG.storage.key + ':theme');
    if (raw === 'light' || raw === 'dark') return raw;
    return 'auto';
  }

  function applyTheme(theme) {
    // theme is one of: 'light', 'dark', 'auto'
    if (theme === 'auto') {
      const prefersDark = global.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }

  function themeIcon(markup) {
    // Inject inline SVG icon markup into the toggle.
    // markup must be raw HTML string.
    const el = document.getElementById('themeIcon');
    if (!el) return;
    el.innerHTML = markup;
  }

  /**
   * Set the toggle button's icon to either sun (light mode active / switching to light)
   * or moon (dark mode active / switching to dark).
   * @param {boolean} lightMode — true if light/dark = light
   */
  function setToggleIcon(lightMode) {
    if (lightMode) {
      // Sun (current or switching to light): filled body with rays
      themeIcon(
        '<circle cx="12" cy="12" r="5"></circle>' +
        '<line x1="12" y1="1" x2="12" y2="3"></line>' +
        '<line x1="12" y1="21" x2="12" y2="23"></line>' +
        '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>' +
        '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>' +
        '<line x1="1" y1="12" x2="3" y2="12"></line>' +
        '<line x1="21" y1="12" x2="23" y2="12"></line>' +
        '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>' +
        '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
      );
    } else {
      // Moon: crescent
      themeIcon(
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>'
      );
    }
  }

  function isDark() {
    return document.documentElement.dataset.theme === 'dark';
  }

  /** Resolve the effective theme ('light' | 'dark') from the current state. */
  function effectiveTheme() {
    const s = readStoredTheme();
    if (s === 'light') return 'light';
    if (s === 'dark') return 'dark';
    return global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  global.FAC_UTILS = {
    clamp, formatNumber, debounce, makeId, todayIso, formatTimestamp,
    deepClone, storage, readStoredTheme, applyTheme, setToggleIcon, isDark, effectiveTheme,
  };
})(window);
