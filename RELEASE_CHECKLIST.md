# Release checklist

Run this before every release. It takes ~5 minutes and catches the two
classes of bugs that hurt most: silently wrong measurements, and lost data.

## 1. Bump version

- `package.json` → `version`
- `js/config.js` → `version` (shown in PDF footer + licensing)

## 2. Run the test suite

```bash
npm run test:math        # pure logic: units, geometry, storage, utils (no browser)
npm run test             # full suite incl. browser smoke tests (needs `npm run serve` on :8765)
```

`test:math` must pass 100%. If a test fails, **do not release** — the area
math or storage layer is broken.

## 3. Manual smoke (30 seconds, phone-sized viewport)

- [ ] Draw a polygon → area appears, totals update
- [ ] Reload page → fields restore
- [ ] Switch unit (ha ↔ ac ↔ cent) → numbers convert
- [ ] Export GeoJSON → file downloads, re-import works
- [ ] Export PDF → opens, numbers match the panel
- [ ] Clear all → confirm dialog → fields gone

## 4. Storage-failure path (only when storage.js changed)

- [ ] DevTools → Application → Local Storage → fill quota (or use private mode)
- [ ] Draw a field → warning toast appears, app keeps working
- [ ] Export GeoJSON still works (the escape hatch)

## 5. Ship

- [ ] Commit with version in message: `release: v1.1.0`
- [ ] Tag: `git tag v1.1.0`
- [ ] Deploy the static folder (no build step)

## 6. Key rotation (at ship — after active dev, before public launch)

- [ ] Rotate EVERY MapTiler key in the MapTiler dashboard (dev key included)
- [ ] Issue separate prod + staging tokens, each referrer-locked to its domain
- [ ] Update `MAPTILER_KEY` in Amplify env vars (prod + preview) and local `.env`
- [ ] Delete/revoke the old shared interim key
- [ ] Reload prod + staging, confirm tiles load and no `__MAPTILER_KEY__` remains
