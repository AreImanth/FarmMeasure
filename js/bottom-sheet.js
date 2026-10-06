/**
 * bottom-sheet.js — drag-to-resize bottom sheet for the fields panel on
 * mobile viewports.
 *
 * Exposes a single function `initBottomSheet()` that wires:
 *   - the drag handle (touch + mouse + pointer)
 *   - tap-to-toggle (header)
 *   - three snap heights: collapsed (just header + handle), mid, expanded
 *
 * On desktop (>=768px) this is a no-op — the panel is a side panel.
 */
(function (global) {
  'use strict';

  const MOBILE_MAX = 767;             // matches CSS breakpoint
  // Fallbacks only — real handle/header/footer heights are measured from
  // the DOM (see chromeHeight/footerHeight) so the footer is never clipped
  // by a wrong constant when fonts, wrapping, or button count change.
  const HANDLE_HEIGHT = 18;
  const HEADER_HEIGHT = 56;
  const FOOTER_HEIGHT = 68;

  function isMobile() {
    return global.matchMedia('(max-width: ' + MOBILE_MAX + 'px)').matches;
  }

  function initBottomSheet() {
    const panel = document.getElementById('panel');
    const handle = document.getElementById('panelHandle');
    const header = document.getElementById('panelHeader');
    if (!panel || !handle || !header) return;

    function applyHeight(px, collapsed) {
      panel.style.setProperty('--panel-h', px + 'px');
      // Only mark the panel collapsed on mobile — desktop is always open and
      // the `data-collapsed` selector would otherwise hide the panel body
      // (export buttons, field list, etc.).
      if (isMobile()) {
        panel.setAttribute('data-collapsed', collapsed ? 'collapsed' : 'open');
        // Expose snap name for CSS — used to auto-hide left toolbar at max (so metrics not covered)
        const snap = nearestSnap(px);
        panel.setAttribute('data-snap', snap.name);
        document.body.setAttribute('data-sheet', snap.name);
      } else {
        panel.removeAttribute('data-collapsed');
        panel.removeAttribute('data-snap');
        document.body.removeAttribute('data-sheet');
      }
      if (isMobile()) {
        header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      } else {
        header.setAttribute('aria-expanded', 'true');
      }
    }

    /**
     * Measure the real handle + header + footer heights so the collapsed
     * panel fits its chrome exactly — never clipping the footer when fonts,
     * button count, or wrapping change. Falls back to constants if the DOM
     * is not measurable yet.
     */
    function chromeHeight() {
      const handleEl = document.getElementById('panelHandle');
      const headerEl = document.getElementById('panelHeader');
      const footerEl = panel.querySelector('.panel-footer');
      const h = (handleEl ? handleEl.offsetHeight : 0) +
        (headerEl ? headerEl.offsetHeight : 0) +
        (footerEl ? footerEl.offsetHeight : 0);
      return h > 0 ? h : (HANDLE_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT);
    }

    function footerHeight() {
      const footerEl = panel.querySelector('.panel-footer');
      const h = footerEl ? footerEl.offsetHeight : 0;
      return h > 0 ? h : FOOTER_HEIGHT;
    }

    function appFooterHeight() {
      const footerEl = document.querySelector('.app-footer');
      const h = footerEl ? footerEl.offsetHeight : 0;
      return h > 0 ? h : 32;
    }

    function collapsedHeight() {
      // Just the handle + header + footer, rounded up to the next 4px for crispness.
      return Math.ceil(chromeHeight() / 4) * 4;
    }

    function midHeight() {
      // 58vh guarantees: handle+header+footer (126) + totals (~140) + list 90 = ~356 → fits 58vh (387px on 667) with 1.5 entries
      return Math.round(window.innerHeight * 0.58);
    }

    function maxHeight() {
      // Cap to available space above the fixed app footer (app header +
      // app footer + 8 gap). The app footer's measured height is used so a
      // two-line mobile footer never gets overlapped by the panel.
      const avail = window.innerHeight - 56 - appFooterHeight() - 8 - footerHeight();
      const vh85 = Math.round(window.innerHeight * 0.85);
      return Math.min(vh85, avail);
    }

    // Snap points in pixels.
    function snapPoints() {
      return [
        { name: 'collapsed', h: collapsedHeight(), open: false },
        { name: 'mid',       h: midHeight(),         open: true  },
        { name: 'expanded',  h: maxHeight(),         open: true  },
      ];
    }

    function nearestSnap(currentH) {
      const snaps = snapPoints();
      let best = snaps[0];
      let bestDiff = Math.abs(currentH - best.h);
      for (let i = 1; i < snaps.length; i++) {
        const d = Math.abs(currentH - snaps[i].h);
        if (d < bestDiff) { best = snaps[i]; bestDiff = d; }
      }
      return best;
    }

    function currentSnap() {
      const current = parseFloat(panel.style.getPropertyValue('--panel-h')) || collapsedHeight();
      return nearestSnap(current);
    }

    // Default state on first init — collapsed (just header visible) so the
    // map gets maximum screen real estate.
    applyHeight(collapsedHeight(), true);

    // ---- Tap header to toggle between collapsed and last-non-collapsed ----
    let lastOpen = midHeight();
    function toggle() {
      if (!isMobile()) return;
      const cur = currentSnap();
      if (cur.name === 'collapsed') {
        // open to last known open state (default mid)
        const target = Math.min(lastOpen, maxHeight());
        const snap = nearestSnap(target);
        applyHeight(snap.h, !snap.open);
      } else {
        // collapse
        applyHeight(collapsedHeight(), true);
      }
    }
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    // ---- Drag the handle to resize ----
    let startY = 0;
    let startH = 0;
    let dragging = false;

    function onDown(clientY) {
      if (!isMobile()) return;
      dragging = true;
      startY = clientY;
      startH = parseFloat(panel.style.getPropertyValue('--panel-h')) || collapsedHeight();
      panel.style.transition = 'none';    // disable smooth animation while dragging
      document.body.style.userSelect = 'none';
    }

    function onMove(clientY) {
      if (!dragging) return;
      // Dragging UP (clientY decreases) grows the panel — positive delta.
      const delta = startY - clientY;
      let next = startH + delta;
      const max = maxHeight();
      const min = collapsedHeight() - 8;  // allow a tiny overshoot below collapsed
      if (next > max) next = max;
      if (next < min) next = min;
      // While dragging we keep the body visible regardless of snap.
      panel.style.setProperty('--panel-h', next + 'px');
      if (isMobile()) {
        panel.setAttribute('data-collapsed', 'open');
        // Live-update snap hint while dragging so toolbar fades progressively near max
        const snap = nearestSnap(next);
        panel.setAttribute('data-snap', snap.name);
        document.body.setAttribute('data-sheet', snap.name);
      }
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';        // restore CSS transition
      document.body.style.userSelect = '';
      const finalH = parseFloat(panel.style.getPropertyValue('--panel-h')) || collapsedHeight();
      const snap = nearestSnap(finalH);
      if (snap.open) lastOpen = snap.h;
      applyHeight(snap.h, !snap.open);
      // After collapse animation completes, ensure Leaflet recalculates its
      // size (it doesn't observe container resize for the bottom-sheet case).
      if (global.__fac && global.__fac.mapCtx && global.__fac.mapCtx.map) {
        setTimeout(() => global.__fac.mapCtx.map.invalidateSize(), 280);
      }
    }

    // Pointer Events cover both touch and mouse in modern browsers.
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      onDown(e.clientY);
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      onMove(e.clientY);
    });
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);

    // On window resize, re-clamp to the nearest snap so the panel never
    // exceeds the viewport height. Also clear the `data-collapsed` flag when
    // transitioning to desktop so the panel body becomes visible.
    let resizeRaf = 0;
    window.addEventListener('resize', function () {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = 0;
        if (!isMobile()) {
          panel.style.removeProperty('--panel-h');   // let desktop CSS take over (100%)
          panel.removeAttribute('data-collapsed');
          header.setAttribute('aria-expanded', 'true');
        } else {
          const cur = parseFloat(panel.style.getPropertyValue('--panel-h')) || collapsedHeight();
          if (cur > maxHeight()) applyHeight(maxHeight(), true);
        }
        // Also tell Leaflet to recompute its size on the next paint.
        if (global.__fac && global.__fac.mapCtx && global.__fac.mapCtx.map) {
          global.__fac.mapCtx.map.invalidateSize();
        }
      });
    });
  }

  global.FAC_BOTTOM_SHEET = { initBottomSheet };
})(window);