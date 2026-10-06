/**
 * ui.js — DOM updates: side panel, totals, field list, toasts, modal.
 *
 * This module is the ONLY place that touches the DOM directly for these UI
 * surfaces. Other modules emit events; ui.js subscribes and updates the view.
 *
 * SECURITY:
 *   - Field names (user-controlled text) are inserted via textContent, NEVER
 *     via innerHTML. This prevents stored-data XSS from rendering as HTML.
 *   - Field IDs and metadata flow through data-* attributes only.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const UTILS = global.FAC_UTILS;
  const UNITS = global.FAC_UNITS;

  /**
   * Translate with hardcoded English fallback — the UI can never render a
   * raw key, even if lang/*.json fails to load (file://, first offline run).
   * NOTE: resolved lazily because js/i18n.js loads after this module.
   */
  function t(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  /**
   * Initialize UI bindings.
   * @param {Object} refs — references the entry point passes in
   * @returns {Object} UI API for app.js
   */
  function init(refs) {
    const ctx = refs.mapCtx;        // map module
    const drawing = refs.drawing;   // drawing module
    const dom = {
      fieldList:     document.getElementById('fieldList'),
      fieldEmpty:    document.getElementById('fieldEmpty'),
      totalValue:    document.getElementById('totalValue'),
      totalUnit:     document.getElementById('totalUnit'),
      totalSecondary:document.getElementById('totalSecondary'),
      unitSelect:    document.getElementById('unitSelect'),
      stateUnitSelect: document.getElementById('stateUnitSelect'),
      stateUnitValue:  document.getElementById('stateUnitValue'),
      stateUnitHint:   document.getElementById('stateUnitHint'),
      exportGeoJson: document.getElementById('exportGeoJsonBtn'),
      exportKml:     document.getElementById('exportKmlBtn'),
      exportPdf:     document.getElementById('exportPdfBtn'),
      distanceBtn:   document.getElementById('distanceBtn'),
      clearAll:      document.getElementById('clearAllBtn'),
      statusText:    document.getElementById('statusText'),
      statusDot:     document.getElementById('statusDot'),
      toastContainer:document.getElementById('toastContainer'),
      drawingHint:   document.getElementById('drawingHint'),
      cancelDrawBtn: document.getElementById('cancelDrawingBtn'),
      gpsBtn:        document.getElementById('gpsBtn'),
      confirmModal:  document.getElementById('confirmModal'),
      confirmTitle:  document.getElementById('confirmTitle'),
      confirmMessage:document.getElementById('confirmMessage'),
      confirmOk:     document.getElementById('confirmOk'),
      confirmCancel: document.getElementById('confirmCancel'),
      shareModal:    document.getElementById('shareModal'),
      shareLinkInput:document.getElementById('shareLinkInput'),
      shareCopyBtn:  document.getElementById('shareCopyBtn'),
      shareWhatsappBtn: document.getElementById('shareWhatsappBtn'),
      shareNativeBtn:   document.getElementById('shareNativeBtn'),
      fieldDownloadModal: document.getElementById('fieldDownloadModal'),
      fieldDownloadGeoJsonBtn: document.getElementById('fieldDownloadGeoJsonBtn'),
      fieldDownloadPdfBtn: document.getElementById('fieldDownloadPdfBtn'),
      fieldDownloadMessage: document.getElementById('fieldDownloadMessage'),
      footerVersion: document.getElementById('footerVersion'),
    };

    // State that belongs to the UI module itself
    let activeUnit = 'ha';
    let activeStateUnit = '';
    try {
      if (global.FAC_UI_STATE && typeof global.FAC_UI_STATE.read === 'function') {
        activeStateUnit = global.FAC_UI_STATE.read() || '';
      }
    } catch (_) { activeStateUnit = ''; }

    // Wire unit selector (standard)
    dom.unitSelect.addEventListener('change', function () {
      activeUnit = dom.unitSelect.value;
      renderTotals();
      renderFieldList();
    });

    // Wire state unit selector (regional) — persists, renders totals + per-field
    if (dom.stateUnitSelect) {
      if (activeStateUnit) dom.stateUnitSelect.value = activeStateUnit;
      dom.stateUnitSelect.addEventListener('change', function () {
        activeStateUnit = dom.stateUnitSelect.value || '';
        try { if (global.FAC_UI_STATE) global.FAC_UI_STATE.write(activeStateUnit); } catch (_) {}
        renderTotals();
        renderFieldList();
      });
    }

    // Wire clear-all button
    dom.clearAll.addEventListener('click', function () {
      showConfirm({
        title: t('clear.title', null, 'Clear all fields?'),
        message: t('clear.message', null, 'This will permanently remove all drawn fields from this device. This cannot be undone.'),
        okLabel: t('clear.ok', null, 'Clear all'),
        onOk: function () {
          ctx.fieldGroup.clearLayers();
          if (ctx.distanceGroup) ctx.distanceGroup.clearLayers();
          // Cancel any in-progress drawing and hide the hint, otherwise the
          // disclaimer banner stays on screen after clearing.
          drawing.cancelDraw();
          dom.drawingHint.hidden = true;
          refreshActionButtons();
          render();
          emit('ui:cleared');
        },
      });
    });

    // Wire export buttons
    dom.exportGeoJson.addEventListener('click', function () {
      refs.onExportGeoJson();
    });
    dom.exportKml.addEventListener('click', function () {
      if (refs.onExportKml) refs.onExportKml();
    });
    dom.exportPdf.addEventListener('click', function () {
      refs.onExportPdf();
    });

    // Wire cancel-drawing button
    dom.cancelDrawBtn.addEventListener('click', function () {
      drawing.cancelDraw();
      dom.drawingHint.hidden = true;
    });

    // Pending field for per-field download chooser (privacy: single field isolation)
    let pendingDownloadLayer = null;

    // Wire share modal (per-field hash, LAN -> AWS free)
    (function wireShareModal() {
      if (!dom.shareModal) return;
      const closeShare = function () { dom.shareModal.hidden = true; };
      const closers = dom.shareModal.querySelectorAll('[data-close-share]');
      closers.forEach(function (el) { el.addEventListener('click', closeShare); });
      dom.shareModal.addEventListener('click', function (e) {
        if (e.target === dom.shareModal) closeShare();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !dom.shareModal.hidden) closeShare();
      });
      if (dom.shareLinkInput) {
        dom.shareLinkInput.addEventListener('click', function () { dom.shareLinkInput.select(); });
      }
      if (dom.shareCopyBtn) {
        dom.shareCopyBtn.addEventListener('click', function () {
          const val = dom.shareLinkInput ? dom.shareLinkInput.value : '';
          if (!val) return;
          const SHARE = global.FAC_SHARE;
          if (SHARE && SHARE.copyText) {
            SHARE.copyText(val).then(function (ok) {
              toast(ok ? t('toast.shareCopied', null, 'Link copied to clipboard.') : t('toast.shareCopyFail', null, 'Copy failed — select and copy manually.'), ok ? 'success' : 'warn', 3000);
              if (ok) dom.shareModal.hidden = true;
            });
          }
        });
      }
      if (dom.shareNativeBtn) {
        dom.shareNativeBtn.addEventListener('click', function () {
          const val = dom.shareLinkInput ? dom.shareLinkInput.value : '';
          if (!val) return;
          if (global.navigator && typeof global.navigator.share === 'function') {
            global.navigator.share({ title: 'Field share', text: 'Field location', url: val }).catch(function () {});
          }
        });
      }
    })();

    // Wire per-field download chooser modal (privacy: single field only)
    (function wireFieldDownloadModal() {
      if (!dom.fieldDownloadModal) return;
      const close = function () {
        dom.fieldDownloadModal.hidden = true;
        pendingDownloadLayer = null;
      };
      const closers = dom.fieldDownloadModal.querySelectorAll('[data-close-field-download]');
      closers.forEach(function (el) { el.addEventListener('click', close); });
      dom.fieldDownloadModal.addEventListener('click', function (e) {
        if (e.target === dom.fieldDownloadModal) close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !dom.fieldDownloadModal.hidden) close();
      });
      if (dom.fieldDownloadGeoJsonBtn) {
        dom.fieldDownloadGeoJsonBtn.addEventListener('click', function () {
          const layer = pendingDownloadLayer;
          close();
          if (layer && refs.onExportSingleGeoJson) refs.onExportSingleGeoJson(layer);
        });
      }
      if (dom.fieldDownloadPdfBtn) {
        dom.fieldDownloadPdfBtn.addEventListener('click', function () {
          const layer = pendingDownloadLayer;
          close();
          if (layer && refs.onExportSinglePdf) refs.onExportSinglePdf(layer);
        });
      }
    })();

    function openFieldDownloadModal(layer, meta) {
      pendingDownloadLayer = layer;
      if (dom.fieldDownloadMessage) {
        dom.fieldDownloadMessage.textContent = t('dl.singleMsg', { name: (meta.name || t('panel.fieldWord', null, 'Field')) },
          '"' + (meta.name || 'Field') + '" — download this field only. Other fields will not be included or photographed.');
      }
      if (dom.fieldDownloadModal) dom.fieldDownloadModal.hidden = false;
    }

    // --- Local event bus for ui events that other modules may want ---
    const listeners = {};
    function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
    function emit(evt, payload) {
      (listeners[evt] || []).forEach(fn => {
        try { fn(payload); } catch (e) { console.error(e); }
      });
    }

    /** Update the status pill in the header. */
    function setStatus(text, mode) {
      mode = mode || 'ok';
      dom.statusText.textContent = text;
      dom.statusDot.classList.remove('status-busy', 'status-error');
      if (mode === 'busy') dom.statusDot.classList.add('status-busy');
      if (mode === 'error') dom.statusDot.classList.add('status-error');
    }

    /** Show a transient toast notification. */
    function toast(message, kind, durationMs) {
      kind = kind || 'info';
      durationMs = durationMs || 4000;
      const el = document.createElement('div');
      el.className = 'toast toast-' + kind;
      const msgSpan = document.createElement('span');
      msgSpan.textContent = message; // SAFE — textContent, not innerHTML
      el.appendChild(msgSpan);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Dismiss');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', function () { el.remove(); });
      el.appendChild(closeBtn);
      dom.toastContainer.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.remove(); }, durationMs);
    }

    /** Render the totals area. Standard tier is primary; state tier is secondary display from same m² base. */
    function renderTotals() {
      let sum = 0;
      let perimSum = 0;
      ctx.fieldGroup.eachLayer(function (layer) {
        if (layer instanceof global.L.Polygon) {
          sum += drawing.areaOf(layer);
          perimSum += drawing.perimeterOf(layer);
        }
      });
      const primary = UNITS.fromSquareMeters(sum, activeUnit);
      dom.totalValue.textContent = UTILS.formatNumber(primary);
      dom.totalUnit.textContent = UNITS.meta(activeUnit).short;

      // Secondary readouts — show 3 other useful standard units (keep govt reference visible)
      const others = ['m2', 'sqft', 'ac', 'ha', 'km2'].filter(u => u !== activeUnit).slice(0, 3);
      dom.totalSecondary.innerHTML = ''; // safe to clear with this; we rebuild with textContent below
      others.forEach(function (u) {
        const span = document.createElement('span');
        const v = UNITS.fromSquareMeters(sum, u);
        const strong = document.createElement('strong');
        strong.textContent = UTILS.formatNumber(v);
        span.appendChild(strong);
        span.appendChild(document.createTextNode(' ' + UNITS.meta(u).short));
        dom.totalSecondary.appendChild(span);
      });
      // Total boundary length (fencing estimate) — same m base as areas.
      const perimSpan = document.createElement('span');
      const perimStrong = document.createElement('strong');
      perimStrong.textContent = UTILS.formatNumber(perimSum);
      perimSpan.appendChild(perimStrong);
      perimSpan.appendChild(document.createTextNode(' ' + t('panel.perimeterWord', null, 'm perimeter')));
      dom.totalSecondary.appendChild(perimSpan);

      // State-wise tier — single source (sum m²) converted to regional unit
      if (dom.stateUnitValue) {
        if (!activeStateUnit) {
          dom.stateUnitValue.textContent = '—';
          if (dom.stateUnitHint) dom.stateUnitHint.textContent = t('panel.stateHint', null, 'Select your state unit to see conversion');
        } else {
          try {
            const v = UNITS.fromSquareMeters(sum, activeStateUnit);
            const meta = UNITS.meta(activeStateUnit);
            dom.stateUnitValue.textContent = UTILS.formatNumber(v) + ' ' + meta.short;
            if (dom.stateUnitHint) {
              // Hint: 1 acre = X state units + m² per unit for verification
              const perUnitM2 = UNITS.TO_M2[activeStateUnit];
              const perAcre = UNITS.fromSquareMeters(UNITS.TO_M2.ac, activeStateUnit);
              dom.stateUnitHint.textContent = t('panel.acreHint',
                { perAcre: UTILS.formatNumber(perAcre), short: meta.short, perM2: UTILS.formatNumber(perUnitM2) },
                '1 acre = ' + UTILS.formatNumber(perAcre) + ' ' + meta.short +
                ' · 1 ' + meta.short + ' = ' + UTILS.formatNumber(perUnitM2) + ' m²');
            }
          } catch (_) {
            dom.stateUnitValue.textContent = '—';
            if (dom.stateUnitHint) dom.stateUnitHint.textContent = '';
          }
        }
      }
    }

    /** Render the field list in the panel. */
    function renderFieldList() {
      const layers = [];
      ctx.fieldGroup.eachLayer(function (layer) {
        if (layer instanceof global.L.Polygon) layers.push(layer);
      });
      dom.fieldList.innerHTML = ''; // we rebuild fully each render — safe (no user content yet)

      if (layers.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'field-empty';
        const p1 = document.createElement('p'); p1.textContent = t('panel.emptyTitle', null, 'No fields drawn yet.');
        const p2 = document.createElement('p');
        p2.className = 'hint';
        p2.textContent = t('panel.emptyHint', null, 'Use the polygon tool in the top-left of the map to draw your first field.');
        empty.appendChild(p1); empty.appendChild(p2);
        dom.fieldList.appendChild(empty);
        refreshActionButtons();
        return;
      }

      layers.forEach(function (layer, idx) {
        const meta = ctx.readMeta(layer);
        const areaM2 = drawing.areaOf(layer);
        const areaInUnit = UNITS.fromSquareMeters(areaM2, activeUnit);

        const li = document.createElement('li');
        li.className = 'field-item';
        li.dataset.id = meta.id || '';

        // Color swatch
        const swatch = document.createElement('span');
        swatch.className = 'field-color';
        swatch.style.backgroundColor = meta.color;
        li.appendChild(swatch);

        // Info column
        const info = document.createElement('div');
        info.className = 'field-info';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'field-name';
        nameInput.value = meta.name || (t('panel.fieldWord', null, 'Field') + ' ' + (idx + 1));
        nameInput.setAttribute('aria-label', t('panel.fieldNameAria', null, 'Field name'));
        nameInput.addEventListener('change', function () {
          drawing.updateMeta(layer, { name: nameInput.value });
          emit('field:renamed', { layer, name: nameInput.value });
        });
        nameInput.addEventListener('click', function (e) { e.stopPropagation(); });

        const areaDiv = document.createElement('div');
        areaDiv.className = 'field-area';
        const metricSpan = document.createElement('span');
        metricSpan.className = 'field-area-metric';
        metricSpan.textContent = UTILS.formatNumber(areaInUnit) + ' ' + UNITS.meta(activeUnit).short;
        const m2Span = document.createElement('span');
        m2Span.className = 'field-area-m2';
        m2Span.textContent = UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'm2')) + ' m²';
        const perimSpan = document.createElement('span');
        perimSpan.className = 'field-area-perimeter';
        perimSpan.textContent = UTILS.formatNumber(drawing.perimeterOf(layer)) + ' ' + t('panel.perimeterWord', null, 'm perimeter');
        areaDiv.appendChild(metricSpan);
        areaDiv.appendChild(document.createTextNode(' · '));
        areaDiv.appendChild(m2Span);
        areaDiv.appendChild(document.createTextNode(' · '));
        areaDiv.appendChild(perimSpan);

        info.appendChild(nameInput);
        info.appendChild(areaDiv);
        // State-wise per-field line (same m² base, regional vocabulary)
        if (activeStateUnit) {
          try {
            const stateV = UNITS.fromSquareMeters(areaM2, activeStateUnit);
            const stateMeta = UNITS.meta(activeStateUnit);
            const stateDiv = document.createElement('div');
            stateDiv.className = 'field-area-state';
            stateDiv.textContent = UTILS.formatNumber(stateV) + ' ' + stateMeta.short;
            info.appendChild(stateDiv);
          } catch (_) {}
        }
        li.appendChild(info);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'field-actions';

        const focusBtn = document.createElement('button');
        focusBtn.type = 'button';
        focusBtn.className = 'icon-btn';
        focusBtn.title = t('act.zoom', null, 'Zoom to this field');
        focusBtn.setAttribute('aria-label', t('act.zoom', null, 'Zoom to this field'));
        focusBtn.textContent = '◎';
        focusBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          const b = layer.getBounds();
          if (b.isValid()) ctx.map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
        });
        actions.appendChild(focusBtn);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'icon-btn';
        editBtn.title = t('act.edit', null, 'Edit this polygon');
        editBtn.setAttribute('aria-label', t('act.edit', null, 'Edit this polygon'));
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          try { ctx.map.pm.enableGlobalEditMode(); } catch (_) {}
        });
        actions.appendChild(editBtn);

        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'icon-btn';
        shareBtn.title = t('act.share', null, 'Share this field');
        shareBtn.setAttribute('aria-label', t('act.share', null, 'Share this field'));
        shareBtn.textContent = '⤴';
        shareBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          const SHARE = global.FAC_SHARE;
          if (!SHARE || typeof SHARE.generateLinkForLayer !== 'function') {
            toast(t('toast.shareUnavailable', null, 'Sharing not available.'), 'error');
            return;
          }
          const link = SHARE.generateLinkForLayer(layer, meta);
          if (!link) {
            toast(t('toast.shareNoLink', null, 'Could not create share link for this field.'), 'error', 4000);
            return;
          }
          openShareModal(link, meta.name || (t('panel.fieldWord', null, 'Field') + ' ' + (idx + 1)));
        });
        actions.appendChild(shareBtn);

        const dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'icon-btn';
        dlBtn.title = t('act.downloadLong', null, 'Download this field (GeoJSON / PDF) — re-centered photo');
        dlBtn.setAttribute('aria-label', t('act.download', null, 'Download this field'));
        dlBtn.textContent = '📥';
        dlBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openFieldDownloadModal(layer, meta);
        });
        actions.appendChild(dlBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'icon-btn icon-btn-danger';
        delBtn.title = t('act.delete', null, 'Delete this field');
        delBtn.setAttribute('aria-label', t('act.delete', null, 'Delete this field'));
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          showConfirm({
            title: t('delete.title', null, 'Delete this field?'),
            message: t('delete.message', { name: (meta.name || t('panel.fieldWord', null, 'Field')) },
              '"' + (meta.name || 'Field') + '" will be removed.'),
            okLabel: t('delete.ok', null, 'Delete'),
            onOk: function () { drawing.removeLayer(layer); },
          });
        });
        actions.appendChild(delBtn);

        li.appendChild(actions);
        dom.fieldList.appendChild(li);
      });

      refreshActionButtons();
    }

    /** Toggle the export buttons based on field count. */
    function refreshActionButtons() {
      const hasFields = ctx.fieldGroup.getLayers().length > 0;
      dom.exportGeoJson.disabled = !hasFields;
      dom.exportKml.disabled = !hasFields;
      dom.exportPdf.disabled = !hasFields;
      dom.distanceBtn.disabled = !hasFields;
      dom.clearAll.disabled = !hasFields;
    }

    /** Full re-render of totals + list. */
    function render() {
      renderTotals();
      renderFieldList();
    }

    /**
     * Generic confirmation modal. OK → onOk, Cancel/backdrop/Escape → onCancel.
     * Two buttons only — fires exactly once per showing.
     */
    function showConfirm(opts) {
      dom.confirmTitle.textContent = opts.title || t('confirm.title', null, 'Confirm');
      dom.confirmMessage.textContent = opts.message || t('confirm.message', null, 'Are you sure?');
      dom.confirmOk.textContent = opts.okLabel || t('confirm.ok', null, 'Confirm');
      if (dom.confirmCancel) dom.confirmCancel.textContent = opts.cancelLabel || t('confirm.cancel', null, 'Cancel');
      dom.confirmModal.hidden = false;
      let settled = false;
      const cleanup = function () {
        dom.confirmModal.hidden = true;
        dom.confirmOk.onclick = null;
        const closers = dom.confirmModal.querySelectorAll('[data-close-modal]');
        closers.forEach(function (el) { el.onclick = null; });
      };
      const fire = function (fn) {
        if (settled) return;
        settled = true;
        cleanup();
        if (typeof fn === 'function') fn();
      };
      dom.confirmOk.onclick = function () { fire(opts.onOk); };
      // Backdrop + Cancel button both mean "dismiss" — same as Cancel.
      const closers = dom.confirmModal.querySelectorAll('[data-close-modal]');
      closers.forEach(function (el) {
        el.onclick = function () { fire(opts.onCancel); };
      });
    }

    /** Open the per-field share modal with a ready-to-copy link (LAN -> AWS free). */
    function openShareModal(link, fieldName) {
      if (!dom.shareModal || !dom.shareLinkInput) {
        // Fallback: copy and toast if modal missing
        const SHARE = global.FAC_SHARE;
        if (SHARE && SHARE.copyText) {
          SHARE.copyText(link).then(function (ok) {
            toast(ok ? 'Link copied: ' + link : link, ok ? 'success' : 'info', 5000);
          });
        }
        return;
      }
      dom.shareLinkInput.value = link;
      // WhatsApp link
      if (dom.shareWhatsappBtn) {
        const SHARE = global.FAC_SHARE;
        const wa = SHARE && SHARE.whatsappLink ? SHARE.whatsappLink(link, fieldName) : '#';
        dom.shareWhatsappBtn.href = wa;
      }
      // Native Share button visibility
      if (dom.shareNativeBtn) {
        const SHARE = global.FAC_SHARE;
        const canShare = SHARE && SHARE.canWebShare && SHARE.canWebShare();
        dom.shareNativeBtn.hidden = !canShare;
      }
      dom.shareModal.hidden = false;
      // Auto-select for quick manual copy (especially LAN http where clipboard blocked)
      setTimeout(function () {
        try { dom.shareLinkInput.focus(); dom.shareLinkInput.select(); } catch (_) {}
      }, 50);
      // Also try auto-copy in background (HTTPS on AWS will succeed, LAN http may fail gracefully)
      const SHARE2 = global.FAC_SHARE;
      if (SHARE2 && SHARE2.copyText) {
        SHARE2.copyText(link).then(function (ok) {
          if (ok) toast('Link copied to clipboard.', 'success', 2500);
        });
      }
    }

    /** Set the version footer on first paint. */
    dom.footerVersion.textContent = 'FarmMeasure v' + CONFIG.version;

    return {
      on, emit,
      setStatus, toast, render, refreshActionButtons,
      getActiveUnit: function () { return activeUnit; },
      getActiveStateUnit: function () { return activeStateUnit; },
      showConfirm,
      /** Mark the GPS button as actively using the user's location.
       *  Adds a "Location active" badge so the user always knows the
       *  site has a live position, per browser privacy conventions. */
      setGpsActive: function (active) {
        const b = dom.gpsBtn;
        if (!b) return;
        if (active) {
          b.classList.add('gps-active');
          b.setAttribute('aria-pressed', 'true');
        } else {
          b.classList.remove('gps-active');
          b.setAttribute('aria-pressed', 'false');
        }
      },
      dom, // expose so app.js can also wire GPS button
    };
  }

  global.FAC_UI = { init };
})(window);
