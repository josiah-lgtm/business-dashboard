// Calculation engine — ported verbatim from the legacy app.
import { S } from './store-access'
import { gbpAmount } from './money'
import { monthOf, sortedMonthIds } from './format'
import type { Expense, Refund, MonthCalc } from '@/types'

export function expensesForMonth(monthId: string): Expense[] {
  return S().expenses.filter((e) => (e.month || monthOf(e.date)) === monthId)
}

export function refundsForMonth(monthId: string): Refund[] {
  return S().refunds.filter((r) => r.month === monthId)
}

export function categoryTotals(monthId: string): Record<string, number> {
  const totals: Record<string, number> = {
    'Base Software': 0,
    'LinkedIn Channel': 0,
    'Email Channel': 0,
    SMS: 0,
    'One off': 0,
    'Founder comp': 0,
    'Referral payouts': 0,
    'Merchant fees': 0,
  }
  expensesForMonth(monthId).forEach((e) => {
    if (totals[e.category] != null) totals[e.category] += gbpAmount(e)
  })
  return totals
}

export function calcMonth(monthId: string): MonthCalc | null {
  const m = S().months[monthId]
  if (!m) return null
  const cat = categoryTotals(monthId)
  const baseSoftware = cat['Base Software']
  const linkedin = cat['LinkedIn Channel']
  const email = cat['Email Channel']
  const sms = cat['SMS']
  const oneOff = cat['One off']
  // Prefer line-item totals; fall back to legacy single-number month fields.
  const merchantFromItems = cat['Merchant fees'] || 0
  const referralFromItems = cat['Referral payouts'] || 0
  const founderFromItems = cat['Founder comp'] || 0
  const merchantFees = merchantFromItems > 0 ? merchantFromItems : m.merchantFees || 0
  const referralPayoutsTotal = referralFromItems > 0 ? referralFromItems : m.referralPayoutsTotal || 0
  const founderComp = founderFromItems > 0 ? founderFromItems : m.founderComp || 0

  const refundsActual = refundsForMonth(monthId).reduce((s, r) => s + r.amount, 0)
  const refundsTotal = refundsActual || m.refundsTotal || 0

  const adjRev = (m.revenue || 0) - refundsTotal - merchantFees

  const marketingCosts = linkedin + email + sms + oneOff + (m.commissionsTotal || 0)
  const deliveryCosts = baseSoftware
  const overheadCosts = (m.salariesTotal || 0) + referralPayoutsTotal

  const totalExpenses = marketingCosts + deliveryCosts + overheadCosts + refundsTotal

  const grossProfit = adjRev - deliveryCosts
  const grossMarginPct = adjRev > 0 ? (grossProfit / adjRev) * 100 : 0
  const netProfit = adjRev - (totalExpenses - refundsTotal) // refunds already subtracted from rev
  const netMarginPct = adjRev > 0 ? (netProfit / adjRev) * 100 : 0

  const overheadPct = adjRev > 0 ? (overheadCosts / adjRev) * 100 : 0
  const refundPct = m.revenue > 0 ? (refundsTotal / m.revenue) * 100 : 0
  const taxReserve = (Math.max(0, netProfit) * (m.taxPct || 0)) / 100
  const founderTaxReserve = (founderComp * (S().targets.founderTaxPct || 0)) / 100
  const totalToSetAside = taxReserve + founderTaxReserve
  const cacOverall = m.newClients > 0 ? marketingCosts / m.newClients : null
  const avgGpPerClient = m.activeClients > 0 ? grossProfit / m.activeClients : null
  const churnRate = m.activeClients > 0 ? (m.churnedClients / m.activeClients) * 100 : 0

  return {
    monthId,
    adjRev,
    grossProfit,
    netProfit,
    grossMarginPct,
    netMarginPct,
    marketingCosts,
    deliveryCosts,
    overheadCosts,
    totalExpenses,
    refundsTotal,
    refundPct,
    overheadPct,
    taxReserve,
    founderComp,
    founderTaxReserve,
    totalToSetAside,
    categories: cat,
    cacOverall,
    avgGpPerClient,
    churnRate,
    raw: m,
  }
}

export function calcAggregates(monthIds: string[]) {
  let revenue = 0,
    marketing = 0,
    grossProfit = 0,
    totalExp = 0,
    netProfit = 0
  let n = 0
  monthIds.forEach((id) => {
    const c = calcMonth(id)
    if (!c) return
    n++
    revenue += c.adjRev
    marketing += c.marketingCosts
    grossProfit += c.grossProfit
    totalExp += c.totalExpenses
    netProfit += c.netProfit
  })
  return { n, revenue, marketing, grossProfit, totalExp, netProfit }
}

export interface ChannelDecision {
  action: 'maintain' | 'double-down' | 'fix'
  label: string
  monthlySpend: number
  trendPct: number
}

export function decisionForCategory(cat: string): ChannelDecision {
  const ids = sortedMonthIds().slice(-3)
  if (!ids.length) {
    return { action: 'maintain', label: 'NO DATA', monthlySpend: 0, trendPct: 0 }
  }
  const perMonth = ids.map((id) => categoryTotals(id)[cat] || 0)
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
  return { action, label, monthlySpend: avg, trendPct }
}

export function prevMonthId(monthId: string): string | null {
  const ids = sortedMonthIds()
  const i = ids.indexOf(monthId)
  return i > 0 ? ids[i - 1] : null
}
