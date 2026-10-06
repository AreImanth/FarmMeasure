/**
 * reporter.js — self-declared reporter details for generated files.
 *
 * Shown before every report (GeoJSON / PDF, bulk / single). Name is
 * mandatory; phone / village / mandal / district are opt-in via a
 * single master toggle (all-or-nothing).
 *
 * PRIVACY (audited):
 *  - The returned object lives in local variables only. It is embedded in
 *    the generated file and never written to localStorage, filenames,
 *    toasts, or console.
 *  - Inputs are scrubbed from the DOM immediately after use (see cleanup).
 *  - Values are self-declared by the user — files must label them as such.
 */
(function (global) {
  'use strict';

  const MAX_TEXT = 80;

  function el(id) {
    return document.getElementById(id);
  }

  function wireMasterToggle() {
    const master = el('reporterMasterToggle');
    const optional = el('reporterOptional');
    if (!master || !optional) return;
    master.addEventListener('change', function () {
      if (master.checked) {
        optional.hidden = false;
        optional.querySelectorAll('input').forEach(function (inp) { inp.disabled = false; });
        setTimeout(function () {
          const first = optional.querySelector('input:not([disabled])');
          if (first) first.focus();
        }, 100);
      } else {
        optional.hidden = true;
        optional.querySelectorAll('input').forEach(function (inp) { inp.disabled = true; inp.value = ''; });
      }
    });
  }

  function reset() {
    ['reporterName', 'reporterPhone', 'reporterVillage', 'reporterMandal', 'reporterDistrict'].forEach(function (id) {
      const i = el(id);
      if (i) i.value = '';
    });
    const master = el('reporterMasterToggle');
    const optional = el('reporterOptional');
    if (master) master.checked = false;
    if (optional) { optional.hidden = true; optional.querySelectorAll('input').forEach(function (inp) { inp.disabled = true; }); }
    wireMasterToggle();
  }

  function t(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  function readOpt(inputId, key, isPhone, info) {
    const inp = el(inputId);
    if (!inp || inp.disabled || !inp.value.trim()) return null;
    const v = inp.value.trim();
    if (isPhone) {
      const digits = v.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 15) {
        return { error: t('rep.errPhone', null, 'Enter a valid phone number or leave it blank.') };
      }
      info[key] = v.slice(0, 20);
    } else {
      info[key] = v.slice(0, MAX_TEXT);
    }
    return true;
  }

  function readInfo() {
    const nameEl = el('reporterName');
    const name = nameEl ? (nameEl.value || '').trim().slice(0, MAX_TEXT) : '';
    if (!name) return { error: t('rep.errName', null, 'Please enter a name for the report.') };
    const info = { name: name };
    const masterChecked = el('reporterMasterToggle') && el('reporterMasterToggle').checked;
    if (masterChecked) {
      let e;
      e = readOpt('reporterPhone', 'phone', true, info);
      if (e && e.error) return e;
      e = readOpt('reporterVillage', 'village', false, info);
      if (e && e.error) return e;
      e = readOpt('reporterMandal', 'mandal', false, info);
      if (e && e.error) return e;
      e = readOpt('reporterDistrict', 'district', false, info);
      if (e && e.error) return e;
    }
    return { info: info };
  }

  /**
   * Show the reporter prompt.
   * @param {Object} [opts]
   * @param {Function} [opts.onError] — called with a message; modal stays open
   * @returns {Promise<Object|null>} info object, or null if cancelled
   */
  function collect(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const modal = el('reporterModal');
      const okBtn = el('reporterOk');
      if (!modal || !okBtn) {
        resolve(null);
        return;
      }
      let onKey = null;
      function cleanup() {
        modal.hidden = true;
        okBtn.onclick = null;
        const closers = modal.querySelectorAll('[data-close-reporter]');
        closers.forEach(function (c) { c.onclick = null; });
        if (onKey) document.removeEventListener('keydown', onKey);
        reset(); // scrub PII from the DOM immediately
      }
      function cancel() {
        cleanup();
        resolve(null);
      }
      reset();
      modal.hidden = false;
      setTimeout(function () {
        try { el('reporterName').focus(); } catch (_) {}
      }, 50);
      okBtn.onclick = function () {
        const r = readInfo();
        if (r.error) {
          if (typeof opts.onError === 'function') opts.onError(r.error);
          return; // keep modal open
        }
        const info = r.info;
        cleanup();
        resolve(info);
      };
      const closers = modal.querySelectorAll('[data-close-reporter]');
      closers.forEach(function (c) { c.onclick = cancel; });
      onKey = function (e) {
        if (e.key === 'Escape' && !modal.hidden) cancel();
      };
      document.addEventListener('keydown', onKey);
    });
  }

  global.FAC_REPORTER = { collect: collect };
})(window);
