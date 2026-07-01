// ============================================================
// One-shot, idempotent migration baseline — run by docker-entrypoint.sh before
// `prisma migrate deploy`, on EVERY api start. Its whole job is data safety:
// the production database was originally created by the old `prisma db push`
// path, so it has our tables but NO Prisma migration history. If we ran
// `migrate deploy` against it directly, Prisma would try to apply 0_init's
// CREATE TABLE statements and fail (P3005 "schema is not empty") -> boot loop.
//
// This script detects exactly that situation (our schema exists, but Prisma's
// _prisma_migrations bookkeeping table does not) and marks the INITIAL
// migration as already-applied — WITHOUT executing any of its SQL. It never
// touches, drops, or rewrites a single row of real data; it only writes to
// Prisma's own bookkeeping table.
//
// Decision matrix:
//   history table present            -> already managed, do nothing
//   no history + our schema present  -> pre-existing DB, baseline 0_init as applied
//   no history + no schema           -> fresh DB, do nothing (deploy will create it)
// ============================================================
import { PrismaClient } from '@prisma/client'
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const prisma = new PrismaClient()

try {
  const [{ has_history }] = await prisma.$queryRaw`
    SELECT (to_regclass('public._prisma_migrations') IS NOT NULL) AS has_history`
  const [{ has_schema }] = await prisma.$queryRaw`
    SELECT (to_regclass('public.workspaces') IS NOT NULL) AS has_schema`

  if (has_history) {
    console.log('[db-baseline] migration history present -> no baseline needed')
  } else if (!has_schema) {
    console.log('[db-baseline] fresh database -> migrate deploy will create the schema')
  } else {
    // Pre-existing DB created by the old db-push path. Baseline the FIRST
    // migration only (it is the full-schema snapshot that matches this DB);
    // any later migrations must still run normally via migrate deploy.
    const first = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()[0]
    if (!first) {
      console.log('[db-baseline] no migration directories found; nothing to baseline')
    } else {
      console.log(
        `[db-baseline] existing schema without migration history -> marking ${first} as already applied (no SQL executed)`,
      )
      execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', first], { stdio: 'inherit' })
    }
  }
} finally {
  await prisma.$disconnect()
}
