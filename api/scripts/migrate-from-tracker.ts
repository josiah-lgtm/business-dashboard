// One-time seed: copy a workspace blob from the OLD team-tracker KV into the
// NEW Postgres backend (which decomposes it into relational tables via the same
// merge path as a normal POST — so it is safe to run more than once).
//
// Run with tsx (no build needed):
//   OLD_KEY=<old workspace key> NEW_KEY=<new workspace key> \
//   API_TOKEN=<token> npx tsx scripts/migrate-from-tracker.ts
//
// Env (with defaults):
//   OLD_KV_URL  https://tracker.agencyadvanta.com/api/external/kv
//   OLD_KEY     (required)
//   NEW_KV_URL  http://localhost:54330/external/kv
//   NEW_KEY     (defaults to OLD_KEY)
//   API_TOKEN   (required if the new api enforces a token)
//   ORIGIN      https://businessdashboard.agencyadvanta.com  (must be allow-listed on team-tracker)

const OLD_KV_URL = process.env.OLD_KV_URL || 'https://tracker.agencyadvanta.com/api/external/kv'
const OLD_KEY = process.env.OLD_KEY || ''
const NEW_KV_URL = process.env.NEW_KV_URL || 'http://localhost:54330/external/kv'
const NEW_KEY = process.env.NEW_KEY || OLD_KEY
const API_TOKEN = process.env.API_TOKEN || ''
// team-tracker's KV gates GET/POST on an allow-listed Origin header.
const ORIGIN = process.env.ORIGIN || 'https://businessdashboard.agencyadvanta.com'

function die(msg: string): never {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

async function main() {
  if (!OLD_KEY) die('OLD_KEY is required')

  console.log(`Fetching old blob: ${OLD_KV_URL}/<OLD_KEY>`)
  const getRes = await fetch(`${OLD_KV_URL}/${encodeURIComponent(OLD_KEY)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  })
  if (!getRes.ok) die(`GET old KV failed: HTTP ${getRes.status}`)
  const data: any = await getRes.json()
  if (!data || data.value == null) die('old KV has no value for that key — nothing to migrate')

  const approxBytes = JSON.stringify(data.value).length
  console.log(`Old blob loaded (~${approxBytes} bytes, updated_at=${data.updated_at || 'n/a'})`)

  console.log(`Posting to new backend: ${NEW_KV_URL}/<NEW_KEY>`)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`
  const postRes = await fetch(`${NEW_KV_URL}/${encodeURIComponent(NEW_KEY)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ value: data.value, updated_by: 'migration' }),
  })
  if (!postRes.ok) die(`POST new backend failed: HTTP ${postRes.status} ${await postRes.text()}`)
  const out: any = await postRes.json()
  console.log(`Done. New backend updated_at=${out.updated_at}`)
}

main().catch((e) => die(e?.message || String(e)))
