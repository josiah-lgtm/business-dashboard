// ============================================================
// Exchange-rate auto-update (scheduled + on-demand).
//
// Source: fawazahmed0 currency-api — free, no API key, no rate limits, updated
// once daily, and (crucially for this app) served with a British-pound base:
//   { "date": "YYYY-MM-DD", "gbp": { "usd": 1.34, "eur": 1.17, ... } }
// Primary is the jsDelivr CDN; a Cloudflare Pages mirror is the documented
// fallback. GBP is this app's canonical currency, so we only need GBP->{USD,EUR}.
//
// Why server-side: rates are fetched ONCE here and written into every workspace's
// meta.fxRates, then reach both teammates through the normal sync (SSE + poll).
// Doing it per-browser would have every device hammering the API and fighting
// over the value. The data updates daily, so the 3x/day schedule below always
// catches the change well within a day while staying gentle on the source.
// ============================================================
import { prisma } from './db.js'
import { updateFxRates } from './store.js'
import { publish } from './events.js'

const PRIMARY = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/gbp.json'
const FALLBACK = 'https://latest.currency-api.pages.dev/v1/currencies/gbp.json'
const FETCH_TIMEOUT_MS = 10_000
const INTERVAL_MS = 8 * 60 * 60 * 1000 // 3x per day
const BOOT_DELAY_MS = 15_000 // let the DB/migrations settle before the first fetch

// Minimal logger shape (Fastify's app.log satisfies it); optional so the module
// stays testable without a logger.
type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }

export interface GbpRates {
  usd: number
  eur: number
  date: string
}

async function fetchOne(url: string): Promise<GbpRates | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const data: any = await r.json()
    const g = data && data.gbp
    if (!g) return null
    const usd = Number(g.usd)
    const eur = Number(g.eur)
    if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(eur) || eur <= 0) return null
    return { usd, eur, date: String(data.date || '') }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch GBP-based rates, primary then fallback. null if both are unavailable. */
export async function fetchGbpRates(): Promise<GbpRates | null> {
  return (await fetchOne(PRIMARY)) || (await fetchOne(FALLBACK))
}

/** Fetch once and apply to every workspace; publish an SSE nudge where changed.
 *  On fetch failure it keeps each workspace's last-good rates (no write). */
export async function refreshFxRates(log?: Log): Promise<{ ok: boolean; rates?: GbpRates; updated: number }> {
  const rates = await fetchGbpRates()
  if (!rates) {
    log?.warn({}, 'fx: rate fetch failed (both sources) — keeping last-good rates')
    return { ok: false, updated: 0 }
  }
  const workspaces = await prisma.workspace.findMany({ select: { key: true } })
  let updated = 0
  for (const { key } of workspaces) {
    try {
      const { changed, updated_at } = await updateFxRates(key, { USD: rates.usd, EUR: rates.eur })
      if (changed) {
        updated++
        publish(key, { updated_at, updated_by: 'fx-rates-bot' })
      }
    } catch (e) {
      log?.warn({ err: String(e) }, 'fx: update failed for a workspace')
    }
  }
  log?.info(
    { date: rates.date, usd: rates.usd, eur: rates.eur, workspaces: workspaces.length, updated },
    'fx: rates refreshed',
  )
  return { ok: true, rates, updated }
}

let started = false
let inflight = false

/** Start the recurring refresh (boot + every 8h). Disabled with FX_AUTO_UPDATE=0. */
export function startFxScheduler(log?: Log): void {
  if (process.env.FX_AUTO_UPDATE === '0') {
    log?.info({}, 'fx: auto-update disabled (FX_AUTO_UPDATE=0)')
    return
  }
  if (started) return
  started = true
  const run = async () => {
    if (inflight) return
    inflight = true
    try {
      await refreshFxRates(log)
    } catch (e) {
      log?.warn({ err: String(e) }, 'fx: scheduled refresh threw')
    } finally {
      inflight = false
    }
  }
  setTimeout(run, BOOT_DELAY_MS).unref?.()
  setInterval(run, INTERVAL_MS).unref?.()
}
