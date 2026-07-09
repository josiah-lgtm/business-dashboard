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
// set from Settings; it lets you reset/bump the sequence without touching any
// existing invoices. Unset (the default) = pure derive-from-last.
import type { State } from '@/types'

/** The trailing integer of an invoice number, e.g. "INV-2026-048" -> 48.
 *  Uses the LAST run of digits so the INV-YYYY- year prefix is never mistaken
 *  for the sequence. Returns null for a number with no digits. */
export function parseInvoiceSeq(number: string | null | undefined): number | null {
  if (!number) return null
  const groups = String(number).match(/\d+/g)
  if (!groups || !groups.length) return null
  const n = parseInt(groups[groups.length - 1], 10)
  return Number.isFinite(n) ? n : null
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
