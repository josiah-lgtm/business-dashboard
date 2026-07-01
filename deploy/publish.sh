#!/usr/bin/env bash
# ⚠ DEPRECATED / UNSAFE — superseded by the dockerized deploy.
# This host-nginx static path publishes the SPA to /var/www, but its companion
# config deploy/businessdashboard.nginx.conf has NO `location /api/` proxy, so
# cloud sync silently fails on this path: new edits stay stranded in a single
# browser and shared data appears "missing" across devices. Use the dockerized
# deploy instead:  git pull && docker compose up -d --build   (see DEPLOY.md).
set -euo pipefail

if [ "${I_KNOW_PUBLISH_SH_IS_DEPRECATED:-}" != "1" ]; then
  echo "✋ deploy/publish.sh is deprecated and unsafe (its nginx config has no /api proxy → breaks sync)." >&2
  echo "   Use the dockerized deploy instead:" >&2
  echo "       git pull && docker compose up -d --build" >&2
  echo "   To override anyway, first add a working 'location /api/' proxy to" >&2
  echo "   deploy/businessdashboard.nginx.conf, then re-run with:" >&2
  echo "       I_KNOW_PUBLISH_SH_IS_DEPRECATED=1 bash deploy/publish.sh" >&2
  exit 1
fi

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
