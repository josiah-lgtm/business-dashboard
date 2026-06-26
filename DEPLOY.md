# Deploying to businessdashboard.agencyadvanta.com

## Build

```bash
npm install      # first time / on a fresh machine
npm run build    # type-checks, then outputs static files to dist/
```

Everything to publish is in **`dist/`** (an `index.html` + hashed files under `dist/assets/`).

## Hosting requirements

This is a static single-page app. Any static host works (Nginx, Cloudflare Pages,
Netlify, Vercel, S3+CloudFront, a plain web server, etc.). It needs only:

1. Serve `dist/` at the **root** of `https://businessdashboard.agencyadvanta.com/`.
2. Serve over **HTTPS** (the cloud-sync endpoint is HTTPS; mixed content would be blocked).
3. **No SPA rewrite rules are required.** The app uses hash-based routing
   (`/#/overview`, `/#/finance`, …), so the server only ever serves `/` and the
   browser handles the rest. Deep links and refreshes work with no extra config.

`vite.config.ts` sets `base: '/'`. If you ever host under a sub-path (e.g.
`…/dashboard/`), change `base` to match and rebuild.

### Example: Nginx
```nginx
server {
    server_name businessdashboard.agencyadvanta.com;
    root /var/www/business-dashboard/dist;
    index index.html;
    location / { try_files $uri /index.html; }   # optional; hash routing doesn't need it
}
```

## Data & cloud sync

- **Local data works everywhere, immediately.** State is stored in the browser
  (`localStorage`, key `businessDashboard_v2`) and is byte-compatible with the old
  single-file app, so existing data on a device keeps working.
- **Cross-device cloud sync is OPT-IN** (off by default — enable it in
  Settings → Cloud sync). It mirrors state to
  `https://tracker.agencyadvanta.com/api/external/kv`.

### ⚠️ Cloud-sync CORS (the one thing to check before relying on sync)

`businessdashboard.agencyadvanta.com` and `tracker.agencyadvanta.com` are **different
origins**, so the browser will send a CORS preflight for the sync calls. As of this
writing the team-tracker KV endpoint does **not** return an `Access-Control-Allow-Origin`
that grants the new subdomain, so browser cloud-sync from this domain will be blocked
(the app stays fully usable — it just shows "Offline (local only)" and keeps data in
localStorage).

To enable cross-device sync from this domain, do **one** of:

- **(Recommended) Allow the origin on the team-tracker server.** Have
  `/api/external/kv` respond to GET/POST/OPTIONS with:
  ```
  Access-Control-Allow-Origin: https://businessdashboard.agencyadvanta.com
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type
  ```
  (Echo the request `Origin` if you keep an allowlist.)
- **Or reverse-proxy the API through this domain** so the browser calls a same-origin
  path (no CORS). e.g. proxy `https://businessdashboard.agencyadvanta.com/kv/*` →
  `https://tracker.agencyadvanta.com/api/external/kv/*`, then set the endpoint URL in
  Settings → Cloud sync to `/kv`.
- **Or serve the dashboard same-origin with the tracker** (e.g. a path on
  `tracker.agencyadvanta.com`) as the old app likely was.
