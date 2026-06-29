# Deploying business-dashboard

The app now ships as **three Docker containers** orchestrated by Compose:


## SERVER 4

cd /opt/business-dashboard && git pull && docker compose up -d --build


| Service | What it is | Port (loopback) |
|---------|-----------|-----------------|
| `web`   | nginx serving the built Vue SPA **and** reverse-proxying `/api/*` to the api (injecting the API token server-side) | `WEB_PORT` (default 54331) |
| `api`   | Fastify + Prisma backend (the sync + reporting API) | `API_PORT` (default 54330) |
| `db`    | PostgreSQL 16 (the system of record) | `DB_PORT` (default 54329) |

The SPA stores data in `localStorage` (offline cache) and syncs to the `api`,
which persists everything to Postgres in a **full relational schema** and is the
authoritative multi-user merge point.

## Quick start

```bash
cp .env.example .env          # then fill in secrets (see below)
docker compose up -d --build  # build images + start db, api, web
```

Open `http://localhost:54331/`. To follow logs: `docker compose logs -f api`.

### Secrets in `.env`

Only two values are real secrets — generate them with `openssl rand -hex 32`:

- `POSTGRES_PASSWORD` — the database password.
- `API_TOKEN` — the bearer the nginx proxy injects and the api enforces.

Everything prefixed `VITE_` is **baked into the SPA at build time and is public**
by design. In particular **do not** set `VITE_API_TOKEN` in production — the proxy
injects the token so it never reaches the browser. Set `VITE_WORKSPACE_KEY` to the
single shared workspace key both teammates should land in.

> After changing any `VITE_*` value you must rebuild the web image:
> `docker compose up -d --build web`.

## Hosting (TLS / public domain)

Put a host-level reverse proxy (or Cloudflare Tunnel) in front of the `web`
container to terminate HTTPS and forward to `127.0.0.1:54331`:

```nginx
server {
    server_name businessdashboard.agencyadvanta.com;
    location / { proxy_pass http://127.0.0.1:54331; proxy_set_header Host $host; }
    # ... certbot/Cloudflare TLS ...
}
```

Two nginx layers exist: the **container** nginx (serves the SPA + `/api` proxy)
and the **host** nginx (TLS + forward to `:54331`). The SPA must be served over
**HTTPS** in production; because the SPA calls same-origin `/api`, those calls
inherit the page's scheme, so there is no mixed-content risk.

## Data & cloud sync

- **Sync is ON by default** into the workspace named by `VITE_WORKSPACE_KEY`.
  Settings → Cloud sync lets a user turn it off (local-only) or change the key.
- **No CORS.** The browser only ever calls same-origin `/api/external/kv/<key>`;
  the container nginx proxies it to the api and adds the `Authorization` header.
  (The old cross-origin `tracker.agencyadvanta.com` setup — and its CORS
  headaches — is retired.)

### Reporting / SQL access

The relational schema is queryable directly in Postgres, e.g.:

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select month, sum(amount) from expenses where workspace_id='<key>' and deleted_at is null group by 1 order by 1;"
```

The api also exposes read-only JSON endpoints (key-scoped, password never
returned): `/api/reports/<key>/{expenses,invoices,team,months,pnl}`.

## Migrating existing data onto the new backend

No data is lost. Three paths (do **1** to seed, then **2** converges browsers):

1. **Seed from the old team-tracker KV (run once):**
   ```bash
   cd api && npm install
   OLD_KEY=<old-workspace-key> NEW_KEY=$VITE_WORKSPACE_KEY \
   NEW_KV_URL=http://localhost:54330/external/kv API_TOKEN=$API_TOKEN \
   npx tsx scripts/migrate-from-tracker.ts
   ```
2. **Natural convergence:** each user opens the app once. Their browser pushes
   its `localStorage` state; the server decomposes it into tables and union-merges
   with everyone else's. (The cutover migration in the store auto-repoints anyone
   still configured for the old endpoint.)
3. **Fallback:** Settings → Export JSON on one device, Import (Merge) on another.

> Before cutover, have each user **Export JSON** as a backup.

## Database backups & care

```bash
# Backup
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

The Postgres data lives in the named volume `db_data`; it survives
`docker compose down`. **`docker compose down -v` destroys it — never run that in
production.** The api also writes a recovery `Snapshot` (full blob, passwords
stripped) on every change and keeps the latest 100.

## Local development

- **Full stack:** `docker compose up --build` (closest to prod; same-origin, token
  injected).
- **Fast SPA iteration:** `npm run dev` (Vite on :5173). `vite.config.ts` proxies
  `/api` to the `web` container (`:54331`), so dev is same-origin and needs no
  token. (Adjust the proxy target if you changed `WEB_PORT`.)
- **API only:** `cd api && npm install && npm run dev` (needs a `DATABASE_URL`
  and, if hitting it directly, an `Authorization: Bearer $API_TOKEN`).

### Windows host notes
Docker Desktop + WSL2. The `db_data` named volume lives in the WSL2 VM (good
Postgres perf, no NTFS permission issues). `.gitattributes` forces LF on `*.sh`
so the container entrypoint shebang works. Published ports are bound to
`127.0.0.1`, reachable from the Windows browser.
