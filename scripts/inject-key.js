#!/usr/bin/env node
/**
 * inject-key.js — build-time MapTiler key injection.
 *
 * Works identically on AWS Amplify and Cloudflare Pages:
 *   MAPTILER_KEY=<key> npm run build
 *
 * Reads process.env.MAPTILER_KEY and replaces every __MAPTILER_KEY__
 * placeholder in js/config.js. Fails fast if the variable is missing
 * so we never ship placeholder tiles.
 *
 * Local dev does NOT use this script — it uses js/secrets.js (gitignored)
 * generated via `npm run key:local` from your .env file.
 */
const fs = require('fs');
const path = require('path');

const PLACEHOLDER = '__MAPTILER_KEY__';
const CONFIG_PATH = path.join(__dirname, '..', 'js', 'config.js');

function main() {
  const key = (process.env.MAPTILER_KEY || '').trim();
  if (!key) {
    console.error('[inject-key] ERROR: MAPTILER_KEY is not set for this environment.');
    console.error('[inject-key] Set it in Cloudflare Pages (Settings > Environment variables)');
    console.error('[inject-key] or Amplify Console (Hosting > Environment variables).');
    process.exit(1);
  }
  if (key === PLACEHOLDER) {
    console.error('[inject-key] ERROR: MAPTILER_KEY is still the placeholder value. Set a real key.');
    process.exit(1);
  }

  let content;
  try {
    content = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    console.error(`[inject-key] ERROR: cannot read ${CONFIG_PATH}: ${err.message}`);
    process.exit(1);
  }

  const occurrences = content.split(PLACEHOLDER).length - 1;
  if (occurrences === 0) {
    console.log('[inject-key] No placeholder found — key already injected or config changed. Nothing to do.');
    return;
  }

  const injected = content.split(PLACEHOLDER).join(key);
  fs.writeFileSync(CONFIG_PATH, injected, 'utf8');
  console.log(`[inject-key] Injected MapTiler key into js/config.js (${occurrences} placeholder(s) replaced).`);

  // Verify no placeholder remains
  const verify = fs.readFileSync(CONFIG_PATH, 'utf8');
  if (verify.includes(PLACEHOLDER)) {
    console.error('[inject-key] ERROR: KEY INJECTION FAILED — placeholder still present.');
    process.exit(1);
  }
  console.log('[inject-key] Key injected OK.');
}

main();
