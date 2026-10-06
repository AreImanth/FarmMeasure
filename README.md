# FarmMeasure

A web-based tool for measuring agricultural field boundaries and calculating
land area. Built with vanilla JavaScript and Leaflet. Runs entirely in your
browser — no server, no account, no data leaves your device.

> **Motto: privacy first, reference only.** All values are indicative
> measurements for reference — not a legal survey. Whoever generates a
> report must verify it against revenue records or a licensed surveyor.

## Features

- **Interactive drawing** — draw, edit, and delete polygon boundaries by
  tapping points (manual point-tapping works on uneven ground where GPS
  walking fails); per-field color coding throughout map, table, and reports
- **Accurate area** — computed via the spherical-excess formula (Turf.js),
  accounting for the curvature of the Earth
- **Multiple units** — m², sq ft, hectares, acres, gaj, are, km², sq mi
- **Indian state units** — Cent, Ground, Guntha, Bigha (UP/RJ/PB variants),
  Kanal, Marla, Katha (WB/Bihar), Decimal, with per-acre cross-check hints
- **Distance tool** — trace fence/road/boundary length with the same
  tap-to-point mechanic
- **Multiple fields** — draw and track several polygons at once, with a
  running total area and perimeter
- **Persistence** — your work is saved on this device (localStorage) and
  restored on reload; quota/blocked storage warns instead of silently
  losing data (schema-versioned, backward compatible)
- **Export** — per-field or bulk GeoJSON and KML (with color styling), plus
  PDF reports with map screenshots and a full metrics table (single-field
  PDFs contain only that plot — nothing leaks)
- **Share** — per-field offline hash links (copy, WhatsApp, or native share)
- **Import** — drag-and-drop GeoJSON/KML with validation and append/replace
- **Languages** — English (default) and हिन्दी, switchable from the ☰ menu
  (mobile) or the 🌐 map button (desktop); reports print in the active
  language (Devanagari embedded in PDFs)
- **GPS location** — center the map on your current position with one tap
- **Offline + dark mode** — service-worker app shell with tile cache;
  light/dark/auto theme
- **Mobile-first responsive UI** — bottom-sheet panel on phones, side panel
  on desktop

## Tech stack

- [Leaflet](https://leafletjs.com/) — interactive map rendering
- [leaflet-geoman](https://www.geoman.io/) — drawing and editing tools
- [Turf.js](https://turfjs.org/) — accurate geodesic area calculation
- [jsPDF](https://github.com/parallax/jsPDF) + [html2canvas](https://html2canvas.hertzen.com/) — PDF export
- [Noto Sans Devanagari](https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari) (OFL) — Hindi PDF text
- Vanilla JavaScript — no framework, no build step

## Running locally

This is a static site. You can either:

1. **Open `index.html` directly** in a modern browser.
   - Geolocation requires HTTPS or `localhost`. `file://` will work for
     everything except GPS.

2. **Serve with a tiny local server** (recommended):
   ```bash
   # Python 3
   python -m http.server 8080

   # Node
   npx serve .
   ```
   Then open <http://localhost:8080>.

   Smoke tests (`npm test`, `npm run test:*`) expect the app at
   `http://localhost:8765/` — start it first with `npm run serve`.

## Testing

```bash
npm run test:math    # pure-logic suite: units, geometry, storage, utils (no browser)
npm run test:i18n    # i18n fallback chain + dictionary audits (key & placeholder parity)
npm run test:unit    # audited lateral chain: lint + math + i18n (runs in CI)
npm run lint         # ESLint over js/
npm test             # full chain incl. headless-Edge smoke tests (needs :8765)
```

Isolated test lanes (never production): `npm run serve:test` (:8766),
Amplify branch previews, `your-farmmeasure-staging` bucket.
See [TESTING.md](./TESTING.md) for tiers + audit trail.
See [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) before every release.

## Project layout

```
farmmeasure/
├── index.html              # Entry point
├── sw.js                   # Service worker (offline shell + tile cache)
├── manifest.json           # PWA manifest
├── css/styles.css          # All styling
├── js/
│   ├── app.js              # Bootstrap + wiring
│   ├── config.js           # Configuration constants
│   ├── map.js              # Map init + tile layer
│   ├── drawing.js          # Geoman wrapper
│   ├── geolocation.js      # GPS handling
│   ├── geometry.js         # Area math (Turf)
│   ├── units.js            # Unit conversion (standard + state units)
│   ├── storage.js          # localStorage layer (quota-safe, versioned)
│   ├── ui.js               # DOM updates
│   ├── ui-state.js         # State-unit preference persistence
│   ├── i18n.js             # Language layer (English + Hindi)
│   ├── pdf.js              # PDF export (per-language fonts)
│   ├── import.js           # GeoJSON/KML import
│   ├── share.js            # Per-field hash share links
│   ├── bottom-sheet.js     # Mobile bottom-sheet panel
│   ├── mobile-menu.js      # Mobile tools menu
│   ├── reporter.js         # Report contact-details prompt (memory-only)
│   ├── secrets.js          # LOCAL ONLY MapTiler key (gitignored, never deploy)
│   ├── secrets.example.js  # Template for secrets.js
│   └── utils.js            # Small helpers
├── lang/                   # Translation dictionaries (en.json, hi.json)
├── fonts/                  # Noto Sans Devanagari TTFs for Hindi PDFs (OFL)
├── proof_read/             # Sample PDFs per language for native-speaker review
├── scripts/                # Headless smoke tests + Node test suites
├── vendor/                 # All JS/CSS libs (no CDN, no SRI needed)
├── assets/                 # Static assets
├── eslint.config.js        # Lint config (`npm run lint`)
├── package.json            # Scripts + devDependencies
├── amplify.yml             # Amplify hosting + per-env MapTiler injection
├── .env.example            # Template (copy to .env, gitignored, never deploy)
├── .github/workflows/test.yml  # CI: lint + math + i18n on push/PR (audit trail)
├── TESTING.md              # Isolated test tiers (local unit / :8766 / staging)
├── RELEASE_CHECKLIST.md    # Pre-release steps
├── README.md
├── LICENSE                 # MIT
└── DEPLOYMENT.md           # AWS hosting guide
```

## Languages

- English is the default and the fallback for any missing string — the UI
  can never render a raw translation key.
- Hindi (हिन्दी) is fully wired: UI, dialogs, toasts, PDFs, and unit
  descriptions.
- Other languages will be adding soon (Telugu, Tamil, Marathi, Malayalam). 

## Privacy

- All computations happen in your browser.
- Field data is stored in `localStorage` on your device only.
- The only routine network requests are map tiles from OpenStreetMap and
  MapTiler (the active provider; receives the viewed map area and your IP,
  as with any tile server). No field data is uploaded.
- Optional sharing opens WhatsApp (`wa.me`) with a link you choose to send.
- Report contact details you type are embedded only in that file — never stored.
- Language choice is stored on your device only.
- No analytics, no tracking, no telemetry.

## License

MIT — see [LICENSE](./LICENSE).
