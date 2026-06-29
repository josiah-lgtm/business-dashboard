// Ported from the SPA's src/types.ts — the shape of the synced `State` blob.
// Kept in sync with the frontend; the backend treats most entities opaquely
// (stored verbatim in each row's `raw` column) and only reads specific fields
// for the relational/reporting projection in serialize.ts.

export type Currency = 'GBP' | 'USD' | 'EUR'
export type ViewId = 'overview' | 'expenses' | 'budget' | 'tasks' | 'invoices' | 'settings'

export interface FxRates {
  USD: number
  EUR: number
  [k: string]: number
}

export interface Meta {
  activeView: ViewId
  activeMonth: string
  currency: Currency
  fxRates: FxRates
  fxRate: number
  invoiceCounter: number
  invoicesTab?: 'outbound' | 'inbound'
  cloudUpdatedAt?: string
}

export interface Month {
  revenue: number
  merchantFees: number
  salariesTotal: number
  commissionsTotal: number
  referralPayoutsTotal: number
  refundsTotal: number
  founderComp: number
  taxPct: number
  newClients: number
  activeClients: number
  churnedClients: number
}

export interface Expense {
  id: string
  date: string
  vendor: string
  category: string
  amount: number
  currency?: Currency
  month: string
}

export interface Vendor {
  id: string
  name: string
  category: string
  typicalAmount: number
  recurring: boolean
}

export interface Refund {
  id: string
  month: string
  date?: string
  recipient: string
  amount: number
  currency?: Currency
}

export interface TeamMember {
  id: string
  name: string
  role: string
  payType: 'salary' | 'commission'
  amount: number
  monthlySalary: number
  commissionAmount: number
  active: boolean
  isFounder?: boolean
  email: string
  address: string
  country: string
  bank: Record<string, string>
  password: string
}

export interface Task {
  id: string
  title: string
  status: 'todo' | 'in-progress' | 'done' | 'cancelled'
  linkedVendorId: string | null
  action: string
  notes: string
  createdAt: string
}

export interface InvoiceItem {
  description: string
  qty: number
  rate: number
}

export interface Invoice {
  id: string
  number: string
  date: string
  status: 'draft' | 'sent' | 'paid'
  currency: Currency
  client: { name: string; email: string; address: string }
  items: InvoiceItem[]
  subtotal: number
  taxPct: number
  tax: number
  total: number
  notes: string
  updatedAt?: string
}

export interface TeamInvoice {
  id: string
  memberId: string
  number: string
  date: string
  dueDate?: string
  period?: string
  itemCategory?: string
  services?: string
  hours?: number
  rate?: number
  amount: number
  taxPct?: number
  currency?: string
  notes?: string
  status: 'draft' | 'pending' | 'accepted' | 'paid' | 'submitted'
  createdAt?: string
  updatedAt?: string
  acceptedAt?: string
  declinedAt?: string
}

export interface Budget {
  _savedAt?: string
  [key: string]: number | string | undefined
}

export interface BankAccount {
  holder: string
  sortCode: string
  accountNumber: string
  iban: string
  bic: string
  intermediaryBic: string
  bank: string
  address: string
}

export interface Business {
  name: string
  tradingAs: string
  address: string
  companyNumber: string
  taxId: string
  sin: string
  email: string
  website: string
  logoDataUrl: string
  banks: Record<string, BankAccount>
}

export interface Targets {
  gmPct: number
  nmPct: number
  taxPct: number
  founderTaxPct: number
  cashMonths: number
  refundPctMax: number
  overheadPctMax: number
}

export interface RevenueEntry {
  id: string
  month: string
  date: string
  amount: number
  source: string
  notes: string
  _legacy?: boolean
}

export interface CustomBucket {
  id: string
  name: string
  color: string
  icon?: string
  kind?: 'expense' | 'team' | 'refund'
  categoryMap?: string
  fallbackMonthField?: string
}

export interface TeamPayout {
  id: string
  memberId: string
  month: string
  date: string
  amount: number
  type: string
  invoiceId?: string
  invoiceNumber?: string
  notes?: string
}

export interface CloudSync {
  url: string
  key: string
  enabled: boolean
}

export interface State {
  meta: Meta
  months: Record<string, Month>
  expenses: Expense[]
  vendors: Vendor[]
  refunds: Refund[]
  team: TeamMember[]
  tasks: Task[]
  invoices: Invoice[]
  teamInvoices: TeamInvoice[]
  teamInvoiceCounters: Record<string, number>
  teamInvoiceMonths: Record<string, any>
  teamInvoiceActiveMemberId: string | null
  slackWebhookUrl: string
  budgets: Record<string, Budget>
  business: Business
  targets: Targets
  revenueEntries: RevenueEntry[]
  customBuckets: CustomBucket[]
  teamPayouts: TeamPayout[]
  deletions: Record<string, string>
  cloudSync?: CloudSync
  _tiTab?: 'admin' | 'member'
}
