/**
 * mobile-menu.js — hamburger for left tools on mobile (≤767px).
 * Ships draw/reshape/clear/zoom/north/help/licensing/language + Map type
 * (Street/Hybrid) into one menu so the bottom sheet at max doesn't hide metrics.
 * Desktop: no-op (original Geoman + layer switcher stay visible).
 */
(function (global) {
  'use strict';

  function initMobileMenu(mapCtx) {
    const btn = document.getElementById('mobileMenuBtn');
    const panel = document.getElementById('mobileMenuPanel');
    const closeBtn = document.getElementById('mobileMenuClose');
    const submenuToggle = document.querySelector('[data-submenu="maptype"]');
    const submenu = document.getElementById('mapTypeSubmenu');
    if (!btn || !panel) return;

    function open() {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      // Sync radio to active base layer
      try {
        const active = mapCtx.getActiveBaseLayer && mapCtx.getActiveBaseLayer();
        panel.querySelectorAll('input[name="mapType"]').forEach(function (r) {
          r.checked = r.value === active;
        });
      } catch (_) {}
    }

    function close() {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (submenu) submenu.hidden = true;
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);

    // Click outside to close
    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) close();
    });

    // Submenu toggle
    if (submenuToggle && submenu) {
      submenuToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        submenu.hidden = !submenu.hidden;
        submenuToggle.setAttribute('aria-expanded', String(!submenu.hidden));
      });
    }

    // Sync radios on init so default (MapTiler Hybrid) shows checked even before first open
    try {
      const initActive = mapCtx.getActiveBaseLayer && mapCtx.getActiveBaseLayer();
      if (initActive) {
        panel.querySelectorAll('input[name="mapType"]').forEach(function (r) {
          r.checked = r.value === initActive;
        });
      }
    } catch (_) {}

    // Map type radios — confirm before swapping (farmer accidentally taps Street/Hybrid)
    let _pendingRadio = null;
    panel.querySelectorAll('input[name="mapType"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        const next = radio.value;
        let current = null;
        try { current = mapCtx.getActiveBaseLayer && mapCtx.getActiveBaseLayer(); } catch (_) {}
        if (next === current) return;
        // Hold change until confirmed — revert visually, then confirm
        radio.checked = false;
        // Restore current checked for visual consistency until confirm
        panel.querySelectorAll('input[name="mapType"]').forEach(function (r) {
          r.checked = r.value === current;
        });
        _pendingRadio = radio;
        const ui = (global.__fac && global.__fac.ui) || null;
        const T = function (key, vars, fb) {
          return (global.FAC_I18N && typeof global.FAC_I18N.t === 'function')
            ? global.FAC_I18N.t(key, vars, fb) : (fb !== undefined ? fb : key);
        };
        const msg = T('mapswitch.msg', { from: (current || 'current'), to: next },
          'Switch map from "' + (current || 'current') + '" to "' + next + '"? Satellite uses more data.');
        function doSwitch() {
          if (mapCtx.setBaseLayer) mapCtx.setBaseLayer(next);
          panel.querySelectorAll('input[name="mapType"]').forEach(function (r) {
            r.checked = r.value === next;
          });
          const toastUi = (global.__fac && global.__fac.ui) || null;
          if (toastUi && toastUi.toast) toastUi.toast(T('mapswitch.done', { name: next }, 'Map switched to ' + next), 'success', 2500);
          _pendingRadio = null;
        }
        function cancelSwitch() {
          _pendingRadio = null;
        }
        if (ui && ui.showConfirm) {
          ui.showConfirm({
            title: T('mapswitch.title', null, 'Switch map type?'),
            message: msg,
            okLabel: T('mapswitch.ok', null, 'Switch'),
            onOk: doSwitch,
            onCancel: cancelSwitch,
          });
        } else if (global.confirm(msg)) {
          doSwitch();
        } else {
          cancelSwitch();
        }
      });
    });

    // Actions
    panel.querySelectorAll('[data-action]').forEach(function (el) {
      const action = el.getAttribute('data-action');
      // Skip submenu toggle (handled above) — it has data-submenu not data-action
      if (!action) return;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        handleAction(action, mapCtx);
        // Keep menu open for zoom/north/help, close for draw/edit/clear to see map
        if (action === 'draw' || action === 'edit' || action === 'clear') close();
      });
    });
  }

  function handleAction(action, mapCtx) {
    const map = mapCtx && mapCtx.map;
    if (!map) return;
    try {
      switch (action) {
        case 'zoomin':
          map.zoomIn();
          break;
        case 'zoomout':
          map.zoomOut();
          break;
        case 'north':
          if (typeof map.setBearing === 'function') map.setBearing(0);
          if (typeof map.getBearing === 'function' && map.getBearing() !== 0) map.setBearing(0);
          break;
        case 'help': {
          const m = document.getElementById('helpModal');
          if (m) m.hidden = false;
          break;
        }
        case 'licensing': {
          const m = document.getElementById('licensingModal');
          if (m) m.hidden = false;
          break;
        }
        case 'language': {
          if (typeof global.__facLanguageOpen === 'function') global.__facLanguageOpen();
          break;
        }
        case 'draw':
          if (map.pm) map.pm.enableDraw('Polygon');
          break;
        case 'edit':
          if (map.pm) map.pm.toggleGlobalEditMode();
          break;
        case 'clear':
          if (map.pm) map.pm.toggleGlobalRemovalMode();
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn('[mobile-menu] action failed', action, err);
    }
  }

  // Expose
  global.FAC_MOBILE_MENU = { initMobileMenu: initMobileMenu };
})(window);
