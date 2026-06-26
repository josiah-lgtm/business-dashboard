// ============================================================
// State merge — the core of reliable multi-user sync.
//
// The legacy sync replaced the WHOLE local state with the remote blob on
// every pull (last-write-wins on one giant document). With two editors that
// silently drops data: whoever saved last wins, the other's edits vanish.
// That is the root cause of "Joanna's changes aren't visible" / "her data is
// missing" — and it's why a pull must MERGE, not replace.
//
// Design goals, in priority order:
//   1. NEVER drop an entry that exists on either side. Every id-keyed
//      collection is unioned by id, so recovering one device's data can't
//      clobber the other's.
//   2. Resolve genuine same-entity conflicts sanely: prefer the side with the
//      newer per-entity timestamp (updatedAt / _savedAt / …); when no usable
//      timestamp exists, fall back to `preferRemote` (true when the remote
//      blob's server updated_at is newer than ours) — i.e. the old LWW rule,
//      but now only as a *tiebreak within a union*, never as a way to delete.
//   3. Keep per-device fields local (sync config, which view/month is open,
//      the logged-in portal member) — these are not shared data.
//
// Known tradeoff (acceptable for a small team, revisit with tombstones later):
// a union can resurrect an entry one side deleted while the other still had it.
// Favouring "keep data" over "honour deletes" is the safer failure mode while
// we're recovering stranded data.
// ============================================================
import type { State } from '@/types'

type Dict = Record<string, any>

/** Largest (lexically latest) ISO timestamp among the given fields, or '' if none. */
function latestTs(obj: Dict, fields: string[]): string {
  let best = ''
  for (const f of fields) {
    const v = obj?.[f]
    if (typeof v === 'string' && v > best) best = v
  }
  return best
}

/** Pick the winner between two versions of the same entity. */
function pickEntity<T extends Dict>(local: T, remote: T, tsFields: string[], preferRemote: boolean): T {
  const tl = latestTs(local, tsFields)
  const tr = latestTs(remote, tsFields)
  if (tl && tr) {
    if (tr > tl) return remote
    if (tl > tr) return local
    return preferRemote ? remote : local
  }
  if (tr && !tl) return remote // remote recorded an update, local never did
  if (tl && !tr) return local
  return preferRemote ? remote : local
}

/**
 * Union two id-keyed arrays. Local order is preserved (stable for the UI);
 * remote-only entries are appended. Entries present on both sides are resolved
 * by pickEntity. Never drops an id from either side.
 */
function unionById<T extends { id: string }>(
  local: T[] | undefined,
  remote: T[] | undefined,
  tsFields: string[],
  preferRemote: boolean,
): T[] {
  const L = Array.isArray(local) ? local : []
  const R = Array.isArray(remote) ? remote : []
  const remoteById = new Map<string, T>()
  for (const r of R) if (r && r.id != null) remoteById.set(r.id, r)

  const seen = new Set<string>()
  const out: T[] = []
  for (const l of L) {
    if (!l || l.id == null) { out.push(l); continue }
    seen.add(l.id)
    const r = remoteById.get(l.id)
    out.push(r ? pickEntity(l, r, tsFields, preferRemote) : l)
  }
  for (const r of R) {
    if (!r || r.id == null) { out.push(r); continue }
    if (!seen.has(r.id)) out.push(r)
  }
  return out
}

/** Union two record maps, resolving shared keys with `resolve`. Keeps all keys. */
function mergeRecord<V>(
  local: Record<string, V> | undefined,
  remote: Record<string, V> | undefined,
  resolve: (l: V, r: V) => V,
): Record<string, V> {
  const out: Record<string, V> = { ...(local || {}) }
  const R = remote || {}
  for (const k of Object.keys(R)) {
    out[k] = k in out ? resolve(out[k], R[k]) : R[k]
  }
  return out
}

/**
 * Merge a remote state blob into the local one.
 * @returns merged state and whether it differs from `local` (→ persist + push back).
 */
export function mergeStates(
  local: State,
  remote: State,
  opts: { preferRemote: boolean },
): { merged: State; changed: boolean } {
  const pr = opts.preferRemote
  const pick = <T>(l: T, r: T): T => (pr ? r : l)

  // Start from a shallow copy of local so per-device fields survive by default.
  const merged: State = { ...local }

  // --- id-keyed collections: union, never drop ---
  merged.expenses = unionById(local.expenses, remote.expenses, [], pr)
  merged.vendors = unionById(local.vendors, remote.vendors, [], pr)
  merged.refunds = unionById(local.refunds, remote.refunds, [], pr)
  merged.team = unionById(local.team, remote.team, [], pr)
  merged.tasks = unionById(local.tasks, remote.tasks, [], pr)
  merged.invoices = unionById(local.invoices, remote.invoices, ['updatedAt', 'date'], pr)
  merged.teamInvoices = unionById(
    local.teamInvoices, remote.teamInvoices,
    ['updatedAt', 'acceptedAt', 'declinedAt', 'createdAt'], pr,
  )
  merged.revenueEntries = unionById(local.revenueEntries, remote.revenueEntries, [], pr)
  merged.customBuckets = unionById(local.customBuckets, remote.customBuckets, [], pr)
  merged.teamPayouts = unionById(local.teamPayouts, remote.teamPayouts, [], pr)

  // --- record maps ---
  // Months: numeric figures, no per-entity timestamp → tiebreak by preferRemote.
  merged.months = mergeRecord(local.months, remote.months, (l, r) => pick(l, r))
  // Budgets: each month carries a _savedAt; newest save wins, else preferRemote.
  merged.budgets = mergeRecord(local.budgets, remote.budgets, (l: any, r: any) => {
    const sl = l?._savedAt || ''
    const sr = r?._savedAt || ''
    if (sl && sr) return sr > sl ? r : sl > sr ? l : pick(l, r)
    if (sr && !sl) return r
    if (sl && !sr) return l
    return pick(l, r)
  })
  // Invoice counters only ever increase — take the max so numbers are never reused.
  merged.teamInvoiceCounters = mergeRecord(
    local.teamInvoiceCounters, remote.teamInvoiceCounters,
    (l, r) => (Number(r) > Number(l) ? r : l),
  )
  merged.teamInvoiceMonths = mergeRecord(local.teamInvoiceMonths, remote.teamInvoiceMonths, (l, r) => pick(l, r))

  // --- shared singletons ---
  merged.business = pick(local.business, remote.business)
  merged.targets = pick(local.targets, remote.targets)
  // Prefer a non-empty webhook; if both set, newest blob wins.
  merged.slackWebhookUrl = !remote.slackWebhookUrl
    ? local.slackWebhookUrl
    : !local.slackWebhookUrl
      ? remote.slackWebhookUrl
      : pick(local.slackWebhookUrl, remote.slackWebhookUrl)

  // --- meta: mix of shared + per-device ---
  const lm = local.meta || ({} as State['meta'])
  const rm = remote.meta || ({} as State['meta'])
  merged.meta = {
    ...lm,
    // shared, monotonic / newest-wins:
    invoiceCounter: Math.max(Number(lm.invoiceCounter) || 0, Number(rm.invoiceCounter) || 0),
    fxRates: pick(lm.fxRates, rm.fxRates) || lm.fxRates,
    fxRate: pick(lm.fxRate, rm.fxRate),
    // per-device UI (activeView, activeMonth, currency, invoicesTab, cloudUpdatedAt)
    // are inherited from `lm` via the spread above and intentionally NOT taken
    // from remote. cloudUpdatedAt is set by the caller after a successful sync.
  }

  // --- per-device fields: always keep local ---
  merged.cloudSync = local.cloudSync
  merged.teamInvoiceActiveMemberId = local.teamInvoiceActiveMemberId
  merged._tiTab = local._tiTab

  // --- deletion tombstones ---
  // Union both sides' tombstones (latest timestamp wins per key), then drop any
  // entry that's tombstoned so a delete on one device propagates instead of being
  // resurrected by the union. Ids are unique forever (random uids), so a tombstone
  // is permanent and safe to apply without comparing against entry timestamps.
  // Rule: a tombstone beats a concurrent edit to the same entry (delete wins).
  merged.deletions = mergeRecord(
    local.deletions, remote.deletions,
    (l: string, r: string) => (r > l ? r : l),
  )
  const dead = merged.deletions
  const live = <T extends { id: string }>(coll: string, arr: T[]): T[] =>
    arr.filter((x) => !x || x.id == null || !dead[`${coll}:${x.id}`])
  merged.expenses = live('expenses', merged.expenses)
  merged.vendors = live('vendors', merged.vendors)
  merged.refunds = live('refunds', merged.refunds)
  merged.team = live('team', merged.team)
  merged.tasks = live('tasks', merged.tasks)
  merged.invoices = live('invoices', merged.invoices)
  merged.teamInvoices = live('teamInvoices', merged.teamInvoices)
  merged.revenueEntries = live('revenueEntries', merged.revenueEntries)
  merged.customBuckets = live('customBuckets', merged.customBuckets)
  merged.teamPayouts = live('teamPayouts', merged.teamPayouts)
  for (const id of Object.keys(merged.months)) {
    if (dead[`months:${id}`]) delete merged.months[id]
  }

  const changed = JSON.stringify(merged) !== JSON.stringify(local)
  return { merged, changed }
}
