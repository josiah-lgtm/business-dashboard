import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStates } from './merge.js'
import type { State } from './types.js'

function base(): State {
  return {
    meta: { activeView: 'overview', activeMonth: '2026-01', currency: 'GBP', fxRates: { USD: 1.27, EUR: 1.17 }, fxRate: 1.27, invoiceCounter: 1 },
    months: {},
    expenses: [],
    vendors: [],
    refunds: [],
    team: [],
    tasks: [],
    invoices: [],
    teamInvoices: [],
    teamInvoiceCounters: {},
    teamInvoiceMonths: {},
    teamInvoiceActiveMemberId: null,
    slackWebhookUrl: '',
    budgets: {},
    business: { name: 'Acme', tradingAs: '', address: '', companyNumber: '', taxId: '', sin: '', email: '', website: '', logoDataUrl: '', banks: {} },
    targets: { gmPct: 0, nmPct: 0, taxPct: 0, founderTaxPct: 20, cashMonths: 0, refundPctMax: 0, overheadPctMax: 0 },
    revenueEntries: [],
    customBuckets: [],
    teamPayouts: [],
    deletions: {},
  }
}

test('union never drops entries from either side', () => {
  const local = base()
  local.expenses = [{ id: 'a', date: '2026-01-01', vendor: 'V', category: 'C', amount: 1, month: '2026-01' }]
  const remote = base()
  remote.expenses = [{ id: 'b', date: '2026-01-02', vendor: 'V', category: 'C', amount: 2, month: '2026-01' }]
  const { merged } = mergeStates(local, remote, { preferRemote: true })
  const ids = merged.expenses.map((e) => e.id).sort()
  assert.deepEqual(ids, ['a', 'b'])
})

test('per-entity timestamp dominates the preferRemote tiebreak', () => {
  const local = base()
  const remote = base()
  const mk = (updatedAt: string, total: number): any => ({
    id: 'i1', number: 'INV-1', date: '2026-01-01', status: 'sent', currency: 'GBP',
    client: { name: '', email: '', address: '' }, items: [], subtotal: total, taxPct: 0, tax: 0, total, notes: '', updatedAt,
  })
  // local is NEWER -> local wins even though preferRemote is true
  local.invoices = [mk('2026-01-10T00:00:00Z', 10)]
  remote.invoices = [mk('2026-01-05T00:00:00Z', 5)]
  const a = mergeStates(local, remote, { preferRemote: true })
  assert.equal(a.merged.invoices[0].total, 10)
  // remote NEWER -> remote wins
  local.invoices = [mk('2026-01-05T00:00:00Z', 5)]
  remote.invoices = [mk('2026-01-10T00:00:00Z', 10)]
  const b = mergeStates(local, remote, { preferRemote: true })
  assert.equal(b.merged.invoices[0].total, 10)
})

test('tombstone deletes win and propagate', () => {
  const local = base()
  local.expenses = [{ id: 'x', date: '2026-01-01', vendor: 'V', category: 'C', amount: 1, month: '2026-01' }]
  const remote = base()
  remote.deletions = { 'expenses:x': '2026-02-01T00:00:00Z' }
  const { merged } = mergeStates(local, remote, { preferRemote: true })
  assert.equal(merged.expenses.length, 0)
  assert.equal(merged.deletions['expenses:x'], '2026-02-01T00:00:00Z')
})

test('invoice counters take the MAX (never reused)', () => {
  const local = base()
  local.teamInvoiceCounters = { acme: 5 }
  local.meta.invoiceCounter = 7
  const remote = base()
  remote.teamInvoiceCounters = { acme: 3 }
  remote.meta.invoiceCounter = 4
  const { merged } = mergeStates(local, remote, { preferRemote: true })
  assert.equal(merged.teamInvoiceCounters.acme, 5)
  assert.equal(merged.meta.invoiceCounter, 7)
})

test('months map unions and tombstoned month is dropped', () => {
  const local = base()
  local.months = { '2026-01': anyMonth(100) }
  const remote = base()
  remote.months = { '2026-02': anyMonth(200) }
  remote.deletions = { 'months:2026-01': '2026-03-01T00:00:00Z' }
  const { merged } = mergeStates(local, remote, { preferRemote: true })
  assert.deepEqual(Object.keys(merged.months), ['2026-02'])
})

function anyMonth(revenue: number): any {
  return {
    revenue, merchantFees: 0, salariesTotal: 0, commissionsTotal: 0, referralPayoutsTotal: 0,
    refundsTotal: 0, founderComp: 0, taxPct: 0, newClients: 0, activeClients: 0, churnedClients: 0,
  }
}
