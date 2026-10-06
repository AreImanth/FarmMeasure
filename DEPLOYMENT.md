# Deploying to AWS

This project is a 100% static site. Two recommended paths:

## Option A — S3 + CloudFront (cheapest, most control)

1. **Create an S3 bucket**
   ```bash
   aws s3 mb s3://your-farmmeasure-bucket --region us-east-1
   ```
   Bucket name must match your domain (or be unique if you don't have a domain).

2. **Keep "Block public access" ON for the bucket** (all four settings enabled).
   The bucket stays private — CloudFront reads it via Origin Access Control (OAC)
   using the bucket policy from step 5. Never make the bucket public.

3. **Upload the site**
   ```bash
   aws s3 sync . s3://your-farmmeasure-bucket \
     --exclude "node_modules/*" \
     --exclude ".git/*" \
     --exclude "DEPLOYMENT.md" \
     --exclude "README.md" \
     --exclude ".gitignore" \
     --exclude "LICENSE" \
     --exclude "package.json" \
     --exclude "package-lock.json" \
     --exclude "eslint.config.js" \
      --exclude ".github/*" \
      --exclude "TESTING.md" \
      --exclude "RELEASE_CHECKLIST.md" \
      --exclude "amplify.yml" \
      --exclude ".env" \
      --exclude ".env.*" \
     --exclude "scripts/*" \
     --exclude "test-downloads/*" \
      --exclude "test-results/*" \
      --exclude "test-logs/*" \
      --exclude "coverage/*" \
      --exclude ".cache/*" \
     --exclude "smoke-*.png" \
     --exclude "js/secrets.js" \
     --delete \
     --cache-control "public, max-age=300"
   ```

   > **Never upload `js/secrets.js`** — it holds your local MapTiler key
   > (gitignored). Production uses the `__MAPTILER_KEY__` placeholder in
   > `js/config.js`, replaced at build time (see Environment variables below).

4. **Create a CloudFront distribution**
   - Origin domain: your S3 bucket
   - Origin access: **Origin Access Control (OAC)** — recommended
   - Viewer protocol policy: **Redirect HTTP to HTTPS**
   - Default root object: `index.html`
   - Price class: use US/Canada/EU unless you have global users

5. **Update the S3 bucket policy** that CloudFront gives you (it shows the JSON).

6. **(Optional) Custom domain via Route 53**
   - Create an A record (alias) to the CloudFront distribution
   - Request a certificate in ACM (us-east-1) and attach it to the distribution
   - Add the cert ARN in CloudFront → Settings → "Alternate domain names"

7. **Custom error response**: set `403 → /index.html` with 200 status so
   the SPA-like navigation works if you later add routing.

## Option B — AWS Amplify Hosting (easiest, fastest)

1. Push the repo to GitHub.
2. In AWS Amplify console → "Host web app" → pick the repo.
3. Amplify auto-detects it's a static site. No build command needed
   (we have no build step). Set:
   - **Build command**: leave blank (or `echo no build`)
   - **Output directory**: `.` (the repo root)
4. Amplify provisions CloudFront, ACM cert, and a `*.amplifyapp.com` URL
   automatically. You can attach a custom domain in the console.
5. Every push to `main` triggers a redeploy.

## Environment variables (MapTiler API key)

The MapTiler key is baked in at deploy time — never committed:
- **DO NOT** commit it to the repo.
- Add it to `.env` locally (gitignored). Copy `.env.example` first.
- INTERIM (active dev): one shared key for local + staging + prod.
  At ship, ROTATE every key and switch to per-environment tokens, each
  referrer-restricted to its own domain in the MapTiler dashboard
  (see RELEASE_CHECKLIST.md §6).
- Use a small build step to inline it into `config.js` at deploy time,
  OR inject it via a `window.__MAPTILER_KEY__` global before the app loads
  (Amplify supports environment variables + build overrides; CloudFront +
  Lambda@Edge can rewrite a placeholder in `config.js`).

A safe pattern for Amplify:

```yaml
# amplify.yml in repo root
version: 1
frontend:
  phases:
    build:
      commands:
        - sed -i "s/__MAPTILER_KEY__/${MAPTILER_KEY}/g" js/config.js
  artifacts:
    baseDirectory: /
    files:
      - '**/*'
```

Then add `MAPTILER_KEY` as an environment variable in the Amplify console.

## Staging (isolated test environment — never touches production)

Production stays exactly as above. Staging is a parallel lane:

- **Amplify (recommended):** push any non-`main` branch — Amplify branch
  previews issue an isolated `*.amplifyapp.com` URL per branch/PR
  (`amplify.yml` injects that environment's own `MAPTILER_KEY` and fails
  the build if it is missing). Different origin ⇒ different localStorage,
  service-worker cache, and tile cache from prod. Test laterally here,
  merge to `main` only when `RELEASE_CHECKLIST.md` is green.
- **S3 analogue:** create `your-farmmeasure-staging` bucket + own
  CloudFront distribution, then sync with the SAME excludes as prod
  (plus `.env*`, `test-results/`, `test-logs/`, `coverage/`, `.cache/`).
  INTERIM: same key as prod (usage is well within free tier, ~1000 req/mo
  shared). At ship, rotate per RELEASE_CHECKLIST.md §6 — never copy a
  staging build to the prod bucket; always deploy prod from `main`.

## Cost expectations

- S3 storage: pennies per month for a static site
- CloudFront: free tier covers 1 TB egress/month, then ~$0.085/GB
- Route 53: ~$0.50/month per hosted zone
- ACM cert: free
- Amplify: free tier covers 5 GB storage + 15 GB served/month, then pay-as-you-go

For a personal/internal tool, expect **<$1/month** total.

## Monitoring (optional)

- CloudFront access logs → S3
- CloudWatch alarms on 5xx rate
- S3 bucket metrics for request count

You almost certainly don't need any of this for Phase 1.
