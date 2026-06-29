// ============================================================
// Relational <-> blob translation.
//
// `decompose` splits a State blob into a neutral DbState (raw entities grouped
// by collection + the record-maps + workspace singletons). `reconstruct`
// rebuilds a State from a DbState. Both are PURE (no Prisma) so they are unit
// testable and the GET/POST round-trip can be asserted no-op.
//
// Each id-keyed entity is stored verbatim in its row's `raw` column, so
// reconstruction is lossless and the GET blob is byte-equivalent to what the
// client holds (no sync churn). The typed COLUMN projectors below feed the
// relational/reporting columns; they are derived from `raw` and never read back
// for sync. Per-device fields (cloudSync, teamInvoiceActiveMemberId, _tiTab,
// and the per-device meta keys) are intentionally NOT stored or reconstructed —
// the client merge keeps its own.
// ============================================================
import type { State } from './types.js'

/** State keys that are id-keyed collections (the order is the canonical order). */
export const ID_COLLECTIONS = [
  'expenses',
  'vendors',
  'refunds',
  'team',
  'tasks',
  'invoices',
  'teamInvoices',
  'revenueEntries',
  'customBuckets',
  'teamPayouts',
] as const
export type CollectionName = (typeof ID_COLLECTIONS)[number]

export interface WorkspaceSingletons {
  business: any
  targets: any
  fxRates: any
  fxRate: number
  invoiceCounter: number
  slackWebhookUrl: string
}

/** Neutral, Prisma-free representation of one workspace's stored data. */
export interface DbState {
  workspace: WorkspaceSingletons | null
  expenses: any[]
  vendors: any[]
  refunds: any[]
  team: any[]
  tasks: any[]
  invoices: any[]
  teamInvoices: any[]
  revenueEntries: any[]
  customBuckets: any[]
  teamPayouts: any[]
  months: Record<string, any>
  budgets: Record<string, any>
  teamInvoiceCounters: Record<string, number>
  teamInvoiceMonths: Record<string, any>
  deletions: Record<string, string>
}

export function emptyDbState(): DbState {
  return {
    workspace: null,
    expenses: [],
    vendors: [],
    refunds: [],
    team: [],
    tasks: [],
    invoices: [],
    teamInvoices: [],
    revenueEntries: [],
    customBuckets: [],
    teamPayouts: [],
    months: {},
    budgets: {},
    teamInvoiceCounters: {},
    teamInvoiceMonths: {},
    deletions: {},
  }
}

// ---- decompose: State -> DbState --------------------------------------------

export function decompose(state: State): DbState {
  const db = emptyDbState()
  db.workspace = {
    business: state.business ?? null,
    targets: state.targets ?? null,
    fxRates: state.meta?.fxRates ?? null,
    fxRate: Number(state.meta?.fxRate) || 0,
    invoiceCounter: Number(state.meta?.invoiceCounter) || 1,
    slackWebhookUrl: state.slackWebhookUrl ?? '',
  }
  for (const coll of ID_COLLECTIONS) {
    const arr = Array.isArray((state as any)[coll]) ? (state as any)[coll] : []
    ;(db as any)[coll] = arr.filter((e: any) => e && e.id != null)
  }
  db.months = isObj(state.months) ? state.months : {}
  db.budgets = isObj(state.budgets) ? state.budgets : {}
  db.teamInvoiceCounters = isObj(state.teamInvoiceCounters) ? state.teamInvoiceCounters : {}
  db.teamInvoiceMonths = isObj(state.teamInvoiceMonths) ? state.teamInvoiceMonths : {}
  db.deletions = isObj(state.deletions) ? state.deletions : {}
  return db
}

// ---- reconstruct: DbState -> State (byte-equivalent, shared fields only) -----

export function reconstruct(db: DbState): State {
  const ws = db.workspace
  const state: any = {
    meta: {
      fxRates: ws?.fxRates ?? { USD: 1.27, EUR: 1.17 },
      fxRate: ws?.fxRate ?? 1.27,
      invoiceCounter: ws?.invoiceCounter ?? 1,
    },
    months: db.months || {},
    expenses: db.expenses || [],
    vendors: db.vendors || [],
    refunds: db.refunds || [],
    team: db.team || [],
    tasks: db.tasks || [],
    invoices: db.invoices || [],
    teamInvoices: db.teamInvoices || [],
    teamInvoiceCounters: db.teamInvoiceCounters || {},
    teamInvoiceMonths: db.teamInvoiceMonths || {},
    slackWebhookUrl: ws?.slackWebhookUrl ?? '',
    budgets: db.budgets || {},
    business: ws?.business ?? null,
    targets: ws?.targets ?? null,
    revenueEntries: db.revenueEntries || [],
    customBuckets: db.customBuckets || [],
    teamPayouts: db.teamPayouts || [],
    deletions: db.deletions || {},
  }
  return state as State
}

/** True if the DbState has never been written (used to return value:null on GET). */
export function isEmptyDb(db: DbState): boolean {
  if (db.workspace) return false
  for (const coll of ID_COLLECTIONS) if (((db as any)[coll] as any[]).length) return false
  if (Object.keys(db.months).length) return false
  if (Object.keys(db.budgets).length) return false
  if (Object.keys(db.teamInvoiceCounters).length) return false
  if (Object.keys(db.teamInvoiceMonths).length) return false
  if (Object.keys(db.deletions).length) return false
  return true
}

// ---- snapshot helper: strip plaintext passwords ------------------------------

export function stripPasswords(state: State): State {
  const clone: any = { ...state }
  if (Array.isArray(state.team)) {
    clone.team = state.team.map((m: any) => {
      if (m && 'password' in m) {
        const { password, ...rest } = m
        return rest
      }
      return m
    })
  }
  return clone as State
}

// ---- column projectors (relational/reporting columns derived from raw) -------
// Each returns the typed columns for a row (excluding workspaceId/id/raw, which
// the store adds). Defensive coercion keeps one malformed entity from failing a
// whole POST transaction.

const str = (v: any, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v))
const optStr = (v: any): string | null => (typeof v === 'string' ? v : v == null ? null : String(v))
const num = (v: any, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d)
const optNum = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null)
const bool = (v: any, d = false): boolean => (typeof v === 'boolean' ? v : d)
const isObj = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v)

export const COLUMN_PROJECTORS: Record<CollectionName, (e: any) => Record<string, any>> = {
  expenses: (e) => ({
    date: str(e.date),
    vendor: str(e.vendor),
    category: str(e.category),
    amount: num(e.amount),
    currency: optStr(e.currency),
    month: str(e.month),
  }),
  vendors: (e) => ({
    name: str(e.name),
    category: str(e.category),
    typicalAmount: num(e.typicalAmount),
    recurring: bool(e.recurring),
  }),
  refunds: (e) => ({
    month: str(e.month),
    date: optStr(e.date),
    recipient: str(e.recipient),
    amount: num(e.amount),
    currency: optStr(e.currency),
  }),
  team: (e) => ({
    name: str(e.name),
    role: str(e.role),
    payType: str(e.payType, 'salary'),
    amount: num(e.amount),
    monthlySalary: num(e.monthlySalary),
    commissionAmount: num(e.commissionAmount),
    active: bool(e.active, true),
    isFounder: typeof e.isFounder === 'boolean' ? e.isFounder : null,
    email: str(e.email),
    address: str(e.address),
    country: str(e.country, 'GB'),
    bank: isObj(e.bank) ? e.bank : {},
    // password intentionally excluded — see schema note.
  }),
  tasks: (e) => ({
    title: str(e.title),
    status: str(e.status, 'todo'),
    linkedVendorId: optStr(e.linkedVendorId),
    action: str(e.action),
    notes: str(e.notes),
    createdAt: str(e.createdAt),
  }),
  invoices: (e) => ({
    number: str(e.number),
    date: str(e.date),
    status: str(e.status, 'draft'),
    currency: str(e.currency, 'GBP'),
    client: isObj(e.client) ? e.client : {},
    items: Array.isArray(e.items) ? e.items : [],
    subtotal: num(e.subtotal),
    taxPct: num(e.taxPct),
    tax: num(e.tax),
    total: num(e.total),
    notes: str(e.notes),
    clientUpdatedAt: optStr(e.updatedAt),
  }),
  teamInvoices: (e) => ({
    memberId: str(e.memberId),
    number: str(e.number),
    date: str(e.date),
    dueDate: optStr(e.dueDate),
    period: optStr(e.period),
    itemCategory: optStr(e.itemCategory),
    services: optStr(e.services),
    hours: optNum(e.hours),
    rate: optNum(e.rate),
    amount: num(e.amount),
    taxPct: optNum(e.taxPct),
    currency: optStr(e.currency),
    notes: optStr(e.notes),
    status: str(e.status, 'draft'),
    createdAt: optStr(e.createdAt),
    clientUpdatedAt: optStr(e.updatedAt),
    acceptedAt: optStr(e.acceptedAt),
    declinedAt: optStr(e.declinedAt),
  }),
  revenueEntries: (e) => ({
    month: str(e.month),
    date: str(e.date),
    amount: num(e.amount),
    source: str(e.source),
    notes: str(e.notes),
    legacy: typeof e._legacy === 'boolean' ? e._legacy : null,
  }),
  customBuckets: (e) => ({
    name: str(e.name),
    color: str(e.color),
    icon: optStr(e.icon),
    kind: optStr(e.kind),
    categoryMap: optStr(e.categoryMap),
    fallbackMonthField: optStr(e.fallbackMonthField),
  }),
  teamPayouts: (e) => ({
    memberId: str(e.memberId),
    month: str(e.month),
    date: str(e.date),
    amount: num(e.amount),
    type: str(e.type),
    invoiceId: optStr(e.invoiceId),
    invoiceNumber: optStr(e.invoiceNumber),
    notes: optStr(e.notes),
  }),
}

export function monthColumns(m: any): Record<string, any> {
  return {
    revenue: num(m.revenue),
    merchantFees: num(m.merchantFees),
    salariesTotal: num(m.salariesTotal),
    commissionsTotal: num(m.commissionsTotal),
    referralPayoutsTotal: num(m.referralPayoutsTotal),
    refundsTotal: num(m.refundsTotal),
    founderComp: num(m.founderComp),
    taxPct: num(m.taxPct),
    newClients: num(m.newClients),
    activeClients: num(m.activeClients),
    churnedClients: num(m.churnedClients),
  }
}

export function budgetColumns(b: any): { savedAt: string | null; data: any } {
  const { _savedAt, ...rest } = isObj(b) ? b : {}
  return { savedAt: optStr(_savedAt), data: rest }
}
