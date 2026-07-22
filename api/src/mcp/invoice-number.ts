// Outbound invoice numbering, ported VERBATIM from src/lib/invoice-number.ts so
// a number suggested over MCP is the same one the editor would suggest.
//
// The sequence is derived from the highest number that actually exists, not
// from a counter — a cancelled draft must not burn a number.
import type { State } from '../types.js'

/** Trailing sequence of an invoice number ("INV-2026-048" -> 48). Runs that are
 * a 4-digit year (1900-2099) or longer than 6 digits are skipped, so neither the
 * INV-YYYY prefix nor a pasted date is ever read as the sequence. */
export function parseInvoiceSeq(number: string | null | undefined): number | null {
  if (!number) return null
  const groups = String(number).match(/\d+/g)
  if (!groups || !groups.length) return null
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g.length > 6) continue
    const n = parseInt(g, 10)
    if (!Number.isFinite(n)) continue
    if (g.length === 4 && n >= 1900 && n <= 2099) continue
    return n
  }
  return null
}

export function highestInvoiceSeq(invoices: { number?: string }[] | undefined): number {
  let max = 0
  for (const inv of invoices || []) {
    const s = parseInvoiceSeq(inv?.number)
    if (s != null && s > max) max = s
  }
  return max
}

export function nextInvoiceSeq(state: Pick<State, 'invoices' | 'meta'>): number {
  const fromInvoices = highestInvoiceSeq(state.invoices) + 1
  const floor = Number((state.meta as any)?.invoiceNumberStart) || 0
  return Math.max(fromInvoices, floor, 1)
}

export function padSeq(seq: number): string {
  return String(seq).padStart(3, '0')
}

export function nextInvoiceNumber(state: Pick<State, 'invoices' | 'meta'>, year: string): string {
  return `INV-${year}-${padSeq(nextInvoiceSeq(state))}`
}

/** Per-member inbound numbering, mirroring the team-invoice editor: the member's
 * initials (or id prefix) plus a zero-padded sequence derived from that member's
 * highest existing number. */
export function nextTeamInvoiceNumber(
  invoices: { memberId?: string; number?: string }[] | undefined,
  memberId: string,
  memberName: string,
): string {
  const mine = (invoices || []).filter((i) => i.memberId === memberId)
  const seq = highestInvoiceSeq(mine) + 1
  const initials =
    String(memberName || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3) || memberId.slice(0, 3).toUpperCase()
  return `${initials}-${padSeq(seq)}`
}
