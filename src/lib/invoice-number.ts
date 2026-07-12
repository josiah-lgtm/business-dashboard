// Outbound invoice numbering.
//
// The next number is derived from the HIGHEST number that actually exists among
// state.invoices — "check the last invoice and carry on from there" — rather than
// a standalone counter that drifts ahead of reality every time a draft is
// cancelled or an invoice is deleted. Because it reads the real invoice list
// (which syncs across devices), both teammates converge on the same next number
// automatically, and cancelling/deleting a draft no longer burns a number.
//
// meta.invoiceNumberStart is an OPTIONAL manual floor ("start numbering from N")
// set from Settings; it can only RAISE the sequence (it sits inside a max()) —
// lowering it below the highest existing invoice has no effect until the
// invoices holding the higher numbers are renumbered or deleted.
// Unset (the default) = pure derive-from-last.
import type { State } from '@/types'

/** The trailing sequence number of an invoice number, e.g. "INV-2026-048" -> 48.
 *  Scans the runs of digits from the END and skips runs that can't plausibly be
 *  a sequence number:
 *   - 4-digit years 1900-2099, so neither the INV-YYYY- prefix nor a hand-typed
 *     year SUFFIX ("048/2026", "INV-2026", a half-edited "INV-2026-") ever
 *     becomes the sequence — one such number would otherwise jump every later
 *     suggestion to 2027+
 *   - runs longer than 6 digits (pasted dates/references like "INV-20260701")
 *  Returns null when no plausible run remains. Trade-off: a genuine sequence in
 *  1900-2099 would be skipped — decades away at this volume, and the manual
 *  start floor can force it if ever needed. */
export function parseInvoiceSeq(number: string | null | undefined): number | null {
  if (!number) return null
  const groups = String(number).match(/\d+/g)
  if (!groups || !groups.length) return null
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g.length > 6) continue // date/reference paste, not a sequence
    const n = parseInt(g, 10)
    if (!Number.isFinite(n)) continue
    if (g.length === 4 && n >= 1900 && n <= 2099) continue // a year, not a sequence
    return n
  }
  return null
}

/** Highest sequence number among existing invoices, or 0 if none parse. */
export function highestInvoiceSeq(invoices: { number?: string }[] | undefined): number {
  let max = 0
  for (const inv of invoices || []) {
    const s = parseInvoiceSeq(inv?.number)
    if (s != null && s > max) max = s
  }
  return max
}

/** The next sequence number: one past the highest existing invoice, never below
 *  the manual start floor, never below 1. */
export function nextInvoiceSeq(state: Pick<State, 'invoices' | 'meta'>): number {
  const fromInvoices = highestInvoiceSeq(state.invoices) + 1
  const floor = Number(state.meta?.invoiceNumberStart) || 0
  return Math.max(fromInvoices, floor, 1)
}

/** Zero-padded to at least 3 digits (INV-YYYY-007), wider past 999. */
export function padSeq(seq: number): string {
  return String(seq).padStart(3, '0')
}

/** The suggested next invoice number string for `year` (continuous sequence,
 *  current-year label). */
export function nextInvoiceNumber(state: Pick<State, 'invoices' | 'meta'>, year: string): string {
  return `INV-${year}-${padSeq(nextInvoiceSeq(state))}`
}
