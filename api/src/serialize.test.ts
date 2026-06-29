import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decompose, reconstruct, stripPasswords, COLUMN_PROJECTORS, budgetColumns } from './serialize.js'
import { mergeStates } from './merge.js'
import type { State } from './types.js'

function fullState(): State {
  return {
    meta: { activeView: 'budget', activeMonth: '2026-01', currency: 'USD', fxRates: { USD: 1.3, EUR: 1.15 }, fxRate: 1.3, invoiceCounter: 9, invoicesTab: 'inbound', cloudUpdatedAt: '2026-01-01T00:00:00Z' },
    months: { '2026-01': { revenue: 1000, merchantFees: 10, salariesTotal: 100, commissionsTotal: 20, referralPayoutsTotal: 5, refundsTotal: 2, founderComp: 50, taxPct: 15, newClients: 3, activeClients: 30, churnedClients: 1 } },
    expenses: [{ id: 'e1', date: '2026-01-05', vendor: 'AWS', category: 'Software', amount: 42.5, currency: 'USD', month: '2026-01' }],
    vendors: [{ id: 'v1', name: 'AWS', category: 'Software', typicalAmount: 40, recurring: true }],
    refunds: [{ id: 'r1', month: '2026-01', date: '2026-01-09', recipient: 'Bob', amount: 9, currency: 'GBP' }],
    team: [{ id: 't1', name: 'Ann', role: 'CSM', payType: 'salary', amount: 3000, monthlySalary: 3000, commissionAmount: 0, active: true, isFounder: false, email: 'a@x.com', address: '1 St', country: 'GB', bank: { iban: 'GB00' }, password: 'sekret' }],
    tasks: [{ id: 'k1', title: 'Do', status: 'todo', linkedVendorId: null, action: '', notes: '', createdAt: '2026-01-01T00:00:00Z' }],
    invoices: [{ id: 'i1', number: 'INV-2026-001', date: '2026-01-03', status: 'sent', currency: 'GBP', client: { name: 'C', email: 'c@x.com', address: 'X' }, items: [{ description: 'svc', qty: 1, rate: 100 }], subtotal: 100, taxPct: 0, tax: 0, total: 100, notes: '', updatedAt: '2026-01-04T00:00:00Z' }],
    teamInvoices: [{ id: 'ti1', memberId: 't1', number: 'M-1', date: '2026-01-02', amount: 3000, status: 'paid', currency: 'GBP', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }],
    teamInvoiceCounters: { t1: 4 },
    teamInvoiceMonths: { '2026-01': true },
    teamInvoiceActiveMemberId: 't1',
    slackWebhookUrl: 'https://hooks.example/abc',
    budgets: { '2026-01': { _savedAt: '2026-01-06T00:00:00Z', Software: 50, Marketing: 200 } },
    business: { name: 'Acme', tradingAs: 'Acme Co', address: 'HQ', companyNumber: '123', taxId: 'T', sin: 'S', email: 'e@x.com', website: 'x.com', logoDataUrl: 'data:img', banks: { GBP: { holder: 'Acme', sortCode: '00', accountNumber: '1', iban: '', bic: '', intermediaryBic: '', bank: 'B', address: 'A' } } },
    targets: { gmPct: 70, nmPct: 30, taxPct: 15, founderTaxPct: 20, cashMonths: 6, refundPctMax: 5, overheadPctMax: 20 },
    revenueEntries: [{ id: 're1', month: '2026-01', date: '2026-01-01', amount: 1000, source: 'Stripe', notes: '', _legacy: true }],
    customBuckets: [{ id: 'cb1', name: 'Tools', color: '#fff', icon: 'wrench', kind: 'expense' }],
    teamPayouts: [{ id: 'tp1', memberId: 't1', month: '2026-01', date: '2026-01-28', amount: 3000, type: 'salary' }],
    deletions: { 'vendors:old1': '2026-01-01T00:00:00Z' },
    cloudSync: { url: '/api/external/kv', key: 'bd-shared', enabled: true },
    _tiTab: 'admin',
  }
}

test('reconstruct(decompose(blob)) preserves all shared data verbatim', () => {
  const blob = fullState()
  const got = reconstruct(decompose(blob))
  for (const coll of ['months', 'expenses', 'vendors', 'refunds', 'team', 'tasks', 'invoices', 'teamInvoices', 'revenueEntries', 'customBuckets', 'teamPayouts', 'teamInvoiceCounters', 'teamInvoiceMonths', 'budgets', 'business', 'targets', 'deletions', 'slackWebhookUrl'] as const) {
    assert.deepEqual((got as any)[coll], (blob as any)[coll], `mismatch in ${coll}`)
  }
  assert.deepEqual(got.meta, { fxRates: blob.meta.fxRates, fxRate: blob.meta.fxRate, invoiceCounter: blob.meta.invoiceCounter })
})

test('reconstruct omits per-device fields', () => {
  const got: any = reconstruct(decompose(fullState()))
  assert.equal('cloudSync' in got, false)
  assert.equal('teamInvoiceActiveMemberId' in got, false)
  assert.equal('_tiTab' in got, false)
  assert.equal('activeView' in got.meta, false)
  assert.equal('cloudUpdatedAt' in got.meta, false)
})

test('GET/POST round-trip is a no-op for the client merge (no churn)', () => {
  const blob = fullState()
  const current = reconstruct(decompose(blob)) // what GET would return
  const { changed } = mergeStates(current, blob, { preferRemote: true })
  assert.equal(changed, false)
})

test('stripPasswords removes team passwords only', () => {
  const blob = fullState()
  const stripped: any = stripPasswords(blob)
  assert.equal('password' in stripped.team[0], false)
  assert.equal(stripped.team[0].name, 'Ann')
  // original untouched
  assert.equal(blob.team[0].password, 'sekret')
})

test('column projectors never expose password and coerce types', () => {
  const cols: any = COLUMN_PROJECTORS.team(fullState().team[0])
  assert.equal('password' in cols, false)
  assert.equal(cols.amount, 3000)
  assert.equal(cols.active, true)
})

test('budgetColumns splits _savedAt from the dynamic data', () => {
  const { savedAt, data } = budgetColumns({ _savedAt: '2026-01-06T00:00:00Z', Software: 50 })
  assert.equal(savedAt, '2026-01-06T00:00:00Z')
  assert.deepEqual(data, { Software: 50 })
})
