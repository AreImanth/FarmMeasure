/**
 * map.js — map initialization, tile layer, layer groups.
 *
 * Exposes:
 *   FAC_MAP.create(container) — build the map and return module API
 *
 * The map is the single source of truth for drawn polygons. Anything that
 * needs to know "what fields exist" reads from the FeatureGroup.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;
  const L = global.L;
  const GEOM = global.FAC_GEOMETRY;

  /**
   * Build the map on the given container element.
   * @param {HTMLElement} container
   * @returns {Object} map API
   */
  function create(container) {
    if (!container) throw new Error('[map] container element is required');
    if (!L) throw new Error('[map] Leaflet not loaded');

    const tileCfg = CONFIG.tiles[CONFIG.tiles.active];

    const map = L.map(container, {
      center: [CONFIG.defaultCenter.lat, CONFIG.defaultCenter.lng],
      zoom: CONFIG.defaultZoom,
      minZoom: CONFIG.minZoom,
      maxZoom: tileCfg.maxZoom || CONFIG.maxZoom,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
      preferCanvas: true, // Canvas renderer for vector layers — required for html2canvas to
                          // capture polygon fills/strokes in PDF exports. Slightly less
                          // accurate for very large polygons but correct for field-scale areas.
      // Rotation — free, like Google Earth. Shift+scroll or two-finger twist.
      rotate: true,
      bearing: 0,
      touchRotate: true,
      touchZoom: true,
      rotateControl: false, // we add a styled compass below
      shiftKeyRotate: true,
      compassBearing: false,
    });

    // Attribution: hide Leaflet's own brand prefix — full credits (OSM/MapTiler
    // + library versions) live in the Licensing dialog. Tile attributions stay
    // visible on the map as required by ODbL / MapTiler ToS; never disable
    // the control itself.
    if (map.attributionControl) map.attributionControl.setPrefix(false);

    // Compass / rotate control — above the geoman toolbar so it stays free and visible.
    // Uses leaflet-rotate's Compass/ Rotate handler; we provide a minimal styled button.
    if (L.control && L.control.rotate) {
      try { L.control.rotate({ position: 'topleft', closeOnZeroBearing: false }).addTo(map); } catch (_) {}
    }

    // Lightweight help control — sits above the polygon tool so farmers find instructions.
    // Shown as (?) button; opens the same first-visit help modal on demand.
    try {
      const HelpControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
          const c = L.DomUtil.create('div', 'leaflet-control-help leaflet-bar');
          const a = L.DomUtil.create('a', 'leaflet-control-help-btn', c);
          a.id = 'mapHelpBtn';
          a.href = '#';
          a.title = 'How to use — plotting, units, state metrics';
          a.setAttribute('aria-label', 'Show usage instructions');
          a.innerHTML = '<span aria-hidden="true">?</span>';
          L.DomEvent.on(a, 'click', L.DomEvent.stop)
                    .on(a, 'click', function () {
                      const m = document.getElementById('helpModal');
                      if (m) m.hidden = false;
                    }, this);
          return c;
        }
      });
      // Add before geoman so it stacks on top
      new HelpControl().addTo(map);
    } catch (_) {}

    // Language control — sits under the help button. Opens the language
    // picker modal via the app-level hook (same pattern as help).
    // Title/aria are refreshed by app.js on every language change.
    try {
      const LangControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
          const c = L.DomUtil.create('div', 'leaflet-control-help leaflet-bar');
          const a = L.DomUtil.create('a', 'leaflet-control-help-btn', c);
          a.id = 'mapLangBtn';
          a.href = '#';
          a.title = 'App language — English / हिन्दी';
          a.setAttribute('aria-label', 'Change app language');
          a.textContent = '🌐';
          L.DomEvent.on(a, 'click', L.DomEvent.stop)
                    .on(a, 'click', function () {
                      if (typeof global.__facLanguageOpen === 'function') global.__facLanguageOpen();
                    }, this);
          return c;
        }
      });
      new LangControl().addTo(map);
    } catch (_) {}

    // Optional: double-tap to reset bearing to north — free usability
    map.on('rotate', function () {
      // Keep attribution readable — no action needed; placeholder for future bearing label
    });

    // HD (retina) is a creation-time option: toggling it rebuilds layers (see setDetectRetina).
    let retinaOn = false;
    function makeTileLayer(cfg) {
      return L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: cfg.maxZoom || CONFIG.maxZoom,
        maxNativeZoom: cfg.maxNativeZoom || CONFIG.maxZoom,
        detectRetina: retinaOn,
        subdomains: cfg.subdomains || 'abc',
        crossOrigin: true,
      });
    }

    let tileLayer = makeTileLayer(tileCfg).addTo(map);

    // --- Base layers for the Leaflet layer switcher ---
    // Build a tile layer for every entry in CONFIG.tiles (except `active`).
    // The switcher lets users flip between OSM raster and MapTiler Hybrid.
    const baseLayers = {};
    function buildBaseLayers() {
      Object.keys(CONFIG.tiles).forEach(function (key) {
        if (key === 'active') return; // not a tile config
        const cfg = CONFIG.tiles[key];
        baseLayers[cfg.name || key] = makeTileLayer(cfg);
      });
    }
    buildBaseLayers();
    // Start with whichever is active
    const activeLayer = baseLayers[CONFIG.tiles[CONFIG.tiles.active].name || CONFIG.tiles.active];
    if (activeLayer) activeLayer.addTo(map);
    // Only show the switcher if more than one base layer is available
    const baseLayerKeys = Object.keys(baseLayers);
    let layersControl = null;
    if (baseLayerKeys.length > 1) {
      layersControl = L.control.layers(baseLayers, {}, { collapsed: false, position: 'topright' }).addTo(map);
    }

    let activeBaseName = CONFIG.tiles[CONFIG.tiles.active].name || CONFIG.tiles.active;

    /**
     * Toggle HD (retina) tiles. Rebuilds base tile layers because
     * detectRetina is read at layer creation. Field vectors live in
     * separate groups and are untouched.
     */
    function setDetectRetina(on) {
      retinaOn = !!on;
      try {
        if (tileLayer && map.hasLayer(tileLayer)) map.removeLayer(tileLayer);
        Object.keys(baseLayers).forEach(function (k) {
          try { if (map.hasLayer(baseLayers[k])) map.removeLayer(baseLayers[k]); } catch (_) {}
        });
        if (layersControl) { try { map.removeControl(layersControl); } catch (_) {} }
      } catch (_) {}
      tileLayer = makeTileLayer(tileCfg).addTo(map);
      Object.keys(baseLayers).forEach(function (k) { delete baseLayers[k]; });
      buildBaseLayers();
      const activeLayer = baseLayers[activeBaseName];
      if (activeLayer) activeLayer.addTo(map);
      layersControl = null;
      if (Object.keys(baseLayers).length > 1) {
        layersControl = L.control.layers(baseLayers, {}, { collapsed: false, position: 'topright' }).addTo(map);
      }
      updateMapCredits();
      return retinaOn;
    }

    function setBaseLayer(name) {
      const target = baseLayers[name];
      if (!target) return false;
      Object.keys(baseLayers).forEach(function (k) {
        const lyr = baseLayers[k];
        if (map.hasLayer(lyr)) map.removeLayer(lyr);
      });
      // tileLayer was added separately at init (duplicate of activeLayer) — remove it when switching
      if (tileLayer && map.hasLayer(tileLayer) && tileLayer !== target) {
        map.removeLayer(tileLayer);
      }
      if (!map.hasLayer(target)) target.addTo(map);
      activeBaseName = name;
      updateMapCredits();
      return true;
    }

    function getActiveBaseLayer() {
      return activeBaseName;
    }

    function getBaseLayerNames() {
      return Object.keys(baseLayers);
    }

    /**
     * Mirror the active base layer's attribution into the app-footer's
     * credits line (shown on mobile, where Leaflet's own attribution box is
     * hidden so the panel can sit flush at the bottom).
     * SECURITY: the string comes from our own static CONFIG.tiles — the
     * exact text Leaflet already renders — never from user input.
     */
    function updateMapCredits() {
      const el = document.getElementById('mapCredits');
      if (!el) return;
      let html = '';
      Object.keys(CONFIG.tiles).forEach(function (key) {
        if (key === 'active') return;
        const cfg = CONFIG.tiles[key];
        if ((cfg.name || key) === activeBaseName && typeof cfg.attribution === 'string') {
          html = cfg.attribution;
        }
      });
      el.innerHTML = html;
    }
    updateMapCredits();

    // FeatureGroup holds all user polygons. Using a group lets us
    // iterate, bulk-delete, fitBounds to all, and serialize as one GeoJSON.
    const fieldGroup = L.featureGroup().addTo(map);

    // Distance measurement group — polylines drawn for fencing/road length.
    const distanceGroup = L.featureGroup().addTo(map);

    // Optional: scale indicator on desktop for orientation
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    /**
     * Convert the field group into a clean GeoJSON FeatureCollection,
     * stripping any non-Polygon features and enriching each Polygon with
     * the field metadata (id, name, color, createdAt) as GeoJSON properties.
     *
     * SECURITY: Only known scalar fields are copied. We never copy arbitrary
     * data that a future contributor might attach to a layer.
     */
    function toFeatureCollection() {
      // Polygon layers only, in group order — indexes align with the
      // filtered GeoJSON features below even if other layer types exist.
      const polyLayers = fieldGroup.getLayers().filter(function (l) { return l instanceof L.Polygon; });
      const raw = fieldGroup.toGeoJSON();
      raw.features = (raw.features || []).filter(f =>
        f && f.geometry && f.geometry.type === 'Polygon'
      );
      raw.features.forEach(function (f, i) {
        const layer = polyLayers[i];
        if (!layer) return;
        const meta = layer.options && layer.options.facMeta;
        if (!meta) return;
        f.properties = {
          id:        typeof meta.id === 'string' ? meta.id : null,
          name:      typeof meta.name === 'string' ? meta.name : null,
          color:     typeof meta.color === 'string' ? meta.color : null,
          createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : null,
        };
      });
      return raw;
    }

    /**
     * Replace all fields with the given FeatureCollection.
     * Validates before touching the map. No-op on invalid input.
     */
    function loadFeatureCollection(fc) {
      if (!GEOM.isValidFeatureCollection(fc)) return false;
      fieldGroup.clearLayers();
      L.geoJSON(fc, {
        onEachFeature: function (feature, layer) {
          attachMetadata(layer, feature.properties || {});
          const meta = readMeta(layer);
          const color = meta.color || '#2d5016';
          layer.setStyle({
            color: color,
            fillColor: color,
            fillOpacity: 0.25,
            weight: 2,
          });
          fieldGroup.addLayer(layer);
        },
      });
      return true;
    }

    /**
     * Attach metadata (id, name, color) to a layer so it survives GeoJSON round-trips.
     * Stored in layer.options so it doesn't render on the map as a popup.
     */
    function attachMetadata(layer, props) {
      const existing = (layer.options && layer.options.facMeta) || {};
      layer.options.facMeta = {
        id:        props.id        || existing.id        || null,
        name:      props.name      || existing.name      || null,
        color:     props.color     || existing.color     || null,
        createdAt: props.createdAt || existing.createdAt || Date.now(),
      };
    }

    /**
     * Read metadata back from a layer. Returns the stored object or sensible defaults.
     */
    function readMeta(layer) {
      return layer.options.facMeta || {
        id: null, name: null, color: null, createdAt: Date.now(),
      };
    }

    /**
     * Update metadata on an existing layer.
     */
    function writeMeta(layer, partial) {
      const current = readMeta(layer);
      layer.options.facMeta = Object.assign({}, current, partial);
    }

    /**
     * Fit the map view to contain all polygons, with padding.
     * Falls back to default view if there are no polygons.
     */
    function fitToFields(padding) {
      padding = padding || [40, 40];
      if (fieldGroup.getLayers().length === 0) return false;
      map.fitBounds(fieldGroup.getBounds(), { padding: padding });
      return true;
    }

    return {
      map,
      tileLayer,
      fieldGroup,
      distanceGroup,
      toFeatureCollection,
      loadFeatureCollection,
      readMeta,
      writeMeta,
      fitToFields,
      setBaseLayer,
      getActiveBaseLayer,
      getBaseLayerNames,
      setDetectRetina,
      layersControl,
      baseLayers,
    };
  }

  global.FAC_MAP = { create };
})(window);
