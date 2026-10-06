/**
 * geolocation.js — GPS location handling.
 *
 * Wraps navigator.geolocation with:
 *   - explicit, user-friendly error messages for each failure mode
 *   - automatic retry option
 *   - graceful fallback to a default view if GPS is denied/unavailable
 *
 * SECURITY:
 *   - The location never leaves this function except via the callback
 *     parameter. The map module reads it and stores it; nothing else.
 *   - We never persist the user's lat/lng to localStorage.
 */
(function (global) {
  'use strict';

  const CONFIG = global.FAC_CONFIG;

  /** @type {any|null} */
  let locationMarker = null;
  /** @type {any|null} */
  let accuracyCircle = null;

  /**
   * Request the user's current position.
   * @param {Object} [opts]
   * @param {number} [opts.timeoutMs] — overrides CONFIG.geo.timeoutMs
   * @param {number} [opts.maximumAge]
   * @returns {Promise<{lat:number, lng:number, accuracy:number}>}
   *
   * Rejects with one of:
   *   - { code: 'PERMISSION_DENIED',   message }
   *   - { code: 'POSITION_UNAVAILABLE',message }
   *   - { code: 'TIMEOUT',             message }
   *   - { code: 'UNSUPPORTED',         message }
   */
  function t(key, vars, fallback) {
    const I = global.FAC_I18N;
    if (I && typeof I.t === 'function') return I.t(key, vars, fallback);
    return fallback !== undefined ? fallback : key;
  }

  function getCurrentPosition(opts) {
    opts = opts || {};
    if (!global.navigator || !global.navigator.geolocation) {
      return Promise.reject({
        code: 'UNSUPPORTED',
        message: t('geo.unsupported', null, 'Your browser does not support location services.'),
      });
    }
    return new Promise(function (resolve, reject) {
      global.navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          });
        },
        function (err) {
          // Map the raw error.code to our friendly codes
          let code = 'UNKNOWN';
          let message = t('geo.unknown', null, 'Could not determine your location.');
          if (err && typeof err.code === 'number') {
            switch (err.code) {
              case 1: code = 'PERMISSION_DENIED';
                message = t('geo.denied', null, 'Location permission was denied. You can still pan the map and draw anywhere.');
                break;
              case 2: code = 'POSITION_UNAVAILABLE';
                // Could be: OS location service off, no GPS fix indoors,
              // or hardware absent. We can't tell which, so give the
              // user the one actionable thing that fixes most cases.
                message = t('geo.unavailable', null, 'We can\'t find your position right now. Check that your device\'s Location service is turned on, then try again.');
                break;
              case 3: code = 'TIMEOUT';
                message = t('geo.timeout', null, 'Location request timed out. Tap "Use my location" again to retry.');
                break;
            }
          }
          reject({ code, message, raw: err });
        },
        {
          enableHighAccuracy: opts.enableHighAccuracy !== undefined
            ? opts.enableHighAccuracy
            : CONFIG.geo.enableHighAccuracy,
          timeout: opts.timeoutMs || CONFIG.geo.timeoutMs,
          maximumAge: opts.maximumAge !== undefined
            ? opts.maximumAge
            : CONFIG.geo.maximumAge,
        }
      );
    });
  }

  /**
   * Check if geolocation is available in this context.
   * file:// is insecure and will fail; HTTPS or localhost required.
   * @returns {boolean}
   */
  function isSupported() {
    return !!(global.navigator && global.navigator.geolocation);
  }

  /**
   * Query permission state if Permissions API is available.
   * @returns {Promise<string>} 'granted' | 'prompt' | 'denied' | 'unknown'
   */
  function queryPermission() {
    if (global.navigator && global.navigator.permissions && typeof global.navigator.permissions.query === 'function') {
      try {
        return global.navigator.permissions.query({ name: 'geolocation' }).then(function (res) {
          return res.state || 'unknown';
        }).catch(function () { return 'unknown'; });
      } catch (_) { return Promise.resolve('unknown'); }
    }
    return Promise.resolve('unknown');
  }

  /**
   * Show or update the blue-dot + accuracy circle on the map.
   * Uses Leaflet marker + circle. Persists until clearLocationMarker.
   * @param {any} map — Leaflet map instance
   * @param {{lat:number,lng:number,accuracy:number}} pos
   */
  function showLocationOnMap(map, pos) {
    const Leaflet = global.L;
    if (!map || !Leaflet) return;
    const latlng = [pos.lat, pos.lng];
    // Accuracy circle
    if (!accuracyCircle) {
      accuracyCircle = Leaflet.circle(latlng, {
        radius: Math.max(10, pos.accuracy || 30),
        color: '#2d5016',
        fillColor: '#9bd16a',
        fillOpacity: 0.18,
        weight: 1.5,
        interactive: false,
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(Math.max(10, pos.accuracy || 30));
      if (!map.hasLayer(accuracyCircle)) accuracyCircle.addTo(map);
    }
    // Blue dot marker — divIcon so we control style without image assets
    if (!locationMarker) {
      const dotIcon = Leaflet.divIcon({
        className: 'gps-dot-marker',
        html: '<span class="gps-dot-inner" aria-hidden="true"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      locationMarker = Leaflet.marker(latlng, { icon: dotIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else {
      locationMarker.setLatLng(latlng);
      if (!map.hasLayer(locationMarker)) locationMarker.addTo(map);
    }
  }

  /** Remove location marker + circle. */
  function clearLocationMarker(map) {
    try {
      if (locationMarker && map && map.hasLayer(locationMarker)) map.removeLayer(locationMarker);
      if (accuracyCircle && map && map.hasLayer(accuracyCircle)) map.removeLayer(accuracyCircle);
    } catch (_) {}
  }

  global.FAC_GEOLOCATION = { getCurrentPosition, isSupported, queryPermission, showLocationOnMap, clearLocationMarker };
})(window);
