#!/bin/sh
set -e

# ============================================================
# Data-safety contract for deploys:
# Postgres is the system of record. A publish/redeploy must NEVER destructively
# reconcile the live schema. We therefore use committed, reviewed Prisma
# migrations ONLY:
#   * `prisma migrate deploy` is forward-only: it applies committed migration
#     SQL in order, never drops data, never resets, and needs no TTY. With no
#     new migrations it is a no-op — the safe common case for a routine redeploy.
#   * `db-baseline.mjs` marks the initial migration as already-applied on the
#     pre-existing production DB (built by the old db-push path) so the first
#     `migrate deploy` doesn't try to re-create existing tables. It writes only
#     Prisma bookkeeping, never real data.
#   * `prisma db push` (which can ALTER/DROP live tables to match the schema) is
#     DISABLED. It runs only if an operator explicitly opts in for a brand-new
#     empty database via INIT_DB_PUSH=1, and even then WITHOUT --accept-data-loss.
#     Never add --accept-data-loss or --force-reset here.
# ============================================================

if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] ensuring migration baseline (bookkeeping only, no data changes)..."
  node scripts/db-baseline.mjs
  echo "[entrypoint] prisma migrate deploy (forward-only)..."
  npx prisma migrate deploy
elif [ "$INIT_DB_PUSH" = "1" ]; then
  echo "[entrypoint] INIT_DB_PUSH=1 set — prisma db push for a FRESH empty DB (no --accept-data-loss)..."
  npx prisma db push --skip-generate
else
  echo "[entrypoint] FATAL: no committed migrations found in prisma/migrations." >&2
  echo "[entrypoint] Refusing to 'db push' against a possibly-populated database (would risk your data)." >&2
  echo "[entrypoint] Fix: commit prisma/migrations, OR set INIT_DB_PUSH=1 only for a brand-new empty DB." >&2
  exit 1
fi

echo "[entrypoint] starting Fastify on :${PORT:-3000}..."
exec node dist/server.js
