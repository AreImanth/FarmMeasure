/**
 * tileview.js — display-only map viewing aids for thin boundaries.
 *
 * Two one-tap toggles (NOT in the hamburger — farmers need them mid-trace):
 *   - Clarity (default ON): CSS contrast/saturation lift on tiles so faint
 *     bund lines stand out. Zero extra tile requests. Display-only.
 *   - HD detail (default OFF): Leaflet retina tiles for genuinely sharper
 *     lines on 2x phones. Uses additional tile traffic while on — hence a confirm
 *     dialog and OFF-by-default.
 *
 * HONESTY: neither changes geometry or area math. PDF exports are captured
 * with clarity stripped (normalized satellite view) via setExportMode().
 * Prefs persist per-device in localStorage; storage failure = defaults.
 */
(function (global) {
  'use strict';

  const PREFS_SUFFIX = ':tileview';
  const MAP_CLASS = 'tiles-clarity';

  function prefsKey() {
    try {
      const base = (global.FAC_CONFIG && global.FAC_CONFIG.storage && global.FAC_CONFIG.storage.key) || 'fac:fields:v1';
      return base + PREFS_SUFFIX;
    } catch (_) {
      return 'fac:fields:v1' + PREFS_SUFFIX;
    }
  }

  function loadPrefs() {
    const fallback = { clarity: true, hd: false };
    try {
      const store = global.FAC_UTILS && global.FAC_UTILS.storage;
      if (!store) return fallback;
      const raw = store.get(prefsKey());
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;
      return {
        clarity: typeof parsed.clarity === 'boolean' ? parsed.clarity : fallback.clarity,
        hd: typeof parsed.hd === 'boolean' ? parsed.hd : fallback.hd,
      };
    } catch (_) {
      return fallback;
    }
  }

  function savePrefs(p) {
    try {
      const store = global.FAC_UTILS && global.FAC_UTILS.storage;
      if (store) store.set(prefsKey(), JSON.stringify({ clarity: !!p.clarity, hd: !!p.hd }));
    } catch (_) {}
  }

  function T(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  let prefs = loadPrefs();
  let ctx = null;
  let mapEl = null;
  let exportMode = false;
  let hadClarity = false;
  const controls = [];

  function ensureMapEl() {
    if (!mapEl) mapEl = document.getElementById('map');
    return mapEl;
  }

  function applyClarityClass() {
    const el = ensureMapEl();
    if (!el) return;
    if (prefs.clarity && !exportMode) el.classList.add(MAP_CLASS);
    else el.classList.remove(MAP_CLASS);
  }

  function applyHd() {
    if (ctx && ctx.mapCtx && typeof ctx.mapCtx.setDetectRetina === 'function') {
      try {
        ctx.mapCtx.setDetectRetina(prefs.hd);
      } catch (e) {
        console.warn('[tiles] hd apply failed', e);
      }
    }
  }

  function getUi() {
    return (ctx && ctx.ui) || null;
  }

  function render() {
    controls.forEach(function (c) {
      if (c.clarityBtn) {
        c.clarityBtn.setAttribute('aria-pressed', String(!!prefs.clarity));
        if (prefs.clarity) c.clarityBtn.classList.add('on');
        else c.clarityBtn.classList.remove('on');
        c.clarityBtn.title = T('tiles.clarity', null, 'Boundary clarity');
        c.clarityBtn.setAttribute('aria-label', T('tiles.clarity', null, 'Boundary clarity'));
      }
      if (c.hdBtn) {
        c.hdBtn.setAttribute('aria-pressed', String(!!prefs.hd));
        if (prefs.hd) c.hdBtn.classList.add('on');
        else c.hdBtn.classList.remove('on');
        c.hdBtn.title = T('tiles.hd', null, 'HD detail');
        c.hdBtn.setAttribute('aria-label', T('tiles.hd', null, 'HD detail'));
      }
    });
  }

  function toggleClarity() {
    prefs.clarity = !prefs.clarity;
    savePrefs(prefs);
    applyClarityClass();
    render();
    const u = getUi();
    if (u && u.toast) {
      u.toast(
        prefs.clarity
          ? T('tiles.clarityOn', null, 'Boundary clarity on.')
          : T('tiles.clarityOff', null, 'Boundary clarity off.'),
        'info', 2000
      );
    }
  }

  function setHd(on) {
    prefs.hd = !!on;
    savePrefs(prefs);
    applyHd();
    render();
    const u = getUi();
    if (u && u.toast) {
      u.toast(
        prefs.hd
          ? T('tiles.hdOn', null, 'HD detail on.')
          : T('tiles.hdOff', null, 'HD detail off.'),
        prefs.hd ? 'warn' : 'info',
        prefs.hd ? 4000 : 2000
      );
    }
  }

  function toggleHd() {
    if (prefs.hd) {
      setHd(false);
      return;
    }
    const msg = T('tiles.hdMsg', null, 'HD loads denser tiles. Might incur additional data.');
    function doOn() {
      setHd(true);
    }
    function doOff() {}
    const u = getUi();
    if (u && u.showConfirm) {
      u.showConfirm({
        title: T('tiles.hdTitle', null, 'Sharper map?'),
        message: msg,
        okLabel: T('tiles.hdOk', null, 'Turn on HD'),
        onOk: doOn,
        onCancel: doOff,
      });
    } else if (global.confirm(msg)) {
      doOn();
    }
  }

  function makeControl(position, extraClass) {
    const Leaflet = global.L;
    const ToggleControl = Leaflet.Control.extend({
      options: { position: position },
      onAdd: function () {
        const bar = Leaflet.DomUtil.create('div', 'tile-toggles ' + extraClass + ' leaflet-bar');
        const clarityBtn = Leaflet.DomUtil.create('a', 'tile-toggle-btn', bar);
        clarityBtn.href = '#';
        clarityBtn.setAttribute('role', 'button');
        clarityBtn.innerHTML = '<span aria-hidden="true">◐</span>';
        const hdBtn = Leaflet.DomUtil.create('a', 'tile-toggle-btn tile-toggle-hd', bar);
        hdBtn.href = '#';
        hdBtn.setAttribute('role', 'button');
        hdBtn.innerHTML = '<span aria-hidden="true">HD</span>';
        Leaflet.DomEvent.on(clarityBtn, 'click', Leaflet.DomEvent.stop).on(clarityBtn, 'click', function () {
          toggleClarity();
        }, this);
        Leaflet.DomEvent.on(hdBtn, 'click', Leaflet.DomEvent.stop).on(hdBtn, 'click', function () {
          toggleHd();
        }, this);
        Leaflet.DomEvent.disableClickPropagation(bar);
        controls.push({ root: bar, clarityBtn: clarityBtn, hdBtn: hdBtn });
        render();
        return bar;
      },
    });
    return new ToggleControl();
  }

  function init(options) {
    ctx = options || {};
    prefs = loadPrefs();
    applyClarityClass();
    applyHd();
    try {
      const map = ctx.mapCtx && ctx.mapCtx.map;
      if (map) {
        makeControl('topleft', 'tile-toggles-desktop').addTo(map);
        makeControl('topright', 'tile-toggles-mobile').addTo(map);
      }
    } catch (e) {
      console.warn('[tiles] controls failed', e);
    }
    render();
  }

  /**
   * Export mode: strip the clarity enhancement so PDFs capture the
   * normalized satellite view (what the satellite saw, not the aid).
   */
  function setExportMode(on) {
    exportMode = !!on;
    const el = ensureMapEl();
    if (!el) return;
    if (exportMode) {
      hadClarity = prefs.clarity;
      el.classList.remove(MAP_CLASS);
    } else {
      if (hadClarity && prefs.clarity) el.classList.add(MAP_CLASS);
      hadClarity = false;
    }
  }

  global.FAC_TILEVIEW = {
    init: init,
    refresh: render,
    setExportMode: setExportMode,
    isClarity: function () {
      return !!prefs.clarity;
    },
    isHD: function () {
      return !!prefs.hd;
    },
  };
})(window);
