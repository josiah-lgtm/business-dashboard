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

> **Immutable after first deploy — never change these on a live server.** They
> are fixed when the `db_data` volume is first created / the SPA is first built;
> changing them later makes existing data *appear* to vanish (it stays safe in
> the volume, but the app now points elsewhere):
> - `VITE_WORKSPACE_KEY` — the workspace id every Postgres row is scoped to.
> - `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` — honored only at the
>   database's first init; Postgres ignores later changes, so the api would then
>   connect/authenticate against a DB/credentials that no longer match.
>
> Only `API_TOKEN` is safe to rotate freely (rebuild `web` + restart `api`).

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

> **Live updates through the host proxy.** The SSE stream sends `X-Accel-Buffering:
> no` and heartbeats every 25s, so it works through most proxies unchanged. If
> live updates ever stall behind your host nginx, add a dedicated location for the
> events path with `proxy_buffering off;` and `proxy_read_timeout 3600s;` (the
> container nginx already does this). Cloudflare Tunnel passes SSE through as-is.

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
- **Live updates (SSE).** Each browser also opens an `EventSource` on
  `/api/external/kv/<key>/events`; when any teammate's change is committed, the
  api pushes a notification and that browser pulls immediately (no 30s wait).
  The 30s poll remains as a fallback if the stream can't connect. This is
  in-process fan-out — fine for the single `api` container; if the api is ever
  scaled to multiple replicas, switch `api/src/events.ts` to Postgres
  `LISTEN/NOTIFY` so a change on one replica reaches subscribers on another.

### Reporting / SQL access

The relational schema is queryable directly in Postgres, e.g.:

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select month, sum(amount) from expenses where workspace_id='<key>' and deleted_at is null group by 1 order by 1;"
```

The api also exposes read-only JSON endpoints (key-scoped, password never
returned): `/api/reports/<key>/{expenses,invoices,team,months,pnl}`.

## MCP connector (Claude + ChatGPT)

The api also serves a **remote MCP server** at `https://businessdashboard.agencyadvanta.com/mcp`
— 92 tools over the whole workspace (P&L and analytics, expenses, vendors,
revenue, refunds, team, payouts, invoices in both directions, tasks, budgets,
buckets, settings, read-only SQL, snapshots/recovery) plus 3 MCP resources and 4
prompts. Code lives in `api/src/mcp/`; no extra container. It adds four tables
(`mcp_oauth_clients`, `mcp_auth_codes`, `mcp_tokens`, `mcp_audit_log`) via the
committed migration `20260722000000_mcp_oauth`, applied by the normal
`prisma migrate deploy` at boot — no existing table is touched.

### Turning it on

1. Put **one secret** in `.env` and pick the public origin:

   ```bash
   openssl rand -hex 32           # -> MCP_SECRET_KEY
   ```

   ```ini
   MCP_SECRET_KEY=<the 64-hex value>
   MCP_PUBLIC_URL=https://businessdashboard.agencyadvanta.com   # origin root, no path
   ```

   With `MCP_SECRET_KEY` empty the connector is **not mounted at all** — `/mcp`
   404s. That is the intended off switch.

2. `docker compose up -d --build` (the api needs the rebuild; the `web` image
   needs it too, for the new nginx locations).

Check it: `curl https://businessdashboard.agencyadvanta.com/.well-known/oauth-protected-resource/mcp`
should return JSON naming the resource, and `/mcp-info` renders a short human
page with the URL to paste into a client.

### Connecting a client

| Client | How |
|---|---|
| **Claude** (web/desktop) | Settings → Connectors → *Add custom connector* → paste `https://businessdashboard.agencyadvanta.com/mcp` → a login page appears → paste the access key. |
| **ChatGPT** | Settings → Connectors (or a Developer-mode / Deep-Research custom connector) → same URL → same key. The `search` + `fetch` tools required by ChatGPT are implemented. |
| **Claude Code** | `claude mcp add --transport http business-dashboard https://businessdashboard.agencyadvanta.com/mcp --header "Authorization: Bearer $MCP_SECRET_KEY"` |
| **MCP Inspector / curl** | Same static bearer, or run the full OAuth flow. |

The OAuth side is a complete authorization server: RFC 7591 dynamic client
registration, authorization-code with **mandatory PKCE S256**, single-use codes,
rotating refresh tokens with family revocation on reuse, RFC 7009 revocation,
and RFC 8414/9728 discovery. Everything it stores is a sha-256 hash — a database
dump yields no live token. The "user database" is the single `MCP_SECRET_KEY`,
which is what the login page checks (brute-force locked out per IP).

### What it can do to your data

Writes go through **the same advisory-locked union merge a browser save uses**
(`mutateState` in `api/src/store.ts`), then push the same SSE nudge, so an edit
made from Claude appears in both teammates' open tabs within a second or two and
can never clobber a concurrent browser edit. Every changed write also takes a
recovery snapshot (`reason='mcp'`) and an audit row in `mcp_audit_log`
(`list_mcp_activity` reads it back).

Guard rails, in the order you'd reach for them:

- `MCP_ALLOW_WRITES=0` — read-only connector; the write tools vanish from
  `tools/list` entirely rather than failing when called.
- `MCP_ALLOW_SQL=0` — hides `query_sql` / `list_tables` / `describe_table`.
- `MCP_ALLOW_STATIC_TOKEN=0` — forces every client through OAuth (no raw-key bearer).
- Destructive tools require `confirm:true`; bulk ones (`recategorize_expenses`,
  `restore_snapshot`) preview unless you pass `apply:true`.
- Team-member **portal passwords are never returned by any tool**, including
  through `query_sql` — results are walked and password-ish keys redacted, which
  also covers the `raw` jsonb column.

### Rotating the key

Change `MCP_SECRET_KEY` in `.env` and `docker compose up -d api`. Existing OAuth
tokens keep working (they are independent of the key); to cut them too:

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "update mcp_tokens set revoked = true where not revoked;"
```

### If a client can't connect

- **401 loop** — `MCP_PUBLIC_URL` must match the public hostname byte for byte.
  Tokens carry it as their audience; a mismatch is rejected.
- **"unauthorized" from the sync API instead of an OAuth challenge** — the host
  nginx is routing `/mcp` into the `/api/` location, which injects `API_TOKEN`
  and overwrites the caller's bearer. The container nginx has dedicated
  `/mcp`, `/mcp-oauth/`, `/mcp-info` and `/.well-known/` locations that must not
  set `Authorization`.
- **406 Not Acceptable** — a client sending only `Accept: application/json`. The
  connector already rewrites that header; if you see it, the request never
  reached the api.

## Migrating existing data onto the new backend

No data is lost. The new DB starts **empty** — nothing auto-seeds at deploy — so
pick a seed path below, then let browsers converge.

> The recent + non-financial data (tasks, invoices, team invoices, budgets, any
> month after the bundled `backfill.json` snapshot) lives **only in each user's
> browser `localStorage`** and/or the old tracker — there is no copy in the repo.
> So seeding pulls from one of those two sources.
>
> ⚠ **Do NOT seed the shared workspace from `backfill.json`.** Its rows have no
> ids (the SPA assigns random ones per-browser at first run) and the server
> unions by id — pushing it would duplicate every historical row against the ids
> browsers already hold. `backfill.json` is for fresh **per-browser** first-run
> seeding only. Seed the server only from **stable-id** sources (exports / tracker).

**Recommended — import each user's legacy Export JSON (`npm run import`, idempotent):**

1. Each user opens the **legacy** dashboard in the browser they actually use →
   Settings → **Export JSON** → save the file into `seed-data/`. This is the
   complete, real, stable-id snapshot of that user's data. Collect one per user
   (`seed-data/` is gitignored — it holds PII + plaintext portal passwords).
2. **Preview** the merge into prod first (writes nothing). The prod web nginx
   injects the bearer token, so target the **public URL** and pass **no** token:
   ```bash
   cd api && npm install
   SEED_DIR=../seed-data \
   NEW_KEY=bd-agencyadvanta-shared \
   NEW_KV_URL=https://businessdashboard.agencyadvanta.com/api/external/kv \
   DRY_RUN=1 npm run import
   ```
   It prints, per collection, how many rows each export **adds vs. already
   matches**, and the projected total. When it looks right, **drop `DRY_RUN=1`**
   and re-run to merge. Re-running is always safe (union by id — nothing dupes,
   nothing is removed).

   - `SEED_DIR` imports every `*.json` in the folder; or list files explicitly
     with `SEED_FILES=../seed-data/josiah.json,../seed-data/joanna.json`.
   - Add `OLD_KEY=<old-workspace-key>` to also pull the old tracker in the same run.
   - Running **on the server** instead of via the public URL? Target the api
     directly and supply the token:
     `NEW_KV_URL=http://localhost:54330/external/kv API_TOKEN=$API_TOKEN`.

**Alternative — seed from the old team-tracker KV only (run once):**
```bash
cd api && npm install
OLD_KEY=<old-workspace-key> NEW_KEY=$VITE_WORKSPACE_KEY \
NEW_KV_URL=http://localhost:54330/external/kv API_TOKEN=$API_TOKEN \
npm run migrate-from-tracker
```
> Note: the old tracker had an allow-list/CORS outage, so its server copy may be
> **stale** (some users' latest edits never synced there). Prefer the Export-JSON
> path when you can; you can run both — the merge unions them safely.

**Then — natural convergence:** each user opens the app once. Their browser pushes
its `localStorage` state; the server decomposes it into tables and union-merges
with everyone else's. (The cutover migration in the store auto-repoints anyone
still configured for the old endpoint.)

**Fallback (no script):** Settings → Export JSON on one device, Import (**Merge**)
on another.

> Before cutover, have each user **Export JSON** as a backup.

## Cleaning duplicated history (`npm run dedupe`)

Before 2026-07-04 every fresh browser seeded `backfill.json` with its own random
ids and pushed them, so the shared workspace accumulated one copy of the
historical rows **per device**. The SPA no longer seeds backfill in team builds
(it starts empty and pulls from the server), but copies already in the DB stay
until removed:

```bash
cd api && npm install
NEW_KV_URL=https://businessdashboard.agencyadvanta.com/api/external/kv \
NEW_KEY=bd-agencyadvanta-shared \
BACKUP_FILE=../seed-data/backup-before-dedupe.json \
DRY_RUN=1 npm run dedupe        # preview; drop DRY_RUN to actually clean
```

It groups expenses/refunds/vendors/team by the same content keys the SPA's
"Import & merge" uses, keeps the richest copy of each duplicate group (e.g. the
team row with pay/bank details filled in), and **tombstones** the rest — so every
browser drops its local copies on the next pull. Idempotent; re-running is a no-op.

## Schema changes (data-safe migrations)

The database is the system of record, so a deploy **must never** let the schema
"auto-reconcile" against live data. The api uses committed Prisma migrations only:

- On every api start, `api/docker-entrypoint.sh` runs `prisma migrate deploy`
  (forward-only — applies committed migration SQL in order, never drops data,
  never resets, needs no TTY). With no new migrations it is a **no-op**, so a
  routine `git pull && docker compose up -d --build` cannot change your data.
- The destructive `prisma db push` is **disabled**. It runs only for a brand-new
  empty database when you explicitly opt in with `INIT_DB_PUSH=1`, and never with
  `--accept-data-loss`.
- Your existing production DB (originally created with `db push`) is
  **auto-baselined** on the next deploy by `api/scripts/db-baseline.mjs`: it marks
  the initial migration (`0_init`) as already-applied — Prisma bookkeeping only,
  **no SQL is executed against your tables**. No manual step is required.

**To change the schema later:** edit `api/prisma/schema.prisma`, then locally run
`cd api && npx prisma migrate dev --name <what_changed>` against a scratch DB to
generate `api/prisma/migrations/<ts>_<name>/`. **Review the generated SQL** for any
`DROP` / `ALTER ... DROP` / type-narrowing / `SET NOT NULL` (these can lose data),
**commit** the migration, then deploy — `migrate deploy` applies exactly that
reviewed SQL. Take a `pg_dump` (below) first when a migration is destructive.

> ⚠ `deploy/publish.sh` (the old host-nginx `/var/www` path) is **deprecated and
> refuses to run** — its nginx config has no `/api` proxy, so publishing through
> it silently breaks cloud sync. Always deploy with `docker compose up -d --build`.

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
