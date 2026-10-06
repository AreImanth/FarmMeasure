# Contributing to FarmMeasure

## Security Guidelines

### Never Commit Secrets
- API keys, tokens, passwords, or credentials of any kind.
- `.env` files (only `.env.example` is allowed).
- `js/secrets.js` (gitignored — keep it that way).

### Pre-Commit Hook
This repo includes a pre-commit hook (`.git/hooks/pre-commit`) that scans staged files for:
- Hardcoded API keys and tokens
- Private keys
- `.env` files
- `secrets.js`

To enable it:
```bash
git config core.hooksPath .git/hooks
```

### If You Accidentally Commit a Secret
1. **Rotate the secret immediately** (revoke/regenerate at the provider).
2. Remove the secret from the file.
3. Force-push to rewrite history (or contact GitHub support to purge it from caches).
4. The pre-commit hook will prevent future occurrences.

## Development Setup
```bash
npm install
npm run serve        # dev server on :8765
npm run serve:test   # test server on :8766
```

## Testing
```bash
npm test             # full test suite
npm run test:smoke   # smoke tests only
```
