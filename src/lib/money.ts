// Money / FX helpers — ported verbatim from the legacy app.
// GBP is the canonical storage currency; conversions to USD/EUR happen at
// display time using state.meta.fxRates ("1 GBP = X foreign").
import { S } from './store-access'
import type { Currency, Expense } from '@/types'

export const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }

export function fxRateFor(cur: string): number {
  if (cur === 'GBP') return 1
  const s = S()
  const rates = (s.meta && s.meta.fxRates) || ({} as Record<string, number>)
  return Number(rates[cur]) || (cur === 'USD' ? 1.27 : cur === 'EUR' ? 1.17 : 1)
}

// Convert an amount in `currency` to its GBP equivalent (canonical storage).
export function toGbp(amount: number, currency?: string): number {
  if (!amount || isNaN(amount)) return 0
  const c = currency || 'GBP'
  if (c === 'GBP') return Number(amount)
  return Number(amount) / fxRateFor(c) // 1 GBP = X foreign → foreign / X = GBP
}

// Per-expense GBP equivalent. Tolerates expenses that pre-date the currency field.
export function gbpAmount(e: Pick<Expense, 'amount' | 'currency'>): number {
  return toGbp(Number(e.amount) || 0, e.currency || 'GBP')
}

export function money(gbp: number | null | undefined): string {
  if (gbp == null || isNaN(gbp)) return '—'
  const cur = S().meta.currency || 'GBP'
  const v = cur === 'GBP' ? gbp : gbp * fxRateFor(cur)
  const sign = CURRENCY_SYMBOLS[cur] || '£'
  const abs = Math.abs(v)
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-${sign}${formatted}` : `${sign}${formatted}`
}

export function moneyShort(gbp: number | null | undefined): string {
  if (gbp == null || isNaN(gbp)) return '—'
  const cur = S().meta.currency || 'GBP'
  const v = cur === 'GBP' ? gbp : gbp * fxRateFor(cur)
  const sign = CURRENCY_SYMBOLS[cur] || '£'
  const abs = Math.abs(v)
  let s: string
  if (abs >= 1000) s = (v / 1000).toFixed(1) + 'k'
  else s = v.toFixed(0)
  return v < 0 && abs >= 1000 ? `-${sign}${(abs / 1000).toFixed(1)}k` : `${sign}${s}`
}

// Format an amount that's already in `srcCurrency` (no conversion).
export function moneyIn(amount: number | null | undefined, srcCurrency?: string): string {
  if (amount == null || isNaN(amount)) return '—'
  const sign = CURRENCY_SYMBOLS[srcCurrency || 'GBP'] || '£'
  const abs = Math.abs(amount)
  return (amount < 0 ? '-' : '') + sign + abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function pct(x: number | null | undefined): string {
  return x == null || isNaN(x) || !isFinite(x) ? '—' : `${x.toFixed(1)}%`
}

export function currencySymbol(cur?: string): string {
  return CURRENCY_SYMBOLS[cur || 'GBP'] || '£'
}

export type { Currency }
