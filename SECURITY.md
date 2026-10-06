# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainer directly or use GitHub's private vulnerability reporting.
3. Include steps to reproduce and potential impact.

## Secret Management

- The MapTiler API key is injected at build time via environment variables.
- Never commit real API keys, tokens, or credentials.
- The pre-commit hook blocks common secret patterns.
- Rotate keys immediately if they are ever exposed.

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `MAPTILER_KEY` | MapTiler API key for map tiles | Yes (production) |
| `STAGING_BUCKET` | S3 bucket for staging deploys | Staging only |
| `STAGING_REGION` | AWS region for staging | Staging only |
