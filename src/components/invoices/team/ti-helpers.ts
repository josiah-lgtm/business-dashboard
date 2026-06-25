// Shared Team-Invoice helpers — replicated locally so the Invoices view owns
// no shared-file edits. Mirrors the legacy fhRecalcTeamTotals + the TI payout
// upsert / accept / decline business logic.
import { uid, isoDate } from '@/lib/format'
import type { State, TeamInvoice, TeamPayout } from '@/types'

// Initials for avatars / invoice numbers, e.g. "Zahi Davis" → "ZD".
export function tiInitials(name?: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0] || '').slice(0, 1) + (parts[1] || '').slice(0, 1)).toUpperCase() || (parts[0] || '?').slice(0, 1).toUpperCase()
}

// Per-member sequential invoice number: "{INITIALS}-{NNN}" e.g. "ZD-003".
export function tiNextInvoiceNumber(state: State, memberId: string): string {
  state.teamInvoiceCounters = state.teamInvoiceCounters || {}
  const next = (state.teamInvoiceCounters[memberId] || 0) + 1
  state.teamInvoiceCounters[memberId] = next
  const m = state.team.find((t) => t.id === memberId)
  const parts = (m?.name || 'XX').split(/\s+/).filter(Boolean)
  const initials = ((parts[0] || 'X').slice(0, 1) + (parts[1] || parts[0] || 'X').slice(0, 1)).toUpperCase()
  return `${initials}-${String(next).padStart(3, '0')}`
}

// Recalculate state.months[m].salariesTotal + commissionsTotal from payouts.
// Mirrors the legacy fhRecalcTeamTotals (owned by the Finance agent).
export function fhRecalcTeamTotals(state: State, monthId: string): void {
  const payouts = (state.teamPayouts || []).filter((p) => p.month === monthId)
  if (!payouts.length) return // leave legacy totals alone if no per-member payouts
  const sal = payouts.filter((p) => p.type === 'salary').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const com = payouts.filter((p) => p.type === 'commission').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  if (state.months[monthId]) {
    state.months[monthId].salariesTotal = sal
    state.months[monthId].commissionsTotal = com
  }
}

export function tiInvoiceHasPayout(state: State, iid: string): boolean {
  return (state.teamPayouts || []).some((p) => p.invoiceId === iid)
}

// Create / refresh the team payout that mirrors an invoice into the Finance
// hub Team bucket. Returns the payout (or null + alert on failure). Does NOT
// change the invoice status — that's the Accept flow's job.
export function tiAddInvoiceToTeamExpense(state: State, iid: string, overrideAmount?: number): TeamPayout | null {
  const inv = (state.teamInvoices || []).find((i) => i.id === iid)
  if (!inv) return null
  const finalAmount = Number(overrideAmount) || Number(inv.amount) || 0
  if (!finalAmount) {
    alert('Set an amount on the invoice first.')
    return null
  }
  const cat = (inv.itemCategory || 'Commission').toLowerCase()
  const isSalary = cat.includes('retainer') || cat.includes('salary')
  const payoutType = isSalary ? 'salary' : 'commission'
  state.months = state.months || {}
  const period = inv.period || (inv.date || '').slice(0, 7)
  if (!period) {
    alert('Invoice has no period — set a month before adding to team expenses.')
    return null
  }
  if (!state.months[period]) {
    state.months[period] = {
      revenue: 0,
      merchantFees: 0,
      salariesTotal: 0,
      commissionsTotal: 0,
      referralPayoutsTotal: 0,
      refundsTotal: 0,
      founderComp: 0,
      taxPct: state.targets?.taxPct ?? 15,
      newClients: 0,
      activeClients: 0,
      churnedClients: 0,
    }
  }
  state.teamPayouts = state.teamPayouts || []
  let payout = state.teamPayouts.find((p) => p.invoiceId === inv.id)
  if (payout) {
    payout.amount = finalAmount
    payout.type = payoutType
    payout.month = period
    payout.date = isoDate(new Date())
    payout.invoiceNumber = inv.number
  } else {
    payout = {
      id: uid(),
      memberId: inv.memberId,
      month: period,
      date: isoDate(new Date()),
      amount: finalAmount,
      type: payoutType,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      notes: `From invoice #${inv.number}`,
    }
    state.teamPayouts.push(payout)
  }
  fhRecalcTeamTotals(state, period)
  return payout
}

// Slack post for a pending-review invoice. Returns true on a 2xx response.
export function tiPostToSlack(state: State, inv: TeamInvoice): Promise<boolean> {
  const url = (state.slackWebhookUrl || '').trim()
  if (!url) return Promise.resolve(false)
  const m = state.team.find((t) => t.id === inv.memberId)
  const sym = inv.currency === 'USD' ? '$' : inv.currency === 'EUR' ? '€' : inv.currency === 'PHP' ? '₱' : '£'
  const amt = sym + (Number(inv.amount) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtPeriod = (id?: string) => {
    if (!id) return '—'
    const [y, mo] = id.split('-').map(Number)
    return new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  }
  const text = `💰 *Invoice pending review*\n*${m ? m.name : 'Unknown'}* — ${amt} · ${inv.number}\nFor: ${fmtPeriod(inv.period)} (${inv.itemCategory || 'Commission'})${inv.services ? ' · ' + inv.services.slice(0, 200) : ''}\nReview & accept in the dashboard.`
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then((r) => r.ok)
    .catch(() => false)
}
