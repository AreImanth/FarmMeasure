/**
 * pdf.js — PDF report generation.
 *
 * Bulk: generates multi-page PDF containing title, overview map, totals table,
 *       then per-field photos (privacy: bulk shows everything).
 * Single: generates per-field PDF containing only that field's photo + metrics
 *         (privacy: share/download one plot without leaking others).
 *
 * Screenshots are captured via html2canvas on #map after fitBounds() + settling
 * delay. Canvas renderer is used (preferCanvas:true) so polygons are captured.
 *
 * SECURITY:
 *   - jsPDF vendored, no network.
 *   - Field names via jsPDF.text() safe — no eval.
 *   - Per-field mode isolates data: only the requested layer's ring/name/color
 *     is serialized into the PDF, never other fieldGroup layers.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const UTILS = global.FAC_UTILS;
  const UNITS = global.FAC_UNITS;

  /**
   * Translate with hardcoded English fallback (lazy: i18n.js loads later).
   */
  function T(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  /**
   * Translated display label for a unit id (state-unit descriptions).
   * Falls back to the canonical English label — symbols never change.
   */
  function unitLabel(id) {
    const I = global.FAC_I18N;
    if (I && typeof I.unitLabel === 'function') return I.unitLabel(id);
    return id;
  }

  /**
   * Indic report text.
   *
   * jsPDF's built-in text engine has no OpenType shaping: it draws one glyph
   * per code point, so Telugu/Tamil/Hindi matras and conjuncts land in the
   * wrong place (e.g. "విస్తీర్ణం" or "அறிக்கை" come out mangled). The browser
   * already has a correct shaping engine, so for these languages we render
   * each text run on a high-DPI canvas and place the PNG into the PDF at the
   * same coordinates. English (and any future Latin language) still uses the
   * original vector jsPDF path — output is unchanged.
   *
   * The Noto Sans faces are vendored in fonts/ and declared with @font-face
   * in css/styles.css; the same files drive the UI, so the report looks like
   * the screen. Fonts load lazily, only for the active language.
   */
  const TEXT_SCALE = 4; // canvas pixels per PDF point (crisp at print size)
  const INDIC_FONTS = {
    hi: { family: 'Noto Sans Devanagari', fallback: '"Nirmala UI", "Mangal", sans-serif' },
    te: { family: 'Noto Sans Telugu', fallback: '"Gautami", "Nirmala UI", sans-serif' },
    ta: { family: 'Noto Sans Tamil', fallback: '"Latha", "Nirmala UI", sans-serif' },
  };
  const LANG_LOCALE = { hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN' };

  function currentLang() {
    try {
      const I = global.FAC_I18N;
      return I && typeof I.getLanguage === 'function' ? I.getLanguage() : 'en';
    } catch (_) { return 'en'; }
  }

  let measureCanvas = null;
  function measureCtx() {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
      measureCanvas.width = 8;
      measureCanvas.height = 8;
    }
    return measureCanvas.getContext('2d');
  }

  function toCssColor(a, b, c) {
    if (typeof a === 'string') {
      if (a.charAt(0) === '#' && a.length === 4) {
        return '#' + a[1] + a[1] + a[2] + a[2] + a[3] + a[3];
      }
      return a;
    }
    if (typeof a === 'number' && b === undefined) {
      const v = Math.max(0, Math.min(255, Math.round(a)));
      return 'rgb(' + v + ',' + v + ',' + v + ')';
    }
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      return 'rgb(' + Math.round(a) + ',' + Math.round(b) + ',' + Math.round(c) + ')';
    }
    return '#000000';
  }

  /**
   * Wrap a jsPDF document with canvas-backed text for an Indic language.
   * Only the text-related API is intercepted; layout, images, lines and
   * colours keep using jsPDF itself.
   */
  function installCanvasText(doc, lang) {
    const meta = INDIC_FONTS[lang];
    const state = {
      size: typeof doc.getFontSize === 'function' ? doc.getFontSize() : 10,
      weight: 400,
      italic: false,
      color: '#000000',
    };
    doc.__facText = state;

    const orig = {
      setFont: doc.setFont.bind(doc),
      setFontSize: doc.setFontSize.bind(doc),
      setTextColor: doc.setTextColor.bind(doc),
    };

    function fontSpec() {
      return (state.italic ? 'italic ' : '') + state.weight + ' ' +
        (state.size * TEXT_SCALE) + 'px "' + meta.family + '", ' + meta.fallback;
    }

    doc.setFont = function (name, style) {
      const s = String(style || 'normal').toLowerCase();
      state.weight = s.indexOf('bold') !== -1 ? 700 : 400;
      state.italic = s.indexOf('italic') !== -1;
      try { return orig.setFont(name, style); } catch (_) { return doc; }
    };
    doc.setFontSize = function (size) {
      if (Number(size) > 0) state.size = Number(size);
      return orig.setFontSize(size);
    };
    doc.setTextColor = function (a, b, c) {
      state.color = toCssColor(a, b, c);
      return orig.setTextColor(a, b, c);
    };
    doc.getTextWidth = function (text) {
      const c = measureCtx();
      c.font = fontSpec();
      return c.measureText(String(text == null ? '' : text)).width / TEXT_SCALE;
    };

    doc.text = function (text, x, y, opts) {
      const str = Array.isArray(text) ? text.join(' ') : String(text == null ? '' : text);
      if (!str) return doc;
      const c = measureCtx();
      c.font = fontSpec();
      const metrics = c.measureText(str);
      const pad = Math.ceil(state.size * TEXT_SCALE * 0.18) + 2;
      const left = metrics.actualBoundingBoxLeft || 0;
      const right = metrics.actualBoundingBoxRight || metrics.width;
      const ascent = metrics.actualBoundingBoxAscent || state.size * TEXT_SCALE * 0.8;
      const descent = metrics.actualBoundingBoxDescent || state.size * TEXT_SCALE * 0.25;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(left + right + pad * 2));
      canvas.height = Math.max(1, Math.ceil(ascent + descent + pad * 2));
      const ctx = canvas.getContext('2d');
      ctx.font = fontSpec();
      ctx.fillStyle = state.color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, pad + left, pad + ascent);

      const xPt = x - (pad + left) / TEXT_SCALE;
      const yPt = y - (pad + ascent) / TEXT_SCALE;
      const align = opts && opts.align;
      let drawX = xPt;
      if (align === 'center') drawX -= (metrics.width / TEXT_SCALE) / 2;
      else if (align === 'right') drawX -= metrics.width / TEXT_SCALE;
      doc.addImage(
        canvas.toDataURL('image/png'), 'PNG',
        drawX, yPt, canvas.width / TEXT_SCALE, canvas.height / TEXT_SCALE,
        undefined, 'FAST'
      );
      return doc;
    };
  }

  const webFontPromises = {};
  function ensureWebFont(lang) {
    const meta = INDIC_FONTS[lang];
    if (!meta || typeof document === 'undefined' || !document.fonts) {
      return Promise.resolve(false);
    }
    if (!webFontPromises[lang]) {
      const fonts = document.fonts;
      const spec = '16px "' + meta.family + '"';
      webFontPromises[lang] = Promise.all([
        fonts.load('400 ' + spec),
        fonts.load('700 ' + spec),
      ]).then(function () {
        return fonts.check('400 ' + spec);
      }).catch(function () { return false; });
    }
    return webFontPromises[lang];
  }

  /**
   * Prepare a fresh document for the active language: English keeps the
   * original Helvetica vector text; Indic languages switch to shaped canvas
   * text. Returns the family name passed to setFont() (style tracking still
   * works because setFont/setFontSize are intercepted).
   */
  async function resolvePdfFont(doc) {
    const lang = currentLang();
    if (INDIC_FONTS[lang]) {
      installCanvasText(doc, lang);
      const ready = await ensureWebFont(lang);
      if (!ready) {
        console.warn('[pdf] ' + lang + ' font not ready; using the device fallback face');
      }
    }
    return 'helvetica';
  }

  /** Locale-aware timestamp for report headers. */
  function reportTimestamp() {
    return UTILS.formatTimestamp(new Date(), LANG_LOCALE[currentLang()] || 'en-IN');
  }

  /** Split text into lines that fit maxWidth (uses the document's metrics). */
  function wrapLines(doc, text, maxWidth) {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      const next = line ? line + ' ' + word : word;
      if (line && doc.getTextWidth(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  /** Draw wrapped text, returning the y coordinate after the last line. */
  function drawWrapped(doc, text, x, y, maxWidth, lineH, opts) {
    const lines = wrapLines(doc, text, maxWidth);
    lines.forEach(function (line, i) {
      doc.text(line, x, y + i * lineH, opts);
    });
    return y + lines.length * lineH;
  }

  /** Shorten a string until it fits maxWidth, adding an ellipsis when cut. */
  function truncateToWidth(doc, str, maxWidth) {
    const text = String(str == null ? '' : str);
    if (!text || doc.getTextWidth(text) <= maxWidth) return text;
    const ell = '…';
    let cut = text;
    while (cut.length > 1 && doc.getTextWidth(cut + ell) > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return cut + ell;
  }

  const CAPTURE_DELAY_MS = 600;
  const RESTORE_DELAY_MS = 200;
  const MARGIN = 40;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * Export mode strips the clarity enhancement so PDFs capture the
   * normalized satellite view (what the satellite saw, not the viewing aid).
   * No-op if the tileview module is absent.
   */
  function setTileExport(on) {
    try {
      const TV = global.FAC_TILEVIEW;
      if (TV && typeof TV.setExportMode === 'function') TV.setExportMode(!!on);
    } catch (_) {}
  }

  async function captureMap(mapEl, html2canvasFn) {
    if (mapEl && mapEl._renderer && typeof mapEl._renderer._draw === 'function') {
      try { mapEl._renderer._draw(); } catch (_) {}
    }
    await delay(CAPTURE_DELAY_MS);
    return html2canvasFn(mapEl, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      scale: global.devicePixelRatio || 1,
      logging: false,
    });
  }

  function getMapView(map) {
    return {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: typeof map.getBearing === 'function' ? map.getBearing() : 0,
    };
  }

  function restoreView(map, view) {
    try { map.setView(view.center, view.zoom, { animate: false }); } catch (_) {}
    if (typeof map.setBearing === 'function' && typeof view.bearing === 'number') {
      try { map.setBearing(view.bearing); } catch (_) {}
    }
  }

  /**
   * Crop a canvas to a target aspect ratio (width/height), centered.
   * Map screenshots are wide/short; cropping to a portrait ratio lets the
   * photo fill the PDF page instead of leaving the bottom half empty.
   */
  function cropCanvas(source, targetRatio) {
    const srcW = source.width;
    const srcH = source.height;
    if (!srcW || !srcH) return source;
    const srcRatio = srcW / srcH;
    let cropW, cropH;
    if (srcRatio > targetRatio) {
      cropH = srcH;
      cropW = Math.round(srcH * targetRatio);
    } else {
      cropW = srcW;
      cropH = Math.round(srcW / targetRatio);
    }
    const x = Math.round((srcW - cropW) / 2);
    const y = Math.round((srcH - cropH) / 2);
    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    out.getContext('2d').drawImage(source, x, y, cropW, cropH, 0, 0, cropW, cropH);
    return out;
  }

  /**
   * Format self-declared reporter info into PDF text lines.
   * Returns [] when absent — jsPDF.text() is safe (no eval/HTML).
   */
  function reporterLines(reporter) {
    if (!reporter || typeof reporter.name !== 'string' || !reporter.name) return [];
    const lines = [T('pdf.reportedBy', null, 'Reported by (self-declared): ') + reporter.name];
    if (reporter.phone) lines.push(T('pdf.phone', null, 'Phone: ') + reporter.phone);
    if (reporter.village) lines.push(T('pdf.village', null, 'Village: ') + reporter.village);
    if (reporter.mandal) lines.push(T('pdf.mandal', null, 'Mandal / Tahsil: ') + reporter.mandal);
    if (reporter.district) lines.push(T('pdf.district', null, 'District: ') + reporter.district);
    return lines;
  }

  function ensureBearingNorth(map) {
    if (typeof map.getBearing === 'function' && typeof map.setBearing === 'function') {
      try {
        const b = map.getBearing();
        if (b !== 0) map.setBearing(0);
        return b;
      } catch (_) { return 0; }
    }
    return 0;
  }

  function getJsPdfCtor() {
    if (global.jspdf && typeof global.jspdf.jsPDF === 'function') return global.jspdf.jsPDF;
    if (global.jspdf && typeof global.jspdf === 'function') return global.jspdf;
    if (global.jsPDF && typeof global.jsPDF === 'function') return global.jsPDF;
    return null;
  }

  function buildTotals(layers, drawing) {
    let totalM2 = 0;
    layers.forEach(function (l) { totalM2 += drawing.areaOf(l); });
    return totalM2;
  }

  function addFooter(doc, FONT) {
    // FONT-aware: the brand line is translated, so it must use the same
    // family as the body (canvas-shaped for Indic, helvetica otherwise).
    const fam = FONT || 'helvetica';
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const count = doc.internal.getNumberOfPages();
    const brandHead = 'FarmMeasure · v' + CONFIG.version;
    const brandTail = T('pdf.brand', null, 'All measurements computed locally') +
      ' · ' + T('pdf.mapdata', null, 'Map data © OpenStreetMap contributors');
    const single = brandHead + ' · ' + brandTail;
    const disclaimer = T('pdf.disclaimerShort', null, CONFIG.report.disclaimerShort);
    const maxW = pageW - MARGIN * 2;
    for (let i = 1; i <= count; i++) {
      doc.setPage(i);
      doc.setFont(fam, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(130);
      if (doc.getTextWidth(single) <= maxW && doc.getTextWidth(disclaimer) <= maxW) {
        // Short lines (English): original single-line layout, unchanged.
        doc.text(disclaimer, pageW / 2, pageH - 32, { align: 'center' });
        doc.text(single, pageW / 2, pageH - 20, { align: 'center' });
      } else {
        // Long lines (Indic): stack wrapped, centered lines from the bottom up
        // so nothing trims off the page edge.
        let y = pageH - 18;
        const brandLines = [brandHead].concat(wrapLines(doc, brandTail, maxW));
        for (let b = brandLines.length - 1; b >= 0; b--) {
          doc.text(brandLines[b], pageW / 2, y, { align: 'center' });
          y -= 11;
        }
        y -= 3;
        const discLines = wrapLines(doc, disclaimer, maxW);
        for (let d = discLines.length - 1; d >= 0; d--) {
          doc.text(discLines[d], pageW / 2, y, { align: 'center' });
          y -= 11;
        }
      }
    }
  }

  /**
   * Bulk PDF — entire map + per-field photos after metrics.
   * @param {Object} ctx
   */
  async function generate(ctx) {
    const Ctor = getJsPdfCtor();
    const html2canvasFn = global.html2canvas;
    if (!Ctor) throw new Error('jsPDF not loaded');
    if (!html2canvasFn) throw new Error('html2canvas not loaded');

    const layers = [];
    ctx.mapCtx.fieldGroup.eachLayer(function (layer) {
      if (layer instanceof global.L.Polygon) layers.push(layer);
    });
    if (layers.length === 0) {
      ctx.ui.toast(T('pdf.empty', null, 'Draw at least one field before exporting.'), 'warn');
      return;
    }

    ctx.ui.setStatus(T('status.generating', null, 'Generating PDF…'), 'busy');
    const mapEl = document.getElementById('map');
    const map = ctx.mapCtx.map;
    const originalView = getMapView(map);
    let overviewCanvas = null;
    setTileExport(true);

    try {
      // 1. Overview capture — fit all fields, bearing north for clean report
      const savedBearing = ensureBearingNorth(map);
      ctx.mapCtx.fitToFields();
      await delay(CAPTURE_DELAY_MS);
      try {
        overviewCanvas = await captureMap(mapEl, html2canvasFn);
      } catch (e) {
        console.warn('[pdf] overview capture failed', e);
      }
      // Restore bearing for per-field captures (will reset each time anyway)
      if (typeof map.setBearing === 'function') {
        try { map.setBearing(savedBearing); } catch (_) {}
      }

      // 2. Build PDF shell
      const doc = new Ctor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      // Indic reports switch to canvas-shaped text (jsPDF cannot shape abugidas).
      const FONT = await resolvePdfFont(doc);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let y = MARGIN;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(20);
      doc.text(T('pdf.title', null, 'Field Area Report'), MARGIN, y);
      y += 22;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(110);
      doc.text(T('pdf.generated', null, 'Generated ') + reportTimestamp(), MARGIN, y);
      y += 14;
      const repLines = reporterLines(ctx.reporter);
      if (repLines.length) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(40);
        repLines.forEach(function (ln) { doc.text(ln, MARGIN, y); y += 13; });
        y += 2;
      }
      doc.setTextColor(40);
      doc.text(
        T('pdf.totalFields', null, 'Total fields: ') + layers.length +
        '   ·   ' + T('pdf.zoom', null, 'Map zoom: ') + Math.round(map.getZoom()) +
        '   ·   ' + T('pdf.center', null, 'Lat/Lng center: ') + map.getCenter().lat.toFixed(4) + ', ' + map.getCenter().lng.toFixed(4),
        MARGIN, y
      );
      y += 18;

      if (overviewCanvas) {
        if (y > pageH - MARGIN - 200) { doc.addPage(); y = MARGIN; }
        doc.setFont(FONT, 'bold');
        doc.setFontSize(10);
        doc.setTextColor(40);
        doc.text(T('pdf.overview', null, 'Overview map'), MARGIN, y);
        y += 10;
        const imgData = overviewCanvas.toDataURL('image/png');
        const ratio = overviewCanvas.height / overviewCanvas.width;
        const drawW = pageW - MARGIN * 2;
        const drawH = Math.min(drawW * ratio, pageH - y - MARGIN - 220);
        doc.addImage(imgData, 'PNG', MARGIN, y, drawW, drawH, undefined, 'FAST');
        y += drawH + 16;
      }

      // 3. Table header with state unit if chosen
      const activeStateUnit = (ctx.ui && ctx.ui.getActiveStateUnit && ctx.ui.getActiveStateUnit()) || (global.FAC_UI_STATE && global.FAC_UI_STATE.read && global.FAC_UI_STATE.read()) || '';
      const hasState = !!(activeStateUnit && UNITS.TO_M2 && activeStateUnit in UNITS.TO_M2);
      const stateMeta = hasState ? UNITS.meta(activeStateUnit) : null;
      if (hasState) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(80);
        y = drawWrapped(
          doc,
          T('pdf.stateUnit', null, 'State unit: ') + unitLabel(activeStateUnit) +
            '  ·  1 ' + stateMeta.short + ' = ' + UTILS.formatNumber(UNITS.TO_M2[activeStateUnit]) +
            ' m²  ·  1 acre = ' + UTILS.formatNumber(UNITS.fromSquareMeters(UNITS.TO_M2.ac, activeStateUnit)) +
            ' ' + stateMeta.short,
          MARGIN, y, pageW - MARGIN * 2, 11
        ) + 1;
      }
      doc.setFont(FONT, 'bold');
      doc.setFontSize(12);
      doc.text(T('pdf.measurements', null, 'Field measurements'), MARGIN, y);
      y += 14;
      doc.setFont(FONT, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(60);
      const cols = hasState
        ? ['#', T('pdf.colName', null, 'Name'), 'm²', 'ha', T('pdf.colAcres', null, 'acres'), 'km²', 'sq mi', stateMeta.short]
        : ['#', T('pdf.colName', null, 'Name'), 'm²', 'ha', T('pdf.colAcres', null, 'acres'), 'km²', 'sq mi'];
      // Column 0 holds the row number, drawn right of the color swatch.
      // The swatch itself sits at MARGIN, clear of every text column, so
      // each number always lands on the same line as its color.
      const colX = hasState
        ? [MARGIN + 16, MARGIN + 36, MARGIN + 150, MARGIN + 215, MARGIN + 270, MARGIN + 330, MARGIN + 385, MARGIN + 440]
        : [MARGIN + 16, MARGIN + 40, MARGIN + 200, MARGIN + 280, MARGIN + 340, MARGIN + 410, MARGIN + 470];
      cols.forEach(function (c, i) { doc.text(c, colX[i], y); });
      y += 4;
      doc.setDrawColor(180);
      doc.line(MARGIN, y, pageW - MARGIN, y);
      y += 12;

      doc.setFont(FONT, 'normal');
      doc.setFontSize(11);
      doc.setTextColor(20);
      const totalM2 = buildTotals(layers, ctx.drawing);
      const totals = UNITS.allUnits().reduce(function (acc, u) {
        acc[u] = UNITS.fromSquareMeters(totalM2, u);
        return acc;
      }, {});

      layers.forEach(function (layer, idx) {
        const meta = ctx.mapCtx.readMeta(layer);
        const areaM2 = ctx.drawing.areaOf(layer);
        if (y > pageH - MARGIN - 60) { doc.addPage(); y = MARGIN; }
        const color = meta.color || '#2d5016';
        doc.setFillColor(color);
        // Swatch top at y-8: vertically centered on the 11pt text baseline,
        // so each row number sits on the same line as its color.
        doc.rect(MARGIN + 1, y - 8, 9, 9, 'F');
        doc.setTextColor(20);
        doc.text(String(idx + 1), colX[0], y);
        doc.text(truncateToWidth(doc, meta.name || (T('panel.fieldWord', null, 'Field') + ' ' + (idx + 1)), colX[2] - colX[1] - 8), colX[1], y);
        doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'm2')), colX[2], y);
        doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'ha')), colX[3], y);
        doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'ac')), colX[4], y);
        doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'km2')), colX[5], y);
        doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'sqmi')), colX[6], y);
        if (hasState) doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, activeStateUnit)), colX[7], y);
        y += 18;
      });
      // TOTAL section — ensure it starts on a fresh page if it doesn't fit.
      if (y > pageH - MARGIN - 60) { doc.addPage(); y = MARGIN; }
      y += 4;
      doc.setDrawColor(120);
      doc.line(MARGIN, y, pageW - MARGIN, y);
      y += 14;
      doc.setFont(FONT, 'bold');
      doc.text(T('pdf.total', null, 'TOTAL'), colX[0], y);
      doc.text('', colX[1], y);
      doc.text(UTILS.formatNumber(totals.m2), colX[2], y);
      doc.text(UTILS.formatNumber(totals.ha), colX[3], y);
      doc.text(UTILS.formatNumber(totals.ac), colX[4], y);
      doc.text(UTILS.formatNumber(totals.km2), colX[5], y);
      doc.text(UTILS.formatNumber(totals.sqmi), colX[6], y);
      if (hasState) doc.text(UTILS.formatNumber(UNITS.fromSquareMeters(totalM2, activeStateUnit)), colX[7], y);
      y += 24;

      // 4. Per-field photos section — each on its own page.
      // For a single field, the overview already shows it — no redundant photo.
      if (layers.length > 1) {
        if (y > pageH - MARGIN - 120) { doc.addPage(); y = MARGIN; }
        doc.setFont(FONT, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(40);
        doc.text(T('pdf.photos', null, 'Field photos'), MARGIN, y);
        y += 10;
        doc.setFont(FONT, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(110);
        y = drawWrapped(
          doc,
          T('pdf.photosNote', null, 'Each field photo appears on its own page (privacy: each plot shown individually).'),
          MARGIN, y, pageW - MARGIN * 2, 11
        ) + 7;

        for (let idx = 0; idx < layers.length; idx++) {
          if (idx > 0) { doc.addPage(); y = MARGIN; }

          // Check if we need a fresh page for this field's block
          const headerH = 46; // 12pt title + 10pt detail + gaps + separator
          const imgMaxH = 620; // fill the page — the area below is otherwise empty
          if (y + headerH + imgMaxH > pageH - MARGIN) { doc.addPage(); y = MARGIN; }

          const layer = layers[idx];
          const meta = ctx.mapCtx.readMeta(layer);
          const areaM2 = ctx.drawing.areaOf(layer);
          ctx.ui.setStatus(T('status.capturing', { done: (idx + 1), total: layers.length },
            'Capturing field ' + (idx + 1) + '/' + layers.length + '…'), 'busy');

          ensureBearingNorth(map);
          const bounds = layer.getBounds();
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18, animate: false });
          let fieldCanvas = null;
          try { fieldCanvas = await captureMap(mapEl, html2canvasFn); } catch (e) { console.warn('[pdf] field capture failed for', meta.name, e); }

          // Field header — larger type and generous gaps for readability.
          const fieldColor = meta.color || '#2d5016';
          doc.setFont(FONT, 'bold');
          doc.setFontSize(12);
          doc.setTextColor(20);
          doc.setFillColor(fieldColor);
          doc.rect(MARGIN + 2, y - 9, 10, 10, 'F');
          const title = (idx + 1) + '. ' + (meta.name || (T('panel.fieldWord', null, 'Field') + ' ' + (idx + 1))) + ' — ' + UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'ha')) + ' ha / ' + UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'ac')) + ' ac';
          doc.text(truncateToWidth(doc, title, pageW - MARGIN * 2 - 18), MARGIN + 18, y);
          y += 17;
          doc.setFont(FONT, 'normal');
          doc.setFontSize(10);
          doc.setTextColor(110);
          const detail = UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'm2')) + ' m² · ' + UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, 'sqft')) + ' sq ft · ' + UTILS.formatNumber(ctx.drawing.perimeterOf(layer)) + ' ' + T('pdf.perimWord', null, 'm perimeter') + (hasState ? ' · ' + UTILS.formatNumber(UNITS.fromSquareMeters(areaM2, activeStateUnit)) + ' ' + stateMeta.short : '');
          y = drawWrapped(doc, detail, MARGIN + 18, y, pageW - MARGIN * 2 - 18, 12) + 1;

          // Separator line between header and image
          doc.setDrawColor(180);
          doc.line(MARGIN, y, pageW - MARGIN, y);
          y += 8;

          if (fieldCanvas) {
            // Crop to a portrait ratio so the photo fills the page —
            // a raw landscape capture would leave the bottom half empty.
            const cropped = cropCanvas(fieldCanvas, 0.83);
            const imgData = cropped.toDataURL('image/png');
            const ratio = cropped.height / cropped.width;
            const drawW = pageW - MARGIN * 2;
            const drawH = Math.min(drawW * ratio, 620);
            // Verify image fits on page
            if (y + drawH > pageH - MARGIN - 20) { doc.addPage(); y = MARGIN; }
            doc.addImage(imgData, 'PNG', MARGIN, y, drawW, drawH, undefined, 'FAST');
            y += drawH + 20;
          } else {
            doc.setFont(FONT, 'italic');
            doc.setFontSize(9);
            doc.setTextColor(180);
            doc.text(T('pdf.photoNA', null, '(Photo unavailable)'), MARGIN, y);
            y += 18;
          }

          // Extra spacing after each field block
          y += 8;
        }
      }

      addFooter(doc, FONT);
      const filename = 'field-area-report-' + UTILS.todayIso() + '.pdf';
      doc.save(filename);
      ctx.ui.toast(T('pdf.saved', { f: filename }, 'Report saved: ' + filename), 'success', 5000);
    } catch (err) {
      console.error('[pdf] generation failed', err);
      ctx.ui.toast(T('pdf.failed', null, 'Could not generate the PDF. See console.'), 'error', 6000);
    } finally {
      // Always restore original view, even on failure — privacy: don't leave map stuck on last field
      try { restoreView(map, originalView); setTileExport(false); await delay(RESTORE_DELAY_MS); } catch (_) {}
      ctx.ui.setStatus(T('status.ready', null, 'Ready'), 'ok');
    }
  }

  /**
   * Per-field PDF — only that field's photo (re-centered) + its metrics.
   * Privacy: never includes other fieldGroup layers.
   * @param {L.Polygon} layer
   * @param {Object} ctx {mapCtx,drawing,ui}
   */
  async function generateForLayer(layer, ctx) {
    const Ctor = getJsPdfCtor();
    const html2canvasFn = global.html2canvas;
    if (!Ctor) throw new Error('jsPDF not loaded');
    if (!html2canvasFn) throw new Error('html2canvas not loaded');
    if (!ctx || !ctx.mapCtx || !ctx.ui || !ctx.drawing) {
      throw new Error('PDF context missing');
    }
    if (!layer || !(layer instanceof global.L.Polygon)) {
      ctx.ui.toast(T('pdf.invalid', null, 'Invalid field for PDF.'), 'error');
      return;
    }

    const meta = ctx.mapCtx.readMeta(layer);
    const areaM2 = ctx.drawing.areaOf(layer);
    if (!Number.isFinite(areaM2) || areaM2 < 0.01) {
      ctx.ui.toast(T('pdf.tooSmall', null, 'Field area is too small — cannot export.'), 'warn');
      return;
    }

    ctx.ui.setStatus(T('status.generatingSingle', { name: (meta.name || T('panel.fieldWord', null, 'Field')) },
      'Generating PDF for "' + (meta.name || 'Field') + '"…'), 'busy');
    const mapEl = document.getElementById('map');
    const map = ctx.mapCtx.map;
    const originalView = getMapView(map);
    let fieldCanvas = null;
    setTileExport(true);

    try {
      ensureBearingNorth(map);
      const bounds = layer.getBounds();
      if (!bounds.isValid()) throw new Error('Invalid bounds');
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18, animate: false });
      fieldCanvas = await captureMap(mapEl, html2canvasFn);

      const doc = new Ctor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      // Indic reports switch to canvas-shaped text (jsPDF cannot shape abugidas).
      const FONT = await resolvePdfFont(doc);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let y = MARGIN;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(18);
      doc.text(truncateToWidth(doc, meta.name || T('panel.fieldWord', null, 'Field'), pageW - MARGIN * 2), MARGIN, y);
      y += 18;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(110);
      doc.text(T('pdf.generated', null, 'Generated ') + reportTimestamp(), MARGIN, y);
      y += 14;
      const repLinesSingle = reporterLines(ctx.reporter);
      if (repLinesSingle.length) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(40);
        repLinesSingle.forEach(function (ln) { doc.text(ln, MARGIN, y); y += 13; });
        y += 2;
      }
      doc.setTextColor(60);
      doc.setFontSize(9);
      const center = bounds.getCenter();
      doc.text(T('pdf.centerL', null, 'Center: ') + center.lat.toFixed(5) + ', ' + center.lng.toFixed(5) + '  ·  ' + T('pdf.colorL', null, 'Color: ') + (meta.color || '#2d5016'), MARGIN, y);
      y += 16;

      if (fieldCanvas) {
        const imgData = fieldCanvas.toDataURL('image/png');
        const ratio = fieldCanvas.height / fieldCanvas.width;
        const drawW = pageW - MARGIN * 2;
        const drawH = Math.min(drawW * ratio, pageH - MARGIN - 260);
        doc.addImage(imgData, 'PNG', MARGIN, y, drawW, drawH, undefined, 'FAST');
        y += drawH + 16;
      }

      // Metrics block — primary + state unit
      const activeStateUnit = (ctx.ui && ctx.ui.getActiveStateUnit && ctx.ui.getActiveStateUnit()) || (global.FAC_UI_STATE && global.FAC_UI_STATE.read && global.FAC_UI_STATE.read()) || '';
      const hasState = !!(activeStateUnit && UNITS.TO_M2 && activeStateUnit in UNITS.TO_M2);
      const stateMeta = hasState ? UNITS.meta(activeStateUnit) : null;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(12);
      doc.setTextColor(20);
      doc.text(T('pdf.area', null, 'Area'), MARGIN, y);
      y += 14;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(40);

      const rows = [
        ['m²', UNITS.fromSquareMeters(areaM2, 'm2')],
        ['ha', UNITS.fromSquareMeters(areaM2, 'ha')],
        [T('pdf.colAcres', null, 'acres'), UNITS.fromSquareMeters(areaM2, 'ac')],
        [T('pdf.rowsqft', null, 'sq ft'), UNITS.fromSquareMeters(areaM2, 'sqft')],
        ['km²', UNITS.fromSquareMeters(areaM2, 'km2')],
        ['sq mi', UNITS.fromSquareMeters(areaM2, 'sqmi')],
        [T('pdf.rowPerim', null, 'Perimeter (m)'), ctx.drawing.perimeterOf(layer)],
      ];
      if (hasState) rows.push([stateMeta.short, UNITS.fromSquareMeters(areaM2, activeStateUnit)]);

      // Color swatch
      doc.setFillColor(meta.color || '#2d5016');
      doc.rect(MARGIN, y - 8, 10, 10, 'F');
      let labelW = 0;
      rows.forEach(function (r) {
        labelW = Math.max(labelW, doc.getTextWidth(r[0] + ':'));
      });
      const valueX = Math.max(MARGIN + 90, MARGIN + 16 + labelW + 12);
      rows.forEach(function (r) {
        doc.setTextColor(60);
        doc.text(r[0] + ':', MARGIN + 16, y);
        doc.setTextColor(20);
        doc.setFont(FONT, 'bold');
        doc.text(UTILS.formatNumber(r[1]), valueX, y);
        doc.setFont(FONT, 'normal');
        y += 14;
      });

      y += 8;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(130);
      y = drawWrapped(
        doc,
        T('pdf.note', null, 'Measurements computed via spherical-excess (Turf.js). Map © OpenStreetMap / MapTiler.'),
        MARGIN, y, pageW - MARGIN * 2, 10
      );

      addFooter(doc, FONT);
      const safeName = (meta.name || 'field').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 30) || 'field';
      const filename = safeName + '-' + UTILS.todayIso() + '.pdf';
      doc.save(filename);
      ctx.ui.toast(T('pdf.saved', { f: filename }, 'Report saved: ' + filename), 'success', 5000);
    } catch (err) {
      console.error('[pdf] single-field failed', err);
      ctx.ui.toast(T('pdf.failed', null, 'Could not generate PDF for this field.'), 'error', 5000);
    } finally {
      try { restoreView(map, originalView); setTileExport(false); await delay(RESTORE_DELAY_MS); } catch (_) {}
      ctx.ui.setStatus(T('status.ready', null, 'Ready'), 'ok');
    }
  }

  global.FAC_PDF = { generate: generate, generateForLayer: generateForLayer };
})(window);
