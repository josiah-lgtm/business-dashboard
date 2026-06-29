// ============================================================
// State merge — PORTED VERBATIM from the SPA's src/lib/merge.ts so the server
// resolves conflicts byte-identically to the client. The only difference in
// use: the server calls mergeStates(dbState, incomingBlob, { preferRemote: true })
// because the incoming POST is, by construction, the most recent writer (it was
// produced after that client's last GET). Per-entity timestamps still dominate
// the tiebreak, exactly as on the client — that is what prevents lost updates.
//
// Keep this in lockstep with src/lib/merge.ts. If the client merge changes,
// change it here too (and re-run the tests).
// ============================================================
import type { State } from './types.js'

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
  if (tr && !tl) return remote
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
  merged.months = mergeRecord(local.months, remote.months, (l, r) => pick(l, r))
  merged.budgets = mergeRecord(local.budgets, remote.budgets, (l: any, r: any) => {
    const sl = l?._savedAt || ''
    const sr = r?._savedAt || ''
    if (sl && sr) return sr > sl ? r : sl > sr ? l : pick(l, r)
    if (sr && !sl) return r
    if (sl && !sr) return l
    return pick(l, r)
  })
  merged.teamInvoiceCounters = mergeRecord(
    local.teamInvoiceCounters, remote.teamInvoiceCounters,
    (l, r) => (Number(r) > Number(l) ? r : l),
  )
  merged.teamInvoiceMonths = mergeRecord(local.teamInvoiceMonths, remote.teamInvoiceMonths, (l, r) => pick(l, r))

  // --- shared singletons ---
  merged.business = pick(local.business, remote.business)
  merged.targets = pick(local.targets, remote.targets)
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
    invoiceCounter: Math.max(Number(lm.invoiceCounter) || 0, Number(rm.invoiceCounter) || 0),
    fxRates: pick(lm.fxRates, rm.fxRates) || lm.fxRates,
    fxRate: pick(lm.fxRate, rm.fxRate),
  }

  // --- per-device fields: always keep local ---
  merged.cloudSync = local.cloudSync
  merged.teamInvoiceActiveMemberId = local.teamInvoiceActiveMemberId
  merged._tiTab = local._tiTab

  // --- deletion tombstones ---
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
