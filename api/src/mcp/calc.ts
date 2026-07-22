// ============================================================
// The money engine, ported from the SPA (src/lib/calc.ts, money.ts, buckets.ts)
// and made pure: every function takes the State instead of reaching for a Pinia
// store. The formulas are VERBATIM — if the MCP disagreed with the dashboard by
// even a rounding rule, every number a model quoted would be quietly wrong.
//
// Keep in lockstep with src/lib/calc.ts.
// ============================================================
import type { Expense, Refund, State } from '../types.js'

export const CATEGORY_ORDER = [
  'Base Software',
  'LinkedIn Channel',
  'Email Channel',
  'SMS',
  'One off',
  'Founder comp',
  'Referral payouts',
  'Merchant fees',
] as const

/** Default bucket definitions the Finance Hub renders (src/lib/buckets.ts). */
export const DEFAULT_BUCKETS = [
  { id: 'base', name: 'Base Software', kind: 'expense', categoryMap: 'Base Software' },
  { id: 'linkedin', name: 'LinkedIn Channel', kind: 'expense', categoryMap: 'LinkedIn Channel' },
  { id: 'email', name: 'Email Channel', kind: 'expense', categoryMap: 'Email Channel' },
  { id: 'sms', name: 'SMS Channel', kind: 'expense', categoryMap: 'SMS' },
  { id: 'oneoff', name: 'One off', kind: 'expense', categoryMap: 'One off' },
  { id: 'team', name: 'Team & Payouts', kind: 'team' },
  { id: 'founder', name: 'Founder compensation', kind: 'expense', categoryMap: 'Founder comp', fallbackMonthField: 'founderComp' },
  { id: 'referrals', name: 'Referral payouts', kind: 'expense', categoryMap: 'Referral payouts', fallbackMonthField: 'referralPayoutsTotal' },
  { id: 'merchant', name: 'Merchant / Stripe fees', kind: 'expense', categoryMap: 'Merchant fees', fallbackMonthField: 'merchantFees' },
  { id: 'refunds', name: 'Refunds', kind: 'refund' },
] as const

// ---- dates -------------------------------------------------------------------

export function monthOf(dateStr: string | undefined | null): string {
  return dateStr ? String(dateStr).slice(0, 7) : ''
}

export function sortedMonthIds(state: State): string[] {
  return Object.keys(state.months || {}).sort()
}

export function isMonthId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

export function isDateId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

// ---- FX ----------------------------------------------------------------------

export function fxRateFor(state: State, cur: string): number {
  if (cur === 'GBP') return 1
  const rates = (state.meta?.fxRates || {}) as Record<string, number>
  return Number(rates[cur]) || (cur === 'USD' ? 1.27 : cur === 'EUR' ? 1.17 : 1)
}

/** Convert an amount in `currency` to its GBP equivalent (canonical storage). */
export function toGbp(state: State, amount: number, currency?: string): number {
  if (!amount || isNaN(amount)) return 0
  const c = currency || 'GBP'
  if (c === 'GBP') return Number(amount)
  return Number(amount) / fxRateFor(state, c)
}

export function gbpAmount(state: State, e: Pick<Expense, 'amount' | 'currency'>): number {
  return toGbp(state, Number(e.amount) || 0, e.currency || 'GBP')
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

// ---- per-month --------------------------------------------------------------

export function expensesForMonth(state: State, monthId: string): Expense[] {
  return (state.expenses || []).filter((e) => (e.month || monthOf(e.date)) === monthId)
}

export function refundsForMonth(state: State, monthId: string): Refund[] {
  return (state.refunds || []).filter((r) => r.month === monthId)
}

export function categoryTotals(state: State, monthId: string): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const c of CATEGORY_ORDER) totals[c] = 0
  for (const e of expensesForMonth(state, monthId)) {
    if (totals[e.category] != null) totals[e.category] += gbpAmount(state, e)
  }
  return totals
}

/** Categories present in the data that aren't one of the eight canonical ones. */
export function otherCategoryTotals(state: State, monthId: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of expensesForMonth(state, monthId)) {
    if ((CATEGORY_ORDER as readonly string[]).includes(e.category)) continue
    out[e.category || '(uncategorised)'] = (out[e.category || '(uncategorised)'] || 0) + gbpAmount(state, e)
  }
  return out
}

export interface MonthCalc {
  monthId: string
  revenue: number
  adjRev: number
  grossProfit: number
  netProfit: number
  grossMarginPct: number
  netMarginPct: number
  marketingCosts: number
  deliveryCosts: number
  overheadCosts: number
  totalExpenses: number
  merchantFees: number
  refundsTotal: number
  refundPct: number
  overheadPct: number
  taxReserve: number
  founderComp: number
  founderTaxReserve: number
  totalToSetAside: number
  categories: Record<string, number>
  cacOverall: number | null
  avgGpPerClient: number | null
  churnRate: number
  newClients: number
  activeClients: number
  churnedClients: number
  expenseCount: number
}

/** VERBATIM port of src/lib/calc.ts calcMonth(). Null when the month has no record. */
export function calcMonth(state: State, monthId: string): MonthCalc | null {
  const m = (state.months || {})[monthId]
  if (!m) return null
  const cat = categoryTotals(state, monthId)
  const baseSoftware = cat['Base Software']
  const linkedin = cat['LinkedIn Channel']
  const email = cat['Email Channel']
  const sms = cat['SMS']
  const oneOff = cat['One off']
  // Prefer line-item totals; fall back to the legacy single-number month fields.
  const merchantFromItems = cat['Merchant fees'] || 0
  const referralFromItems = cat['Referral payouts'] || 0
  const founderFromItems = cat['Founder comp'] || 0
  const merchantFees = merchantFromItems > 0 ? merchantFromItems : m.merchantFees || 0
  const referralPayoutsTotal = referralFromItems > 0 ? referralFromItems : m.referralPayoutsTotal || 0
  const founderComp = founderFromItems > 0 ? founderFromItems : m.founderComp || 0

  const refundsActual = refundsForMonth(state, monthId).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const refundsTotal = refundsActual || m.refundsTotal || 0

  const adjRev = (m.revenue || 0) - refundsTotal - merchantFees

  const marketingCosts = linkedin + email + sms + oneOff + (m.commissionsTotal || 0)
  const deliveryCosts = baseSoftware
  const overheadCosts = (m.salariesTotal || 0) + referralPayoutsTotal

  const totalExpenses = marketingCosts + deliveryCosts + overheadCosts + refundsTotal

  const grossProfit = adjRev - deliveryCosts
  const grossMarginPct = adjRev > 0 ? (grossProfit / adjRev) * 100 : 0
  const netProfit = adjRev - (totalExpenses - refundsTotal) // refunds already out of adjRev
  const netMarginPct = adjRev > 0 ? (netProfit / adjRev) * 100 : 0

  const overheadPct = adjRev > 0 ? (overheadCosts / adjRev) * 100 : 0
  const refundPct = m.revenue > 0 ? (refundsTotal / m.revenue) * 100 : 0
  const taxReserve = (Math.max(0, netProfit) * (m.taxPct || 0)) / 100
  const founderTaxReserve = (founderComp * (state.targets?.founderTaxPct || 0)) / 100
  const totalToSetAside = taxReserve + founderTaxReserve
  const cacOverall = m.newClients > 0 ? marketingCosts / m.newClients : null
  const avgGpPerClient = m.activeClients > 0 ? grossProfit / m.activeClients : null
  const churnRate = m.activeClients > 0 ? (m.churnedClients / m.activeClients) * 100 : 0

  return {
    monthId,
    revenue: round2(m.revenue || 0),
    adjRev: round2(adjRev),
    grossProfit: round2(grossProfit),
    netProfit: round2(netProfit),
    grossMarginPct: round2(grossMarginPct),
    netMarginPct: round2(netMarginPct),
    marketingCosts: round2(marketingCosts),
    deliveryCosts: round2(deliveryCosts),
    overheadCosts: round2(overheadCosts),
    totalExpenses: round2(totalExpenses),
    merchantFees: round2(merchantFees),
    refundsTotal: round2(refundsTotal),
    refundPct: round2(refundPct),
    overheadPct: round2(overheadPct),
    taxReserve: round2(taxReserve),
    founderComp: round2(founderComp),
    founderTaxReserve: round2(founderTaxReserve),
    totalToSetAside: round2(totalToSetAside),
    categories: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, round2(v)])),
    cacOverall: cacOverall == null ? null : round2(cacOverall),
    avgGpPerClient: avgGpPerClient == null ? null : round2(avgGpPerClient),
    churnRate: round2(churnRate),
    newClients: m.newClients || 0,
    activeClients: m.activeClients || 0,
    churnedClients: m.churnedClients || 0,
    expenseCount: expensesForMonth(state, monthId).length,
  }
}

export interface Aggregates {
  months: number
  revenue: number
  marketing: number
  grossProfit: number
  totalExpenses: number
  netProfit: number
  grossMarginPct: number | null
  netMarginPct: number | null
  avgMonthlyRevenue: number | null
  avgMonthlyNet: number | null
}

/** VERBATIM port of calcAggregates(), plus the derived ratios a model asks for. */
export function calcAggregates(state: State, monthIds: string[]): Aggregates {
  let revenue = 0
  let marketing = 0
  let grossProfit = 0
  let totalExp = 0
  let netProfit = 0
  let n = 0
  for (const id of monthIds) {
    const c = calcMonth(state, id)
    if (!c) continue
    n++
    revenue += c.adjRev
    marketing += c.marketingCosts
    grossProfit += c.grossProfit
    totalExp += c.totalExpenses
    netProfit += c.netProfit
  }
  return {
    months: n,
    revenue: round2(revenue),
    marketing: round2(marketing),
    grossProfit: round2(grossProfit),
    totalExpenses: round2(totalExp),
    netProfit: round2(netProfit),
    grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    netMarginPct: revenue > 0 ? round2((netProfit / revenue) * 100) : null,
    avgMonthlyRevenue: n > 0 ? round2(revenue / n) : null,
    avgMonthlyNet: n > 0 ? round2(netProfit / n) : null,
  }
}

export interface ChannelDecision {
  category: string
  action: 'maintain' | 'double-down' | 'fix'
  label: string
  monthlySpend: number
  trendPct: number
  monthsConsidered: string[]
}

/** VERBATIM port of decisionForCategory() — the Overview "what to do" verdict. */
export function decisionForCategory(state: State, cat: string): ChannelDecision {
  const ids = sortedMonthIds(state).slice(-3)
  if (!ids.length) {
    return { category: cat, action: 'maintain', label: 'NO DATA', monthlySpend: 0, trendPct: 0, monthsConsidered: [] }
  }
  const perMonth = ids.map((id) => categoryTotals(state, id)[cat] || 0)
  const total = perMonth.reduce((s, v) => s + v, 0)
  const avg = total / ids.length
  const recent = perMonth[perMonth.length - 1] || 0
  const earlier = perMonth.slice(0, -1)
  const earlierAvg = earlier.length ? earlier.reduce((s, v) => s + v, 0) / earlier.length : 0
  const trendPct = earlierAvg > 0 ? ((recent - earlierAvg) / earlierAvg) * 100 : 0
  let action: ChannelDecision['action'] = 'maintain'
  let label = 'STEADY'
  if (avg <= 0) {
    action = 'maintain'
    label = 'NO SPEND'
  } else if (trendPct >= 25) {
    action = 'double-down'
    label = 'SCALING UP'
  } else if (trendPct <= -25) {
    action = 'fix'
    label = 'WINDING DOWN'
  }
  return {
    category: cat,
    action,
    label,
    monthlySpend: round2(avg),
    trendPct: round2(trendPct),
    monthsConsidered: ids,
  }
}

// ---- range resolution --------------------------------------------------------

export interface MonthRange {
  months: string[]
  from: string | null
  to: string | null
  label: string
}

/**
 * Resolve a month window against the months that actually exist. `from`/`to`
 * are INCLUSIVE `YYYY-MM`; `last_n` counts back from the newest month with a
 * record. Everything else defaults to every month on file, newest last.
 */
export function resolveMonths(
  state: State,
  input: { from?: string; to?: string; last_n?: number; month?: string } = {},
): MonthRange {
  const all = sortedMonthIds(state)
  if (input.month) {
    const hit = all.includes(input.month) ? [input.month] : []
    return { months: hit, from: input.month, to: input.month, label: input.month }
  }
  let months = all
  if (input.from) months = months.filter((m) => m >= input.from!)
  if (input.to) months = months.filter((m) => m <= input.to!)
  if (input.last_n && input.last_n > 0) months = months.slice(-input.last_n)
  const from = months[0] ?? null
  const to = months[months.length - 1] ?? null
  const label = from && to ? (from === to ? from : `${from}..${to}`) : 'no months on file'
  return { months, from, to, label }
}

// ---- team --------------------------------------------------------------------

/** Monthly cost of the active roster, split the way the Team Roster card does. */
export function teamCost(state: State): {
  salaryTotal: number
  commissionTotal: number
  total: number
  activeCount: number
  inactiveCount: number
} {
  let salaryTotal = 0
  let commissionTotal = 0
  let activeCount = 0
  let inactiveCount = 0
  for (const m of state.team || []) {
    if (!m.active) {
      inactiveCount++
      continue
    }
    activeCount++
    salaryTotal += Number(m.monthlySalary) || 0
    commissionTotal += Number(m.commissionAmount) || 0
  }
  return {
    salaryTotal: round2(salaryTotal),
    commissionTotal: round2(commissionTotal),
    total: round2(salaryTotal + commissionTotal),
    activeCount,
    inactiveCount,
  }
}
