#!/usr/bin/env bash
# Build the dashboard and publish it to the nginx web root.
# Run from anywhere on the server (as root):  bash deploy/publish.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="/var/www/businessdashboard"

cd "$REPO_DIR"

echo "▶ Installing dependencies…"
npm ci || npm install

echo "▶ Building (type-check + vite build → dist/)…"
npm run build            # low-RAM box? swap for:  npm run build:fast  (skips the vue-tsc type-check)

echo "▶ Publishing dist/ → $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete dist/ "$WEB_ROOT/"

echo "▶ Reloading nginx…"
nginx -t && systemctl reload nginx

echo "✓ Published — https://businessdashboard.agencyadvanta.com"
