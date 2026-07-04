// ============================================================
// CONTENT-DEDUPE for a workspace — removes duplicated historical rows.
//
// WHY: before 2026-07-04 every fresh browser seeded backfill.json with its own
// random uids and pushed them, and the server merge unions purely by id — so
// the shared workspace accumulated one copy of ~240 historical rows PER DEVICE
// (observed: 1210 expenses where only 239 are unique). The SPA no longer seeds
// backfill in team builds, but the copies already in the DB stay until removed.
//
// WHAT IT DOES: GETs the workspace, groups the four backfill-seeded collections
// by the SAME content keys the SPA's "Import & merge" dedupe uses —
//   expenses  vendor|amount|date-or-month
//   refunds   recipient|amount|date-or-month
//   vendors   name|category
//   team      name|role
// — keeps the RICHEST copy of each group (most filled-in fields, e.g. the team
// row that has pay/bank/email set), and TOMBSTONES the rest (State.deletions),
// then POSTs through the normal /external/kv/:key merge. Tombstones propagate:
// every browser drops its local copies on next pull. Re-running is a no-op.
//
// It ALWAYS previews first; pass DRY_RUN=1 to stop after the preview.
//
// ---- Against PROD from a laptop (nginx injects the bearer, pass NO token) ----
//   cd api && npm install
//   NEW_KV_URL=https://businessdashboard.agencyadvanta.com/api/external/kv \
//   NEW_KEY=bd-agencyadvanta-shared \
//   DRY_RUN=1 npm run dedupe        # preview; drop DRY_RUN to actually clean
//
// ---- On the server (against the api directly) --------------------------------
//   NEW_KV_URL=http://localhost:54330/external/kv  API_TOKEN=$API_TOKEN  ...
//
// Env (same names as seed.ts):
//   NEW_KV_URL  http://localhost:54330/external/kv
//   NEW_KEY     (required) workspace key to clean
//   API_TOKEN   bearer for the api directly (OMIT when going through prod nginx)
//   DRY_RUN     "1"/"true" -> preview only, no writes
//   BACKUP_FILE optional path; the pre-clean blob is written here first
// ============================================================
import { writeFile } from 'node:fs/promises'

const NEW_KV_URL = process.env.NEW_KV_URL || 'http://localhost:54330/external/kv'
const NEW_KEY = process.env.NEW_KEY || ''
const API_TOKEN = process.env.API_TOKEN || ''
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '')
const BACKUP_FILE = process.env.BACKUP_FILE || ''

function die(msg: string): never {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`
  return h
}

// ---- content keys: MUST match SettingsView.vue's import dedupe ----
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const amt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}
function contentKey(coll: string, e: any): string | null {
  if (!e) return null
  switch (coll) {
    case 'expenses':
      return `${norm(e.vendor)}|${amt(e.amount)}|${e.date || e.month || ''}`
    case 'refunds':
      return `${norm(e.recipient)}|${amt(e.amount)}|${e.date || e.month || ''}`
    case 'vendors':
      return `${norm(e.name)}|${norm(e.category)}`
    case 'team':
      return `${norm(e.name)}|${norm(e.role)}`
    default:
      return null
  }
}

// How "filled in" a row is — used to pick which duplicate survives, so a team
// row where someone entered pay/bank/email beats an untouched backfill copy.
function richness(e: any): number {
  let score = 0
  for (const [k, v] of Object.entries(e || {})) {
    if (k === 'id') continue
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (typeof v === 'number' && v === 0) continue
    if (typeof v === 'boolean' && !v) continue
    if (typeof v === 'object' && Object.keys(v as object).length === 0) continue
    score++
  }
  return score
}

const COLLECTIONS = ['expenses', 'refunds', 'vendors', 'team'] as const

async function main() {
  if (!NEW_KEY) die('NEW_KEY is required (the workspace key to clean)')
  const url = `${NEW_KV_URL}/${encodeURIComponent(NEW_KEY)}`

  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) die(`GET ${url} -> HTTP ${res.status}`)
  const data: any = await res.json()
  const state = data?.value
  if (!state || typeof state !== 'object') die('workspace is empty — nothing to dedupe')

  if (BACKUP_FILE) {
    await writeFile(BACKUP_FILE, JSON.stringify(data), 'utf8')
    console.log(`backup written: ${BACKUP_FILE}`)
  }

  const deletions: Record<string, string> = { ...(state.deletions || {}) }
  const now = new Date().toISOString()
  let totalRemoved = 0

  for (const coll of COLLECTIONS) {
    const arr: any[] = Array.isArray(state[coll]) ? state[coll] : []
    // group row indexes by content key (rows without a key/id are kept as-is)
    const groups = new Map<string, number[]>()
    arr.forEach((row, i) => {
      const k = row && row.id != null ? contentKey(coll, row) : null
      if (!k) return
      const g = groups.get(k)
      if (g) g.push(i)
      else groups.set(k, [i])
    })

    const drop = new Set<number>()
    let dupGroups = 0
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue
      dupGroups++
      // survivor = richest copy; ties -> the earliest row (stable order)
      let keep = idxs[0]
      for (const i of idxs) if (richness(arr[i]) > richness(arr[keep])) keep = i
      for (const i of idxs) {
        if (i === keep) continue
        drop.add(i)
        deletions[`${coll}:${arr[i].id}`] = now
      }
    }

    const kept = arr.filter((_, i) => !drop.has(i))
    console.log(
      `${coll}: ${arr.length} rows, ${groups.size} unique, ` +
        `${dupGroups} duplicated -> removing ${drop.size}, keeping ${kept.length}`,
    )
    totalRemoved += drop.size
    state[coll] = kept
  }

  if (!totalRemoved) {
    console.log('No duplicates found — nothing to do.')
    return
  }
  state.deletions = deletions

  const body = JSON.stringify({ value: state, updated_by: 'dedupe-script' })
  console.log(`\nTotal rows to remove: ${totalRemoved} (payload ${(body.length / 1024).toFixed(0)} KB)`)
  if (DRY_RUN) {
    console.log('DRY_RUN — no writes performed.')
    return
  }

  const post = await fetch(url, { method: 'POST', headers: authHeaders(), body })
  if (!post.ok) die(`POST ${url} -> HTTP ${post.status}: ${await post.text().catch(() => '')}`)

  // verify: re-read and report the counts the team will now see
  const after: any = await (await fetch(url, { headers: authHeaders() })).json()
  console.log('\nDone. Workspace now has:')
  for (const coll of COLLECTIONS) {
    const n = Array.isArray(after?.value?.[coll]) ? after.value[coll].length : 0
    console.log(`  ${coll}: ${n} rows`)
  }
}

main().catch((e) => die(e?.stack || String(e)))
