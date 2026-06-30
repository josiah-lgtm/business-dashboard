// ============================================================
// IDEMPOTENT import/merge for the business-dashboard backend (incl. PROD).
//
// Merges one or more STABLE-ID source blobs — a legacy "Export JSON" file
// (the app's Settings -> Export JSON) and/or the old team-tracker KV — into a
// workspace. Each source is POSTed through the SAME /external/kv/:key merge a
// browser uses, so the server unions by id inside an advisory-locked txn:
// nothing is dropped, nothing is duplicated, and re-running is a no-op.
//
// It ALWAYS previews first: it GETs the current workspace and reports, per
// collection, how many rows each source would ADD vs. already match — so you
// can see exactly what a legacy export brings before it touches prod. Pass
// DRY_RUN=1 to stop after the preview (no writes).
//
// WHY NOT backfill.json: that file has NO entity ids (the SPA assigns random
// uids per-browser at first run), and the server keys by id — pushing it to a
// SHARED workspace would duplicate every historical row. This script HARD-FAILS
// on id-less sources. A real Settings -> Export JSON from the running app has
// ids and is safe.
//
// ---- IMPORT THE LEGACY EXPORT INTO PROD (from your laptop) -------------------
//   The prod web nginx proxies /api/* to the api and injects the bearer token,
//   so target the public URL and pass NO API_TOKEN:
//
//   cd api && npm install
//   SEED_FILES=../seed-data/legacy-export.json \
//   NEW_KEY=bd-agencyadvanta-shared \
//   NEW_KV_URL=https://businessdashboard.agencyadvanta.com/api/external/kv \
//   DRY_RUN=1 npm run import        # preview; drop DRY_RUN to actually merge
//
// ---- Running ON the server (against the api directly) ------------------------
//   NEW_KV_URL=http://localhost:54330/external/kv  API_TOKEN=$API_TOKEN  ...
//
// Env (with defaults):
//   SEED_FILES  comma-separated paths to Export-JSON files            (optional)
//   SEED_DIR    a folder; every *.json inside is imported (sorted)    (optional)
//   OLD_KEY     old tracker workspace key to also pull                (optional)
//   OLD_KV_URL  https://tracker.agencyadvanta.com/api/external/kv
//   ORIGIN      https://businessdashboard.agencyadvanta.com  (allow-listed on tracker)
//   NEW_KV_URL  http://localhost:54330/external/kv
//   NEW_KEY     (required) the workspace key to merge INTO
//   API_TOKEN   bearer for the api directly (OMIT when going through prod nginx)
//   DRY_RUN     "1"/"true" -> preview only, no writes
// ============================================================
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SEED_FILES = (process.env.SEED_FILES || '').split(',').map((s) => s.trim()).filter(Boolean)
const SEED_DIR = process.env.SEED_DIR || ''
const OLD_KEY = process.env.OLD_KEY || ''
const OLD_KV_URL = process.env.OLD_KV_URL || 'https://tracker.agencyadvanta.com/api/external/kv'
const ORIGIN = process.env.ORIGIN || 'https://businessdashboard.agencyadvanta.com'
const NEW_KV_URL = process.env.NEW_KV_URL || 'http://localhost:54330/external/kv'
const NEW_KEY = process.env.NEW_KEY || ''
const API_TOKEN = process.env.API_TOKEN || ''
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '')

// Mirror of the server's POST guard (api/src/server.ts).
const MAX_VALUE_BYTES = 1_000_000

// Mirror of api/src/serialize.ts ID_COLLECTIONS (entities the server keys by id).
const ID_COLLECTIONS = [
  'expenses', 'vendors', 'refunds', 'team', 'tasks', 'invoices',
  'teamInvoices', 'revenueEntries', 'customBuckets', 'teamPayouts',
] as const

function die(msg: string): never {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`
  return h
}

/** Unwrap a tracker/GET dump ({ value: State, updated_at }) to the bare State; else pass through. */
function asState(parsed: any): any {
  if (
    parsed && typeof parsed === 'object' && parsed.value && typeof parsed.value === 'object' &&
    parsed.months === undefined && parsed.expenses === undefined
  ) {
    return parsed.value
  }
  return parsed
}

function idSet(arr: any): Set<string> {
  const s = new Set<string>()
  if (Array.isArray(arr)) for (const e of arr) if (e && e.id != null) s.add(String(e.id))
  return s
}
function monthSet(rec: any): Set<string> {
  return new Set(rec && typeof rec === 'object' ? Object.keys(rec) : [])
}

/** Validate shape, print per-collection counts, and HARD-FAIL on id-less rows. */
function inspect(label: string, state: any) {
  if (!state || typeof state !== 'object') die(`${label}: not a JSON object`)
  const counts: string[] = []
  let idless = 0
  for (const c of ID_COLLECTIONS) {
    const arr = Array.isArray(state[c]) ? state[c] : []
    if (arr.length) counts.push(`${c}=${arr.length}`)
    idless += arr.filter((e: any) => !e || e.id == null).length
  }
  const months = state.months && typeof state.months === 'object' ? Object.keys(state.months).length : 0
  if (months) counts.push(`months=${months}`)
  if (!counts.length) die(`${label}: no recognizable collections (months/expenses/...). Is this a dashboard export?`)
  console.log(`  ${label}: ${counts.join(', ')}`)
  if (idless) {
    die(
      `${label}: ${idless} entit(ies) have NO id. The server keys by id, so these would be ` +
      `dropped (and re-importing would duplicate). This looks like backfill-shaped data — refusing. ` +
      `Import a real Settings -> Export JSON (or the old tracker) instead.`,
    )
  }
}

/** Keep the blob under the server's 1MB cap; the usual culprit is an embedded logo data URI. */
function trimForSize(label: string, state: any): any {
  const bytes = JSON.stringify(state).length
  if (bytes <= MAX_VALUE_BYTES) return state
  if (state?.business?.logoDataUrl) {
    const clone = { ...state, business: { ...state.business, logoDataUrl: '' } }
    const nb = JSON.stringify(clone).length
    console.warn(`  ⚠ ${label}: ${bytes} bytes > ${MAX_VALUE_BYTES}; dropped business.logoDataUrl (saved ${bytes - nb} bytes).`)
    if (nb <= MAX_VALUE_BYTES) return clone
  }
  return die(`${label}: blob is ${bytes} bytes, over the ${MAX_VALUE_BYTES} cap even after trimming. Split the source or raise the server's MAX_VALUE_BYTES.`)
}

async function getCurrent(): Promise<any> {
  const res = await fetch(`${NEW_KV_URL}/${encodeURIComponent(NEW_KEY)}`, { method: 'GET', headers: authHeaders() })
  if (!res.ok) die(`GET current workspace failed: HTTP ${res.status} ${await res.text()}`)
  const data: any = await res.json()
  return data && data.value && typeof data.value === 'object' ? data.value : null
}

async function post(label: string, state: any) {
  const value = trimForSize(label, state)
  const res = await fetch(`${NEW_KV_URL}/${encodeURIComponent(NEW_KEY)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ value, updated_by: `import:${label}` }),
  })
  if (!res.ok) die(`POST failed for ${label}: HTTP ${res.status} ${await res.text()}`)
  const out: any = await res.json()
  console.log(`  ✓ imported ${label} → server updated_at=${out.updated_at}`)
}

async function loadTracker(): Promise<any> {
  console.log(`Pulling old tracker: ${OLD_KV_URL}/<OLD_KEY>`)
  const res = await fetch(`${OLD_KV_URL}/${encodeURIComponent(OLD_KEY)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  })
  if (!res.ok) die(`GET old tracker failed: HTTP ${res.status}`)
  const data: any = await res.json()
  if (!data || data.value == null) die('old tracker has no value for that key — nothing to pull')
  return data.value
}

async function readJsonFile(path: string, label: string): Promise<any> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e: any) {
    return die(`cannot read ${path}: ${e?.message || e}`)
  }
  try {
    return asState(JSON.parse(text))
  } catch (e: any) {
    return die(`invalid JSON in ${path}: ${e?.message || e}`)
  }
  void label
}

async function main() {
  if (!NEW_KEY) die('NEW_KEY is required (the workspace key to merge into)')

  // ---- gather sources -------------------------------------------------------
  const sources: Array<{ label: string; state: any }> = []
  for (const path of SEED_FILES) {
    sources.push({ label: path.split(/[\\/]/).pop() || path, state: await readJsonFile(path, path) })
  }
  if (SEED_DIR) {
    let names: string[] = []
    try {
      names = (await readdir(SEED_DIR)).filter((n) => n.toLowerCase().endsWith('.json')).sort()
    } catch (e: any) {
      die(`cannot read SEED_DIR ${SEED_DIR}: ${e?.message || e}`)
    }
    for (const n of names) sources.push({ label: n, state: await readJsonFile(join(SEED_DIR, n), n) })
  }
  if (OLD_KEY) sources.push({ label: 'old-tracker', state: await loadTracker() })
  if (!sources.length) die('provide SEED_FILES, SEED_DIR, and/or OLD_KEY — nothing to import from')

  console.log(`Importing into "${NEW_KEY}" at ${NEW_KV_URL} from ${sources.length} source(s):`)
  for (const s of sources) inspect(s.label, s.state)

  // ---- preview vs the live workspace ---------------------------------------
  console.log(`\nReading current workspace to preview the merge…`)
  const current = await getCurrent()
  const running: Record<string, Set<string>> = {}
  for (const c of ID_COLLECTIONS) running[c] = idSet(current?.[c])
  let runningMonths = monthSet(current?.months)
  const baseTotal = ID_COLLECTIONS.reduce((n, c) => n + running[c].size, 0) + runningMonths.size
  console.log(current ? `  current prod holds ${baseTotal} rows across collections.` : `  workspace is EMPTY — every row below is new.`)

  console.log(`\nWhat each source would add (vs. what's already there):`)
  for (const s of sources) {
    const parts: string[] = []
    for (const c of ID_COLLECTIONS) {
      const ids = idSet(s.state?.[c])
      if (!ids.size) continue
      let add = 0
      for (const id of ids) if (!running[c].has(id)) { add++; running[c].add(id) }
      parts.push(`${c}: +${add} new / ${ids.size - add} match`)
    }
    const ms = monthSet(s.state?.months)
    if (ms.size) {
      let add = 0
      for (const k of ms) if (!runningMonths.has(k)) { add++; runningMonths = runningMonths.add(k) }
      parts.push(`months: +${add} new / ${ms.size - add} match`)
    }
    console.log(`  ${s.label}\n    ${parts.length ? parts.join('\n    ') : '(nothing)'}`)
  }
  const finalTotal = ID_COLLECTIONS.reduce((n, c) => n + running[c].size, 0) + runningMonths.size
  console.log(`\nAfter import the workspace would hold ~${finalTotal} rows (was ${baseTotal}; +${finalTotal - baseTotal}).`)
  console.log(`(Existing prod rows are never removed — merge is a union. Counts are an estimate; tombstones/blank-month rules apply server-side.)`)

  if (DRY_RUN) {
    console.log(`\nDRY_RUN — no changes written. Re-run without DRY_RUN to merge into "${NEW_KEY}".`)
    return
  }

  // ---- write ----------------------------------------------------------------
  console.log(`\nMerging…`)
  for (const s of sources) await post(s.label, s.state)
  console.log(`\nDone. Every browser on the "${NEW_KEY}" workspace will pull the union on next open.`)
}

main().catch((e) => die(e?.message || String(e)))
