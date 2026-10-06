/**
 * units.js — unit conversion + display formatting.
 * Single source of truth: input is always square meters, output is in the
 * chosen unit. Conversion factors are exact to ≥10 significant digits.
 *
 * ARCHITECTURE (two-tier after Indian state support):
 *  - STANDARD units: globally / RERA mandated (m², sq ft, ha, ac, km² …)
 *    Shown in the primary `unitSelect` dropdown and remain the government
 *    record of truth. Never state-dependent.
 *  - STATE units: regional spoken units (Cent — Andhra, Bigha — Rajasthan …)
 *    Shown in the secondary `stateUnitSelect` dropdown. Each variant has a
 *    state suffix so Bigha-Rajasthan (2529 m²) cannot be confused with
 *    Bigha-UP (1337 m²). Both tiers share the same base (m²) — one calc,
 *    two displays.
 *
 * Reference values (NIST / revenue records):
 *   1 acre        = 4046.8564224 m² exactly
 *   1 hectare     = 10000 m² exactly
 *   1 sq ft       = 0.09290304 m² exactly (NIST)
 *   1 sq mile     = 2589988.110336 m²
 *   1 ground      = 2400 sq ft = 222.967296 m² (TN)
 *   1 are         = 100 m² exactly
 *   1 guntha      = 1/40 acre = 101.17141056 m²
 *   1 cent/dec    = 1/100 acre = 40.468564224 m²
 *   1 kanal       = 1/8 acre = 505.8570528 m²
 *   1 marla       = 1/20 kanal = 25.29285264 m²
 *   1 bigha (RJ Pucca / Vigha) = 27225 sq ft = 2529.285264 m²
 *   1 bigha (UP/UK)             = 14400 sq ft = 1337.803776 m²
 *   1 bigha (PB/HR, 4 kanal)    = 2023.4282112 m²
 *   1 katha (WB)                = 720 sq ft = 66.8901888 m²
 *   1 katha (Bihar)             = 1361.25 sq ft ≈ 126.4644 m² (Bihar patwari: 1 bigha=20 katha)
 *   1 gaj                       = 9 sq ft = 0.83612736 m²
 */
(function (global) {
  'use strict';

  /** Conversion factors FROM 1 unit TO square meters. Frozen — single source. */
  const TO_M2 = Object.freeze({
    // Standard / global
    m2: 1,
    sqft: 0.09290304,
    ha: 10000,
    ac: 4046.8564224,
    km2: 1000000,
    sqmi: 2589988.110336,
    gaj: 0.83612736,
    are: 100,
    // State / regional — fixed
    cent: 40.468564224,
    decimal: 40.468564224,
    guntha: 101.17141056,
    ground: 222.967296,
    kanal: 505.8570528,
    marla: 25.29285264,
    // Bigha variants — state-qualified (never use bare `bigha`)
    bigha_rj: 2529.285264,
    bigha_up: 1337.803776,
    bigha_pb: 2023.4282112,
    // Katha variants
    katha_wb: 66.8901888,
    katha_bihar: 126.46440096,
  });

  /** Display metadata. `label` is the human string; `short` is the tight badge. */
  const UNIT_META = Object.freeze({
    // Standard
    m2: { label: 'Square metres', short: 'm²', plural: 'square metres', group: 'standard' },
    sqft: { label: 'Square feet', short: 'sq ft', plural: 'square feet', group: 'standard' },
    ha: { label: 'Hectares', short: 'ha', plural: 'hectares', group: 'standard' },
    ac: { label: 'Acres', short: 'ac', plural: 'acres', group: 'standard' },
    km2: { label: 'Square kilometres', short: 'km²', plural: 'square kilometres', group: 'standard' },
    sqmi: { label: 'Square miles', short: 'sq mi', plural: 'square miles', group: 'standard' },
    gaj: { label: 'Gaj (sq yard)', short: 'gaj', plural: 'gaj', group: 'standard' },
    are: { label: 'Are', short: 'are', plural: 'are', group: 'standard' },
    // State — label includes state so Bigha cannot be confused
    cent: { label: 'Cent — South (AP/TN/KL/KA)', short: 'cent', plural: 'cents', group: 'state' },
    decimal: { label: 'Decimal — East (WB/OD)', short: 'decimal', plural: 'decimals', group: 'state' },
    guntha: { label: 'Guntha — MH/KA/AP/TG', short: 'guntha', plural: 'gunthas', group: 'state' },
    ground: { label: 'Ground — Tamil Nadu', short: 'ground', plural: 'grounds', group: 'state' },
    kanal: { label: 'Kanal — Punjab / Haryana / HP / J&K', short: 'kanal', plural: 'kanals', group: 'state' },
    marla: { label: 'Marla — Punjab / Haryana / HP / J&K', short: 'marla', plural: 'marlas', group: 'state' },
    bigha_rj: { label: 'Bigha — Rajasthan / Gujarat (Vigha Pucca)', short: 'bigha (RJ)', plural: 'bigha', group: 'state' },
    bigha_up: { label: 'Bigha — UP / Uttarakhand', short: 'bigha (UP)', plural: 'bigha', group: 'state' },
    bigha_pb: { label: 'Bigha — Punjab / Haryana (4 kanal)', short: 'bigha (PB)', plural: 'bigha', group: 'state' },
    katha_wb: { label: 'Katha — West Bengal', short: 'katha (WB)', plural: 'katha', group: 'state' },
    katha_bihar: { label: 'Katha — Bihar / Jharkhand', short: 'katha (Bihar)', plural: 'katha', group: 'state' },
  });

  const SUPPORTED = Object.freeze(Object.keys(TO_M2));

  /** Ordered lists for UI — keep standard first, state second. */
  const STANDARD_IDS = Object.freeze(['m2', 'sqft', 'ha', 'ac', 'gaj', 'are', 'km2', 'sqmi']);
  const STATE_IDS = Object.freeze(['cent', 'decimal', 'guntha', 'ground', 'kanal', 'marla', 'bigha_rj', 'bigha_up', 'bigha_pb', 'katha_wb', 'katha_bihar']);

  /**
   * Convert an area from square meters to the target unit.
   * @param {number} sqm area in square meters
   * @param {string} unit one of SUPPORTED
   * @returns {number} area in target unit
   */
  function fromSquareMeters(sqm, unit) {
    if (!Number.isFinite(sqm)) return 0;
    if (!(unit in TO_M2)) {
      throw new Error('Unknown unit: ' + unit);
    }
    return sqm / TO_M2[unit];
  }

  /** Convert an area from any supported unit to square meters. */
  function toSquareMeters(value, unit) {
    if (!(unit in TO_M2)) throw new Error('Unknown unit: ' + unit);
    return value * TO_M2[unit];
  }

  /** Get metadata for a unit. Falls back to hectare. */
  function meta(unit) {
    return UNIT_META[unit] || UNIT_META.ha;
  }

  /** Return all units as an array for iteration. */
  function allUnits() {
    return SUPPORTED.slice();
  }

  /** Return only standard unit ids. */
  function standardUnits() {
    return STANDARD_IDS.slice();
  }

  /** Return only state unit ids. */
  function stateUnits() {
    return STATE_IDS.slice();
  }

  global.FAC_UNITS = {
    fromSquareMeters: fromSquareMeters,
    toSquareMeters: toSquareMeters,
    meta: meta,
    allUnits: allUnits,
    standardUnits: standardUnits,
    stateUnits: stateUnits,
    TO_M2: TO_M2,
  };
})(window);
