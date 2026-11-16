/**
 * search.js — place search (villages, mandals, districts, towns) for FarmMeasure.
 *
 * Lets someone who is not at the field type a place name taken from a
 * report and jump the map there, then locate the field on the imagery.
 *
 * Provider: OpenStreetMap Nominatim (free, no key). See CONFIG.search.
 *
 * Design / audit notes:
 *  - Search runs ONLY on submit (Enter / button). Nominatim's usage policy
 *    forbids autocomplete-as-you-type, and farmers on slow links benefit
 *    from fewer requests anyway.
 *  - Requests are throttled (>= minIntervalMs apart), one in flight at a
 *    time, with a timeout. Results are cached in memory for the session
 *    only — nothing is written to localStorage (what people search for
 *    stays on the device).
 *  - Privacy: the typed text is sent to the geocoder. Nothing else
 *    (no location, no field data) is sent.
 *  - All provider text is rendered with textContent — never innerHTML.
 *  - The pin lives in its own layer group, NOT in fieldGroup, so it is never
 *    saved, shared or counted as a field. It is non-interactive so it can't
 *    intercept drawing clicks, and it auto-removes after PIN_TTL_MS.
 *  - To switch provider (self-hosted Nominatim, MapTiler geocoding, …),
 *    change CONFIG.search.endpoint and the parse() mapping below, plus the
 *    CSP connect-src entry in index.html.
 */
(function (global) {
  'use strict';

  const PIN_TTL_MS = 60000;
  const CACHE_MAX = 30;

  function T(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  function cfg() {
    return (global.FAC_CONFIG && global.FAC_CONFIG.search) || {
      endpoint: 'https://nominatim.openstreetmap.org/search',
      countryCodes: 'in',
      limit: 6,
      minChars: 3,
      minIntervalMs: 1100,
      timeoutMs: 8000,
      flyMaxZoom: 16,
    };
  }

  /** Collapse whitespace, strip control chars, cap length. */
  function cleanQuery(raw) {
    return String(raw || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  /** First comma-separated part of a query ("Village, Mandal, District" → "Village"). */
  function firstPart(q) {
    const i = q.indexOf(',');
    return i < 0 ? '' : q.slice(0, i).trim();
  }

  /**
   * Map raw Nominatim items to the small shape the UI uses.
   * Drops anything with unusable coordinates.
   */
  function parse(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    items.forEach(function (it) {
      const lat = parseFloat(it && it.lat);
      const lng = parseFloat(it && it.lon);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const parts = String(it.display_name || '')
        .split(',')
        .map(function (p) { return p.trim(); })
        .filter(function (p) { return p && p !== 'India' && !/^\d{6}$/.test(p); });
      const title = String(it.name || parts[0] || '').trim() || parts[0] || '';
      if (!title) return;
      let bbox = null;
      if (Array.isArray(it.boundingbox) && it.boundingbox.length === 4) {
        const b = it.boundingbox.map(parseFloat); // [south, north, west, east]
        if (b.every(isFinite)) bbox = [[b[0], b[2]], [b[1], b[3]]];
      }
      out.push({
        title: title,
        subtitle: parts.slice(1).join(', '),
        lat: lat,
        lng: lng,
        bbox: bbox,
      });
    });
    return out;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function init(opts) {
    const map = opts && opts.map;
    const form = document.getElementById('searchForm');
    const input = document.getElementById('searchInput');
    const panel = document.getElementById('searchPanel');
    const list = document.getElementById('searchResults');
    const statusEl = document.getElementById('searchStatus');
    const btn = document.getElementById('searchBtn');
    if (!map || !form || !input || !panel || !list || !statusEl) return null;

    const C = cfg();
    const pinLayer = L.layerGroup().addTo(map);
    const cache = new Map();
    let lastRequestAt = 0;
    let busy = false;
    let pinTimer = null;

    /* ---------------- panel helpers ---------------- */

    function openPanel() {
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function closePanel() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
    function setStatus(text, kind) {
      statusEl.textContent = text || '';
      statusEl.className = 'search-status' + (kind ? ' is-' + kind : '');
      statusEl.hidden = !text;
    }
    function clearList() {
      while (list.firstChild) list.removeChild(list.firstChild);
    }

    function clearPin() {
      pinLayer.clearLayers();
      if (pinTimer) { clearTimeout(pinTimer); pinTimer = null; }
    }

    function showPin(r) {
      clearPin();
      const icon = L.divIcon({
        className: 'search-pin',
        html: '<span class="search-pin-dot"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const m = L.marker([r.lat, r.lng], { icon: icon, interactive: false, keyboard: false });
      const tip = document.createElement('span');
      tip.textContent = r.title;
      m.bindTooltip(tip, { permanent: true, direction: 'top', offset: [0, -10], className: 'search-pin-tip' });
      pinLayer.addLayer(m);
      pinTimer = setTimeout(clearPin, PIN_TTL_MS);
    }

    function goTo(r) {
      if (r.bbox) {
        map.fitBounds(r.bbox, { maxZoom: C.flyMaxZoom, padding: [30, 30] });
      } else {
        map.setView([r.lat, r.lng], C.flyMaxZoom);
      }
      showPin(r);
      closePanel();
      try { input.blur(); } catch (_) {}
    }

    function renderResults(results) {
      clearList();
      results.forEach(function (r) {
        const li = document.createElement('li');
        li.setAttribute('role', 'presentation');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'search-item';
        b.setAttribute('role', 'option');
        const t = document.createElement('span');
        t.className = 'search-item-title';
        t.textContent = r.title;
        b.appendChild(t);
        if (r.subtitle) {
          const s = document.createElement('span');
          s.className = 'search-item-sub';
          s.textContent = r.subtitle;
          b.appendChild(s);
        }
        b.addEventListener('click', function () { goTo(r); });
        li.appendChild(b);
        list.appendChild(li);
      });
    }

    /* ---------------- network ---------------- */

    function lang() {
      const I = global.FAC_I18N;
      const l = I && typeof I.getLanguage === 'function' ? I.getLanguage() : 'en';
      return l && l !== 'en' ? l + ',en' : 'en';
    }

    async function fetchPlaces(q) {
      const key = lang() + '|' + q.toLowerCase();
      if (cache.has(key)) return cache.get(key);

      const wait = lastRequestAt + C.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      const params = new URLSearchParams({
        q: q,
        format: 'jsonv2',
        countrycodes: C.countryCodes,
        limit: String(C.limit),
        addressdetails: '0',
        'accept-language': lang(),
      });
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(function () { ctl.abort(); }, C.timeoutMs) : null;
      let resp;
      try {
        resp = await fetch(C.endpoint + '?' + params.toString(), {
          headers: { Accept: 'application/json' },
          signal: ctl ? ctl.signal : undefined,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!resp.ok) {
        const err = new Error('HTTP ' + resp.status);
        err.status = resp.status;
        throw err;
      }
      const results = parse(await resp.json());
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, results);
      return results;
    }

    /* ---------------- submit ---------------- */

    async function runSearch() {
      if (busy) return;
      const q = cleanQuery(input.value);
      clearList();
      openPanel();

      if (q.length < C.minChars) {
        setStatus(T('search.tooShort', { n: C.minChars }, 'Type at least ' + C.minChars + ' letters.'), 'warn');
        return;
      }
      if (global.navigator && global.navigator.onLine === false) {
        setStatus(T('search.offline', null, 'You are offline. Search needs internet.'), 'warn');
        return;
      }

      busy = true;
      if (btn) btn.disabled = true;
      setStatus(T('search.searching', null, 'Searching…'), 'busy');
      try {
        let results = await fetchPlaces(q);
        let usedQuery = q;
        let fellBack = false;
        // Reports often read "Village, Mandal, District". If the full text finds
        // nothing, retry with just the village (first part) once.
        if (!results.length) {
          const first = firstPart(q);
          if (first.length >= C.minChars) {
            results = await fetchPlaces(first);
            usedQuery = first;
            fellBack = results.length > 0;
          }
        }
        if (!results.length) {
          setStatus(T('search.none', { q: q }, 'No place found for “' + q + '”. Try the village name only, or another spelling.'), 'warn');
          return;
        }
        renderResults(results);
        setStatus(
          fellBack
            ? T('search.fallback', { q: usedQuery }, 'No exact match. Showing results for “' + usedQuery + '”.')
            : T('search.results', { n: results.length }, results.length + ' places found. Choose one.'),
          fellBack ? 'warn' : ''
        );
      } catch (err) {
        const key = err && err.status === 429 ? 'search.busy' : 'search.failed';
        const fb = err && err.status === 429
          ? 'Search is busy. Wait a few seconds and try again.'
          : 'Search failed. Check your connection and try again.';
        setStatus(T(key, null, fb), 'error');
      } finally {
        busy = false;
        if (btn) btn.disabled = false;
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      runSearch();
    });

    /* ---------------- keyboard + dismissal ---------------- */

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePanel(); return; }
      if (e.key === 'ArrowDown') {
        const first = list.querySelector('.search-item');
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    panel.addEventListener('keydown', function (e) {
      const items = Array.prototype.slice.call(list.querySelectorAll('.search-item'));
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { closePanel(); input.focus(); return; }
      if (e.key === 'ArrowDown' && i >= 0 && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
      if (e.key === 'ArrowUp' && i >= 0) {
        e.preventDefault();
        if (i === 0) input.focus(); else items[i - 1].focus();
      }
    });
    input.addEventListener('focus', function () {
      if (list.firstChild) openPanel();
    });
    // The native "x" of type=search fires `search` with an empty value.
    input.addEventListener('search', function () {
      if (!input.value) { clearList(); setStatus(''); closePanel(); clearPin(); }
    });
    document.addEventListener('pointerdown', function (e) {
      if (!panel.hidden && !form.contains(e.target)) closePanel();
    });

    return { clearPin: clearPin, parse: parse, cleanQuery: cleanQuery };
  }

  global.FAC_SEARCH = { init: init, parse: parse, cleanQuery: cleanQuery, firstPart: firstPart };
})(window);
