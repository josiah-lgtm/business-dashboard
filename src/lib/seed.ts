// Constants + initial-state builder — ported verbatim from the legacy app.
import BACKFILL from '@/backfill.json'
import { uid, isoMonth } from './format'
import type { State, Business, Targets } from '@/types'

export const STORAGE_KEY = 'businessDashboard_v2'

export const DEFAULT_TARGETS: Targets = {
  gmPct: 60,
  nmPct: 25,
  taxPct: 15,
  cashMonths: 3,
  founderTaxPct: 20,
  refundPctMax: 10,
  overheadPctMax: 20,
}

export const DEFAULT_BUSINESS: Business = {
  name: 'JA JOZY MEDIA LTD',
  tradingAs: 'Agency Advanta',
  address: 'Evagora Pallikaridi 38, 8010, Paphos, Cyprus',
  companyNumber: '473306',
  taxId: 'CY60162230J',
  sin: '1849867',
  email: '',
  website: '',
  logoDataUrl: '', // empty -> use the bundled logo.png
  banks: {
    GBP: { holder: 'JA JOZY MEDIA LTD', sortCode: '23-01-20', accountNumber: '17850829', iban: '', bic: '', intermediaryBic: '', bank: 'Revolut Ltd', address: '7 Westferry Circus, E14 4HD, London, United Kingdom' },
    USD: { holder: 'JA JOZY MEDIA LTD', sortCode: '', accountNumber: '', iban: 'LT323250025509211395', bic: 'REVOLT21', intermediaryBic: 'CHASGB2L', bank: 'Revolut Bank UAB', address: 'Konstitucijos ave. 21B, 08130, Vilnius, Lithuania' },
    EUR: { holder: 'JA JOZY MEDIA LTD', sortCode: '', accountNumber: '', iban: 'LT323250025509211395', bic: 'REVOLT21', intermediaryBic: '', bank: 'Revolut Bank UAB', address: 'Konstitucijos ave. 21B, 08130, Vilnius, Lithuania' },
  },
}

export const TASK_STATUSES = [
  { id: 'todo', label: 'To do' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
] as const

const BF: any = BACKFILL

export function makeInitialState(): State {
  const months: State['months'] = {}
  Object.entries(BF.months).forEach(([id, m]: [string, any]) => {
    months[id] = {
      revenue: m.revenue || 0,
      merchantFees: m.merchantFees || 0,
      salariesTotal: m.salariesTotal || 0,
      commissionsTotal: m.commissionsTotal || 0,
      referralPayoutsTotal: m.referralPayoutsTotal || 0,
      refundsTotal: m.refundsTotal || 0,
      founderComp: 0,
      taxPct: m.taxPct ?? 15,
      newClients: 0,
      activeClients: 0,
      churnedClients: 0,
    }
  })
  const expenses = BF.expenses.map((e: any) => ({ id: uid(), ...e }))
  const vendors = BF.vendors.map((v: any) => ({ id: uid(), ...v }))
  const refunds = BF.refunds.map((r: any) => ({ id: uid(), ...r }))
  const team = BF.team.map((t: any) => ({
    id: uid(),
    ...t,
    monthlySalary: 0,
    active: true,
    email: '',
    address: '',
    country: 'GB',
    bank: {},
  }))
  const monthIds = Object.keys(months).sort()
  return {
    meta: {
      activeView: 'overview',
      activeMonth: monthIds[monthIds.length - 1] || isoMonth(new Date()),
      currency: 'GBP',
      fxRates: { USD: 1.27, EUR: 1.17 },
      fxRate: 1.27, // legacy mirror
      invoiceCounter: 1,
    },
    months,
    expenses,
    vendors,
    refunds,
    team,
    tasks: [],
    invoices: [],
    teamInvoices: [],
    teamInvoiceCounters: {},
    teamInvoiceMonths: {},
    teamInvoiceActiveMemberId: null,
    slackWebhookUrl: '',
    budgets: {},
    business: structuredClone(DEFAULT_BUSINESS),
    targets: { ...DEFAULT_TARGETS },
    revenueEntries: [],
    customBuckets: [],
    teamPayouts: [],
  }
}

export { BF as BACKFILL }
