# Testing — FarmMeasure

Three isolated tiers. None of them writes to production.

## Tier 1 — Unit (no server, no secrets, CI-audited)

```bash
npm run test:unit     # lint + math + i18n in one audited chain
```

Runs in GitHub Actions on every push/PR (`.github/workflows/test.yml`).
Needs no MapTiler key, no browser, no network. This is the lateral-test
record: the Actions log is the audit trail.

## Tier 2 — Local browser (your machine only)

```bash
npm run serve:test    # isolated server on :8766 (dev stays on :8765)
npm run test:smoke    # point the smoke script at :8766 for a test run
```

`serve` (:8765) is daily dev. `serve:test` (:8766) is the throwaway rig so a
test run never clashes with a dev session. Data lives in that origin's own
`localStorage` (`fac:fields:v1` + `:help-seen` sidecars) — closing the tab or
`localStorage.clear()` resets it. Headless-Edge scripts need
`http://localhost:8766/` + Edge binary; they stay local on purpose.

## Tier 3 — Staging preview (shared, still not production)

- **Amplify:** every non-`main` branch gets its own `*.amplifyapp.com`
  preview URL automatically (`amplify.yml`). Origin is different from prod,
  so service-worker + tile caches + saved fields cannot leak across.
- **S3 analogue:** `aws s3 sync . s3://your-farmmeasure-staging` with a
  DIFFERENT bucket but (INTERIM) the same `MAPTILER_KEY` — rotate to
  per-environment keys at ship. Never sync staging to the prod bucket.
  See `DEPLOYMENT.md` → Staging.

## What never gets committed or deployed

Gitignored AND excluded from `aws s3 sync` (see `DEPLOYMENT.md`):
`js/secrets.js`, `.env*` (except `.env.example`), `test-downloads/`,
`test-results/`, `test-logs/`, `smoke-*.png`, `coverage/`, `.cache/`,
`__pycache__/`, `.eslintcache`. If a test writes it, git ignores it.

## Release gate

`RELEASE_CHECKLIST.md` still applies: `test:unit` must be 100% green,
plus the 30-second phone-size manual smoke on the staging preview —
never on the prod URL.
