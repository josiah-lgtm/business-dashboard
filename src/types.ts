// ============================================================
// Full shape of the persisted `state` object.
// Kept byte-compatible with the legacy single-file app's localStorage
// (STORAGE_KEY = 'businessDashboard_v2') and cloud JSON.
// ============================================================

export type Currency = 'GBP' | 'USD' | 'EUR'
export type ViewId = 'overview' | 'expenses' | 'budget' | 'tasks' | 'invoices' | 'settings'

export interface FxRates {
  USD: number
  EUR: number
  [k: string]: number
}

export interface Meta {
  activeView: ViewId
  activeMonth: string // 'YYYY-MM'
  currency: Currency
  fxRates: FxRates // "1 GBP = X foreign"
  fxRate: number // legacy mirror of fxRates.USD
  invoiceCounter: number
  invoicesTab?: 'outbound' | 'inbound'
  cloudUpdatedAt?: string // ISO of last server sync
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
  date: string // 'YYYY-MM-DD'
  vendor: string
  category: string
  amount: number // original currency
  currency?: Currency
  month: string // 'YYYY-MM'
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
  monthlySalary: number // legacy
  commissionAmount: number // legacy
  active: boolean
  isFounder?: boolean
  email: string
  address: string
  country: string // ISO-ish: GB/US/EU/CA/AU/PH/OTHER
  bank: Record<string, string>
  password: string // plain, local-only
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
  number: string // 'INV-YYYY-###'
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
  period?: string // 'YYYY-MM'
  itemCategory?: string // 'Retainer service' | 'Commission services'
  services?: string
  hours?: number
  rate?: number
  amount: number
  taxPct?: number
  currency?: string // EUR | GBP | USD | PHP
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
  type: string // 'salary' | 'commission'
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
  // Deletion tombstones: `${collection}:${id}` → ISO time of deletion. Lets a
  // delete on one device propagate through the union merge instead of being
  // resurrected by another device that still has the entry.
  deletions: Record<string, string>
  cloudSync?: CloudSync
  _tiTab?: 'admin' | 'member'
}

// Result shape of calcMonth()
export interface MonthCalc {
  monthId: string
  adjRev: number
  grossProfit: number
  netProfit: number
  grossMarginPct: number
  netMarginPct: number
  marketingCosts: number
  deliveryCosts: number
  overheadCosts: number
  totalExpenses: number
  refundsTotal: number
  refundPct: number
  overheadPct: number
  taxReserve: number
  founderComp: number
  founderTaxReserve: number
  totalToSetAside: number
  categories: Record<string, number>
  cacOverall: number | null
  avgGpPerClient: number | null
  churnRate: number
  raw: Month
}
