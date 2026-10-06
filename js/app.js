/**
 * app.js — entry point.
 *
 * Wires modules together:
 *   - builds the map
 *   - configures drawing (geoman)
 *   - subscribes to drawing events to re-render UI and persist state
 *   - wires the GPS button
 *   - restores saved state on load
 *
 * All other modules are decoupled; they expose a small API and an event
 * surface. app.js is the only place where the wiring lives.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const STORAGE = global.FAC_STORAGE;
  const GEO = global.FAC_GEOLOCATION;
  const UTILS = global.FAC_UTILS;

  /**
   * Translate with hardcoded English fallback. Resolved lazily because
   * js/i18n.js loads after some modules (always before any call runs).
   */
  function T(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  /**
   * Bootstraps the application once the DOM is ready.
   */
  async function bootstrap() {
    try {
      // 0. Language first — dictionaries before first paint so a saved
      //    Hindi choice renders Hindi immediately. Never throws: worst
      //    case the app runs in hardcoded English.
      try {
        if (global.FAC_I18N && typeof global.FAC_I18N.init === 'function') {
          await global.FAC_I18N.init();
        }
      } catch (_) {}
      // 1. Verify all vendor scripts are present before going further.
      requireVendor();

      // 2. Map
      const mapContainer = document.getElementById('map');
      const mapCtx = global.FAC_MAP.create(mapContainer);

      // 3. Drawing (depends on map)
      const drawing = global.FAC_DRAWING.setup(mapCtx);

      // 4. UI (will subscribe to drawing events; we wire them after init)
      const ui = global.FAC_UI.init({
        mapCtx: mapCtx,
        drawing: drawing,
        onExportGeoJson: exportGeoJson,
        onExportKml: exportKml,
        onExportPdf: async function () {
          const info = await collectReporter(ui);
          if (!info && hasReporter()) { ui.toast(T('toast.reportCancelled', null, 'Report cancelled.'), 'info', 2500); return; }
          return global.FAC_PDF.generate({ mapCtx, drawing, ui, reporter: info });
        },
        onExportSingleGeoJson: function (layer) { return exportSingleGeoJson(layer); },
        onExportSinglePdf: async function (layer) {
          const info = await collectReporter(ui);
          if (!info && hasReporter()) { ui.toast(T('toast.reportCancelled', null, 'Report cancelled.'), 'info', 2500); return; }
          return global.FAC_PDF.generateForLayer(layer, { mapCtx, drawing, ui, reporter: info });
        },
      });

      // 5. Restore saved fields BEFORE wiring drawing events so the first
      //    pm:create doesn't fire as a side effect of restore.
      const saved = STORAGE.load();
      if (saved && saved.features.length > 0) {
        const ok = mapCtx.loadFeatureCollection(saved);
        if (ok) {
          ui.toast(T('toast.restored', { n: saved.features.length }, 'Restored ' + saved.features.length + ' field(s) from this device.'), 'info', 3000);
          // Sync color counter so new fields get the next color in the palette
          if (drawing && typeof drawing.setFieldCount === 'function') {
            drawing.setFieldCount(saved.features.length);
          }
          // Zoom to fit restored fields, but only if user has no recent interaction.
          setTimeout(function () { mapCtx.fitToFields(); }, 300);
        }
      }

      // 5b. (cont.) Restore theme preference from localStorage
      const storedTheme = UTILS.readStoredTheme();
      UTILS.applyTheme(storedTheme);
      UTILS.setToggleIcon(UTILS.isDark() ? false : true); // false = dark (moon)

      // Also listen to system changes while in 'auto' mode
      if (storedTheme === 'auto') {
        const mq = global.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', function () {
          if (storedTheme === 'auto') {
            UTILS.applyTheme('auto');
            UTILS.setToggleIcon(UTILS.isDark() ? false : true);
          }
        });
      }

      // 6. Wire drawing events → UI re-render + autosave
      // Autosave failures (full/blocked storage) would otherwise lose work
      // silently — warn once per session and point at GeoJSON export.
      let saveWarned = false;
      const saveDebounced = STORAGE.debouncedSave(function () {
        const fc = mapCtx.toFeatureCollection();
        const res = STORAGE.saveDetailed(fc);
        if (!res.ok && !saveWarned) {
          saveWarned = true;
          ui.toast(res.reason === 'quota'
            ? T('toast.saveQuota', null, 'Could not save to this device (storage is full or blocked). Export GeoJSON to keep your fields safe.')
            : T('toast.saveUnavailable', null, 'Could not save to this device (storage unavailable). Export GeoJSON to keep your fields safe.'), 'warn', 6000);
        }
      });

      drawing.on('field:created', function () {
        ui.render();
        saveDebounced();
        ui.refreshActionButtons();
      });
      drawing.on('field:edited', function () {
        ui.render();
        saveDebounced();
      });
      drawing.on('field:removed', function () {
        ui.render();
        saveDebounced();
        ui.refreshActionButtons();
      });
      drawing.on('draw:start', function () {
        document.getElementById('drawingHint').hidden = false;
      });
      drawing.on('draw:end', function () {
        document.getElementById('drawingHint').hidden = true;
      });
      // After first vertex, hide the banner — plotting points need clear view on mobile/desktop
      drawing.on('draw:vertexadded', function () {
        const hint = document.getElementById('drawingHint');
        if (hint && !hint.hidden) hint.hidden = true;
      });

      // 7. GPS button
      wireGpsButton(ui);

      // 7a. Import GeoJSON / KML
      wireImport(ui, mapCtx, drawing);

      // 7b. KML export
      wireExportKml(ui, mapCtx, drawing);

      // 7c. Distance measurement tool
      wireDistance(ui, mapCtx, drawing);

      // 7d. Mobile bottom sheet (drag to resize the fields panel)
      if (global.FAC_BOTTOM_SHEET) global.FAC_BOTTOM_SHEET.initBottomSheet();

      // 7b2. Mobile hamburger menu (draw/reshape/clear/zoom/north + Map type street/Hybrid)
      if (global.FAC_MOBILE_MENU && global.FAC_MOBILE_MENU.initMobileMenu) {
        global.FAC_MOBILE_MENU.initMobileMenu(mapCtx);
      }

      // 7b3. Tile viewing aids — clarity (default on) + HD (default off).
      // Display-only: never touches geometry or persistence.
      try {
        if (global.FAC_TILEVIEW && typeof global.FAC_TILEVIEW.init === 'function') {
          global.FAC_TILEVIEW.init({ mapCtx: mapCtx, ui: ui });
        }
      } catch (e) {
        console.warn('[tiles] init failed', e);
      }

      // 7c. Per-field hash share — LAN -> AWS free (no backend). Must run after
      //     saved fields are restored and before first render so appended field
      //     is included in totals. Uses #f= hash, never hits server.
      try {
        if (global.FAC_SHARE && typeof global.FAC_SHARE.tryLoadFromHash === 'function') {
          global.FAC_SHARE.tryLoadFromHash(mapCtx, ui);
        }
      } catch (e) {
        console.warn('[share] hash load failed', e);
      }

      // 8. Theme toggle button
      wireThemeToggle(ui);

      // 8a. Service Worker — offline shell + offline maps (tiles cached after once loading)
      registerServiceWorker(ui);

      // 9. Help popup — shows on every visit, closable, plus (?) button above draw tools
      wireHelpModal();

      // 9a. Licensing modal — opened from footer button or mobile menu
      wireLicensingModal();

      // 9b. Language picker modal + live re-render on switch
      wireLanguageModal(ui);
      applyLanguageToChrome();
      if (global.FAC_I18N && typeof global.FAC_I18N.onChange === 'function') {
        global.FAC_I18N.onChange(function () {
          global.FAC_I18N.applyStatic();
          applyLanguageToChrome();
          if (global.FAC_TILEVIEW && typeof global.FAC_TILEVIEW.refresh === 'function') {
            try { global.FAC_TILEVIEW.refresh(); } catch (_) {}
          }
          ui.render();
          ui.refreshActionButtons();
        });
      }
      if (global.FAC_I18N && typeof global.FAC_I18N.applyStatic === 'function') {
        global.FAC_I18N.applyStatic();
      }

      // 9. Initial render + status
      ui.render();
      ui.setStatus(T('status.ready', null, 'Ready'), 'ok');

      // 9. Expose for ad-hoc debugging and the headless smoke tests
      //    (no build step exists, so this ships — same-origin only).
      global.__fac = { mapCtx, drawing, ui, CONFIG };

      console.info('[app] FarmMeasure v' + CONFIG.version + ' ready');
    } catch (err) {
      console.error('[app] bootstrap failed', err);
      showBootError(err);
    }
  }

  /** Verify all required globals are loaded. Clear error if not. */
  function requireVendor() {
    const missing = [];
    if (!global.L) missing.push('Leaflet');
    if (!global.L || !global.L.PM) missing.push('leaflet-geoman');
    if (!global.turf || typeof global.turf.area !== 'function') missing.push('Turf.js');
    if (!global.pako || typeof global.pako.deflate !== 'function') missing.push('pako');
    if (!global.jspdf) missing.push('jsPDF');
    if (!global.html2canvas) missing.push('html2canvas');
    if (missing.length) {
      throw new Error('Missing vendor libraries: ' + missing.join(', '));
    }
  }

  /**
   * Wire the GPS button to the geolocation module.
   * AUDIT NOTES (Senior Dev / Auditor):
   *  - Uses only browser Geolocation API (navigator.geolocation) — no third party.
   *  - Shows blue-dot + accuracy circle via FAC_GEOLOCATION.showLocationOnMap.
   *  - Handles insecure context (file://), unsupported, permission_denied,
   *    timeout, and unavailable with distinct user messages.
   *  - Button has busy/disabled state, aria-pressed, prevent double-click.
   *  - Location is NOT persisted to localStorage.
   */
  function wireGpsButton(ui) {
    const btn = document.getElementById('gpsBtn');
    if (!btn) return;

    // Feature detection + insecure-context guard
    if (!GEO.isSupported()) {
      btn.disabled = true;
      btn.title = T('gps.noGeoTitle', null, 'Geolocation is not supported in this browser or requires HTTPS.');
      return;
    }
    // file:// is insecure — warn early
    if (global.location && global.location.protocol === 'file:') {
      btn.title = T('gps.fileTitle', null, 'Location requires HTTPS or http://localhost. Open via a local server.');
    }

    let locating = false;

    function requestLocation() {
      if (locating) return;
      const mapCtx = global.__fac && global.__fac.mapCtx;
      if (!mapCtx) return;
      locating = true;
      ui.setStatus(T('status.locating', null, 'Locating…'), 'busy');
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      const label = btn.querySelector('.btn-label');
      const prevLabel = label ? label.textContent : '';
      if (label) label.textContent = T('gps.locating', null, 'Locating…');
      ui.setGpsActive(true);

      GEO.getCurrentPosition()
        .then(function (pos) {
          // Center + show marker
          mapCtx.map.setView([pos.lat, pos.lng], 17);
          GEO.showLocationOnMap(mapCtx.map, pos);
          ui.setStatus(T('status.centered', null, 'Centered on your location'), 'ok');
          ui.toast(T('toast.gpsCentered', { n: Math.round(pos.accuracy) }, 'Centered on your location (±' + Math.round(pos.accuracy) + ' m).'), 'success', 3000);
        })
        .catch(function (err) {
          ui.setStatus(T('status.unavailable', null, 'Location unavailable'), 'error');
          ui.setGpsActive(false);
          const msg = err && err.message ? err.message : T('toast.gpsFail', null, 'Your location couldn’t be resolved. Check Location is enabled and try again.');
          ui.toast(msg, 'error', 5000);
          // Optional: surface permission hint via Permissions API
          GEO.queryPermission().then(function (state) {
            if (state === 'denied') {
              ui.toast(T('toast.gpsBlocked', null, 'Location permission is blocked. Enable it in browser site settings.'), 'warn', 6000);
            }
          });
        })
        .then(function () {
          locating = false;
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
          if (label) label.textContent = prevLabel || T('gps.label', null, 'Use my location');
        });
    }

    btn.addEventListener('click', requestLocation);
  }

  /**
   * Wire the theme toggle button in the header.
   * Clicking it cycles: light → dark → light (persisted in localStorage).
   * In 'auto' mode the first click picks dark or light depending on system pref.
   */
  function wireThemeToggle(ui) {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      const currentTheme = UTILS.readStoredTheme();
      const nextTheme =
        currentTheme === 'light' ? 'dark'
          : currentTheme === 'dark' ? 'light'
            : UTILS.isDark() ? 'light' : 'dark';

      // Persist explicit choice over 'auto'
      const storageKey = FAC_CONFIG.storage.key + ':theme';
      UTILS.storage.set(storageKey, nextTheme);

      UTILS.applyTheme(nextTheme);
      UTILS.setToggleIcon(nextTheme === 'light');
      ui.toast(
        nextTheme === 'dark' ? T('toast.themeDark', null, 'Dark mode on') : T('toast.themeLight', null, 'Light mode on'),
        'info',
        1500
      );
    });
  }

  /**
   * Wire Import button + drag-and-drop + file input.
   * AUDIT: file size capped (5 MiB), feature count capped (100), KML via DOMParser,
   * properties whitelisted, coordinates validated — no eval/innerHTML.
   */
  function wireImport(ui, mapCtx, drawing) {
    const btn = document.getElementById('importBtn');
    const input = document.getElementById('importFileInput');
    const footer = document.querySelector('.panel-footer');
    const IMPORT = global.FAC_IMPORT;
    if (!btn || !input || !IMPORT) return;

    btn.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      if (!file) return;
      // Reset value so same file can be re-selected
      const p = IMPORT.handleFile(file, mapCtx, ui, drawing);
      p.then(function () { input.value = ''; });
      p.catch(function (err) {
        console.error('[import] handleFile failed', err);
        ui.toast(T('toast.importFailed', { e: (err && err.message ? err.message : String(err)) }, 'Import failed: ' + (err && err.message ? err.message : String(err))), 'error');
        input.value = '';
      });
    });

    // Drag-and-drop on panel footer (and fallback on whole panel)
    const dropZone = footer || document.getElementById('panel');
    if (!dropZone) return;

    function isFileDrag(e) {
      if (!e.dataTransfer || !e.dataTransfer.types) return false;
      return Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
    }

    dropZone.addEventListener('dragover', function (e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dropZone.classList.add('drop-active');
    });
    dropZone.addEventListener('dragleave', function (e) {
      if (!isFileDrag(e)) return;
      // Only remove if leaving the zone itself, not a child
      if (e.target === dropZone) dropZone.classList.remove('drop-active');
    });
    dropZone.addEventListener('drop', function (e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dropZone.classList.remove('drop-active');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      const lower = (file.name || '').toLowerCase();
      if (!(lower.endsWith('.geojson') || lower.endsWith('.json') || lower.endsWith('.kml') || lower.endsWith('.xml'))) {
        ui.toast(T('toast.importUnsupported', null, 'Unsupported file. Use .geojson or .kml'), 'warn', 4000);
        return;
      }
      const p = IMPORT.handleFile(file, mapCtx, ui, drawing);
      p.catch(function (err) {
        console.error('[import] drop handleFile failed', err);
        ui.toast(T('toast.importFailed', { e: (err && err.message ? err.message : String(err)) }, 'Import failed: ' + (err && err.message ? err.message : String(err))), 'error');
      });
    });
  }

  /** Wire KML export button — downloads all fields as a styled KML file. */
  function wireExportKml() {
    const btn = document.getElementById('exportKmlBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      exportKml();
    });
  }

  /** Export all fields as a KML file with per-field color styling. */
  async function exportKml() {
    const mapCtx = global.__fac && global.__fac.mapCtx;
    const ui = global.__fac && global.__fac.ui;
    if (!mapCtx || !ui) return;
    const info = await collectReporter(ui);
    if (!info && hasReporter()) { ui.toast(T('toast.reportCancelled', null, 'Report cancelled.'), 'info', 2500); return; }
    const fc = mapCtx.toFeatureCollection();
    if (!fc.features.length) {
      ui.toast(T('toast.noFields', null, 'No fields to export.'), 'warn');
      return;
    }
    try {
      const kml = buildKml(fc, info ? toReportedBy(info) : null);
      const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fields-' + (global.FAC_UTILS.todayIso()) + '.kml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      ui.toast(T('toast.kmlDone', null, 'KML file downloaded.'), 'success', 3000);
    } catch (e) {
      console.error('[export] KML failed', e);
      ui.toast(T('toast.kmlFailed', { e: (e && e.message ? e.message : String(e)) }, 'KML export failed: ' + (e && e.message ? e.message : String(e))), 'error');
    }
  }

  /** Build a KML string from a FeatureCollection with per-field color styling. */
  function buildKml(fc, reportedBy) {
    const UNITS = global.FAC_UNITS;
    const GEOM = global.FAC_GEOMETRY;
    const hasState = !!(global.FAC_UI_STATE && global.FAC_UI_STATE.read && global.FAC_UI_STATE.read());
    const stateUnit = hasState ? (global.FAC_UI_STATE.read()) : '';

    let kmlFields = '';
    let totalM2 = 0;

    fc.features.forEach(function (f) {
      const ring = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
      if (!ring) return;
      let areaM2 = 0;
      try { areaM2 = GEOM.polygonAreaSquareMeters(ring); } catch (_) { areaM2 = 0; }
      totalM2 += areaM2;

      const color = f.properties && f.properties.color ? f.properties.color : '#2d5016';
      // Convert #rrggbb to KML aabbggrr format (full opacity)
      const hex = color.replace('#', '');
      const kmlColor = 'ff' + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
      const name = f.properties && f.properties.name ? f.properties.name : T('kml.field', null, 'Field');
      const desc = [
        '<![CDATA[',
        '<b>' + name + '</b><br/>',
        T('kml.area', null, 'Area: ') + UTILS.formatNumber(areaM2) + ' m²',
      ].join('');
      if (hasState && UNITS && UNITS.TO_M2 && stateUnit in UNITS.TO_M2) {
        desc += '<br/>' + UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, stateUnit)) + ' ' + stateUnit;
      }
      desc += ']]>';

      const coords = ring.map(function (c) { return c[0] + ',' + c[1] + ',0'; }).join(' ');

      kmlFields += [
        '<Placemark>',
        '<name>' + name + '</name>',
        '<description>' + desc + '</description>',
        '<Style>',
        '<LineStyle><color>' + kmlColor + '</color><width>3</width></LineStyle>',
        '<PolyStyle><color>' + kmlColor + '</color><fill>1</fill></PolyStyle>',
        '</Style>',
        '<Polygon>',
        '<outerBoundaryIs>',
        '<LinearRing>',
        '<coordinates>' + coords + '</coordinates>',
        '</LinearRing>',
        '</outerBoundaryIs>',
        '</Polygon>',
        '</Placemark>',
      ].join('\n');
    });

    const stateLabel = hasState ? UNITS.meta(stateUnit).label : '';
    const totalState = hasState ? UTILS.formatNumber(UNITS.fromSquareMeters(totalM2, stateUnit)) + ' ' + stateUnit + ' (' + stateLabel + ')' : '';
    const docDesc = T('kml.generated', null, 'Generated by FarmMeasure') +
      (reportedBy && reportedBy.name ? ' · ' + T('kml.reportedBy', null, 'Reported by (self-declared): ') + reportedBy.name : '') +
      (totalState ? ' · ' + T('kml.total', null, 'Total: ') + totalState : '');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '<Document>',
      '<name>FarmMeasure Export</name>',
      '<description>' + docDesc + '</description>',
      kmlFields,
      '</Document>',
      '</kml>',
    ].join('\n');
  }

  /** Wire distance measurement button and handle distance:created events. */
  function wireDistance(ui, mapCtx, drawing) {
    const btn = document.getElementById('distanceBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      const isDist = drawing.isDistanceMode();
      if (isDist) {
        drawing.stopDistance();
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('btn-active');
        ui.toast(T('toast.distOff', null, 'Distance mode off. Switch back to polygon to draw fields.'), 'info', 3000);
      } else {
        drawing.drawDistance();
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('btn-active');
        ui.toast(T('toast.distOn', null, 'Distance mode on — click on the map to trace a path. Double-click or press Enter to finish.'), 'info', 4000);
      }
    });

    // Handle distance measurement completion
    drawing.on('distance:created', function (data) {
      const distMeters = data.distanceMeters;
      const distKm = (distMeters / 1000).toFixed(2);
      const distMi = (distMeters * 0.000621371).toFixed(2);
      ui.toast(T('toast.distDone', { m: UTILS.formatNumber(distMeters), km: distKm, mi: distMi },
        'Distance: ' + UTILS.formatNumber(distMeters) + ' m (' + distKm + ' km / ' + distMi + ' mi)'), 'success', 5000);
      // Update button state back to polygon mode
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('btn-active');
      drawing.stopDistance();
    });
  }

  /** Wire help modal: shows on first visit only; (?) / menu reopens anytime. */
  function wireHelpModal() {
    const modal = document.getElementById('helpModal');
    if (!modal) return;
    const HELP_SEEN_KEY = CONFIG.storage.key + ':help-seen';
    function hasSeenHelp() {
      try {
        return UTILS.storage.get(HELP_SEEN_KEY) === '1';
      } catch (_) { return false; }
    }
    function markHelpSeen() {
      try { UTILS.storage.set(HELP_SEEN_KEY, '1'); } catch (_) {}
    }
    const closeBtn = document.getElementById('helpCloseBtn');
    const closers = modal.querySelectorAll('[data-close-help]');
    function close() { modal.hidden = true; markHelpSeen(); }
    function open() { modal.hidden = false; }
    closers.forEach(function (el) { el.addEventListener('click', close); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
    // First-visit-only: same #helpModal serves mobile + desktop, so one flag
    // covers both views. Still delay slightly so map has painted.
    // If storage is unavailable hasSeenHelp() is false, so we show (safe).
    if (!hasSeenHelp()) {
      setTimeout(open, 600);
    }
    // Expose for help control on map
    global.__facHelpOpen = open;
  }

  /** Wire licensing modal: opened from footer button or mobile menu; closable via button/backdrop/Esc. */
  function wireLicensingModal() {
    const modal = document.getElementById('licensingModal');
    if (!modal) return;
    const openBtn = document.getElementById('licensingBtn');
    const closers = modal.querySelectorAll('[data-close-licensing]');
    function close() { modal.hidden = true; }
    function open() { modal.hidden = false; }
    closers.forEach(function (el) { el.addEventListener('click', close); });
    if (openBtn) openBtn.addEventListener('click', open);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  }

  /** Refresh language-dependent map chrome (help + language buttons). */
  function applyLanguageToChrome() {
    const helpBtn = document.getElementById('mapHelpBtn');
    if (helpBtn) {
      helpBtn.title = T('map.helpTitle', null, 'How to use — plotting, units, state metrics');
      helpBtn.setAttribute('aria-label', T('map.helpAria', null, 'Show usage instructions'));
    }
    const langBtn = document.getElementById('mapLangBtn');
    if (langBtn) {
      langBtn.title = T('map.langTitle', null, 'App language — English / हिन्दी');
      langBtn.setAttribute('aria-label', T('map.langAria', null, 'Change app language'));
    }
  }

  /**
   * Wire the language picker modal. Radios reflect the saved choice —
   * English is pre-selected when active (it is the default; never labelled
   * as such). Apply persists, re-renders, and toasts once on real change.
   */
  function wireLanguageModal(ui) {
    const modal = document.getElementById('languageModal');
    const okBtn = document.getElementById('languageOk');
    if (!modal || !okBtn) return;
    function open() {
      const I = global.FAC_I18N;
      if (!I || typeof I.getLanguage !== 'function') return;
      const cur = I.getLanguage();
      modal.querySelectorAll('input[name="appLang"]').forEach(function (r) {
        r.checked = r.value === cur;
      });
      modal.hidden = false;
    }
    function close() { modal.hidden = true; }
    okBtn.addEventListener('click', function () {
      const sel = modal.querySelector('input[name="appLang"]:checked');
      const next = sel ? sel.value : 'en';
      close();
      const I = global.FAC_I18N;
      if (!I || typeof I.setLanguage !== 'function') return;
      const prev = I.getLanguage();
      I.setLanguage(next).then(function () {
        if (ui && ui.toast && next !== prev) {
          ui.toast(next === 'hi'
            ? I.t('lang.changedHi', null, 'भाषा हिन्दी में बदली गई।')
            : I.t('lang.changedEn', null, 'Language changed to English.'), 'success', 2500);
        }
      });
    });
    const closers = modal.querySelectorAll('[data-close-language]');
    closers.forEach(function (el) { el.addEventListener('click', close); });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
    // App-level hook for the map 🌐 button + mobile menu Languages item
    // (same pattern as __facHelpOpen).
    global.__facLanguageOpen = open;
  }

  /** Reporter details for file exports: memory-only, embedded in the file, never stored. */
  function hasReporter() {
    return !!(global.FAC_REPORTER && typeof global.FAC_REPORTER.collect === 'function');
  }
  function collectReporter(ui) {
    if (!hasReporter()) return Promise.resolve(null);
    return global.FAC_REPORTER.collect({ onError: function (m) { ui.toast(m, 'warn', 4000); } });
  }
  /** Shape reporter info for file metadata. Only present keys are copied; always self-declared. */
  function toReportedBy(info) {
    const out = { selfDeclared: true };
    if (!info) return out;
    ['name', 'phone', 'village', 'mandal', 'district'].forEach(function (k) {
      if (typeof info[k] === 'string' && info[k]) out[k] = info[k];
    });
    return out;
  }

  /** Export the current state as a GeoJSON file download. Includes state-wise unit if chosen. */
  async function exportGeoJson() {
    const mapCtx = global.__fac && global.__fac.mapCtx;
    const ui = global.__fac && global.__fac.ui;
    if (!mapCtx || !ui) return;
    const info = await collectReporter(ui);
    if (!info && hasReporter()) { ui.toast(T('toast.reportCancelled', null, 'Report cancelled.'), 'info', 2500); return; }
    const fc = mapCtx.toFeatureCollection();
    if (!fc.features.length) {
      ui.toast(T('toast.noFields', null, 'No fields to export.'), 'warn');
      return;
    }
    // Enrich with computed areas and optional state-wise unit (same m² base, two vocabularies)
    try {
      const UNITS = global.FAC_UNITS;
      const GEOM = global.FAC_GEOMETRY;
      const activeStateUnit = (ui.getActiveStateUnit && ui.getActiveStateUnit()) || (global.FAC_UI_STATE && global.FAC_UI_STATE.read && global.FAC_UI_STATE.read()) || '';
      const hasState = !!(activeStateUnit && UNITS && UNITS.TO_M2 && activeStateUnit in UNITS.TO_M2);
      const stateMeta = hasState ? UNITS.meta(activeStateUnit) : null;
      let totalM2 = 0;
      fc.features.forEach(function (f) {
        let areaM2 = 0;
        try {
          const ring = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
          if (ring) areaM2 = GEOM.polygonAreaSquareMeters(ring);
        } catch (_) { areaM2 = 0; }
        totalM2 += areaM2;
        // Attach canonical areas to each feature (safe — properties whitelisted downstream will still validate)
        f.properties = f.properties || {};
        f.properties.area_m2 = Number(areaM2.toFixed(2));
        f.properties.area_ha = Number(UNITS.fromSquareMeters(areaM2, 'ha').toFixed(4));
        f.properties.area_ac = Number(UNITS.fromSquareMeters(areaM2, 'ac').toFixed(4));
        if (hasState) {
          f.properties.state_unit = activeStateUnit;
          f.properties.state_unit_label = stateMeta.label;
          f.properties.state_unit_short = stateMeta.short;
          f.properties.area_state = Number(UNITS.fromSquareMeters(areaM2, activeStateUnit).toFixed(4));
        }
      });
      // Top-level metadata (foreign member — ignored by isValidFeatureCollection, preserved on re-import)
      fc.metadata = {
        generatedAt: new Date().toISOString(),
        version: CONFIG.version,
        disclaimer: CONFIG.report.disclaimer,
        reportedBy: info ? toReportedBy(info) : null,
        totalAreaM2: Number(totalM2.toFixed(2)),
        totalAreaHa: Number(UNITS.fromSquareMeters(totalM2, 'ha').toFixed(4)),
        totalAreaAc: Number(UNITS.fromSquareMeters(totalM2, 'ac').toFixed(4)),
        stateUnit: hasState ? activeStateUnit : null,
        stateUnitLabel: hasState ? stateMeta.label : null,
        stateUnitShort: hasState ? stateMeta.short : null,
        totalAreaState: hasState ? Number(UNITS.fromSquareMeters(totalM2, activeStateUnit).toFixed(4)) : null,
      };
    } catch (e) {
      console.warn('[export] enrich failed', e);
    }
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fields-' + (global.FAC_UTILS.todayIso()) + '.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    ui.toast(T('toast.geojsonDone', null, 'GeoJSON file downloaded.'), 'success', 3000);
  }

  /** Export a SINGLE field as GeoJSON (privacy: only that plot). Mirrors exportGeoJson but isolated. */
  async function exportSingleGeoJson(layer) {
    const mapCtx = global.__fac && global.__fac.mapCtx;
    const ui = global.__fac && global.__fac.ui;
    const drawing = global.__fac && global.__fac.drawing;
    if (!mapCtx || !ui || !drawing) return;
    if (!layer || !(layer instanceof global.L.Polygon)) {
      ui.toast(T('toast.geojsonInvalid', null, 'Invalid field for export.'), 'error');
      return;
    }
    const info = await collectReporter(ui);
    if (!info && hasReporter()) { ui.toast('Report cancelled.', 'info', 2500); return; }
    try {
      const UNITS = global.FAC_UNITS;
      const activeStateUnit = (ui.getActiveStateUnit && ui.getActiveStateUnit()) || (global.FAC_UI_STATE && global.FAC_UI_STATE.read && global.FAC_UI_STATE.read()) || '';
      const hasState = !!(activeStateUnit && UNITS && UNITS.TO_M2 && activeStateUnit in UNITS.TO_M2);
      const stateMeta = hasState ? UNITS.meta(activeStateUnit) : null;
      const meta = mapCtx.readMeta(layer);
      const areaM2 = drawing.areaOf(layer);
      const latlngs = layer.getLatLngs()[0];
      const ring = latlngs.map(function (p) { return [p.lng, p.lat]; });
      // Close ring for GeoJSON spec
      if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
        ring.push([ring[0][0], ring[0][1]]);
      }
      const feature = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          id: typeof meta.id === 'string' ? meta.id : null,
          name: typeof meta.name === 'string' ? meta.name : null,
          color: typeof meta.color === 'string' ? meta.color : null,
          createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : null,
          area_m2: Number(areaM2.toFixed(2)),
          area_ha: Number(UNITS.fromSquareMeters(areaM2, 'ha').toFixed(4)),
          area_ac: Number(UNITS.fromSquareMeters(areaM2, 'ac').toFixed(4)),
        },
      };
      if (hasState) {
        feature.properties.state_unit = activeStateUnit;
        feature.properties.state_unit_label = stateMeta.label;
        feature.properties.state_unit_short = stateMeta.short;
        feature.properties.area_state = Number(UNITS.fromSquareMeters(areaM2, activeStateUnit).toFixed(4));
      }
      const fc = {
        type: 'FeatureCollection',
        features: [feature],
        metadata: {
          generatedAt: new Date().toISOString(),
          version: CONFIG.version,
          singleField: true,
          disclaimer: CONFIG.report.disclaimer,
          reportedBy: info ? toReportedBy(info) : null,
          totalAreaM2: Number(areaM2.toFixed(2)),
        },
      };
      const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (meta.name || 'field').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 30) || 'field';
      a.download = safeName + '-' + global.FAC_UTILS.todayIso() + '.geojson';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      ui.toast(T('toast.geojsonSingle', { name: (meta.name || T('panel.fieldWord', null, 'Field')) },
        'GeoJSON for "' + (meta.name || 'Field') + '" downloaded.'), 'success', 3000);
    } catch (e) {
      console.warn('[export] single enrich failed', e);
      ui.toast(T('toast.geojsonFailed', null, 'Could not export this field.'), 'error');
    }
  }

  /** Register Service Worker for offline shell + tiles. Requires HTTPS or localhost. */
  function registerServiceWorker(ui) {
    if (!('serviceWorker' in global.navigator)) return;
    // Skip SW on file:// — not a secure context and fetch will fail
    if (global.location && global.location.protocol === 'file:') return;
    global.navigator.serviceWorker.register('./sw.js').then(function (reg) {
      console.info('[sw] registered', reg.scope);
      // Nudge update if page was loaded with new SW waiting
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', function () {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && global.navigator.serviceWorker.controller) {
            if (ui && ui.toast) ui.toast(T('toast.update', null, 'Update available — reload to refresh.'), 'info', 6000);
          }
        });
      });
    }).catch(function (err) {
      console.warn('[sw] registration failed', err);
    });
    // Reload when new SW takes control
    let refreshing = false;
    global.navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      global.location.reload();
    });
  }

  /** Display a fatal bootstrap error in the UI. */
  function showBootError(err) {
    const banner = document.createElement('div');
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;background:#fee;color:#900;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'padding:20px;font-family:sans-serif;z-index:99999;text-align:center;';
    const h = document.createElement('h2');
    h.textContent = T('err.boot', null, 'Could not start FarmMeasure');
    const p = document.createElement('p');
    p.textContent = String(err && err.message ? err.message : err);
    banner.appendChild(h); banner.appendChild(p);
    document.body.appendChild(banner);
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
