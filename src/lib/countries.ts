// Country-aware bank field definitions for Team Invoices — ported verbatim.

export interface TiCountry {
  code: string
  name: string
  fields: string[]
}

export const TI_COUNTRIES: TiCountry[] = [
  { code: 'GB', name: 'United Kingdom (£)', fields: ['accountHolder', 'sortCode', 'accountNumber', 'bankName', 'bankAddress'] },
  { code: 'US', name: 'United States ($)', fields: ['accountHolder', 'routingNumber', 'accountNumber', 'bankName', 'bankAddress'] },
  { code: 'EU', name: 'EU country (€)', fields: ['accountHolder', 'iban', 'bic', 'bankName', 'bankAddress'] },
  { code: 'CA', name: 'Canada (CAD)', fields: ['accountHolder', 'transitNumber', 'institutionNumber', 'accountNumber', 'bankName', 'bankAddress'] },
  { code: 'AU', name: 'Australia (AUD)', fields: ['accountHolder', 'bsbCode', 'accountNumber', 'bankName', 'bankAddress'] },
  { code: 'PH', name: 'Philippines (₱)', fields: ['accountHolder', 'accountNumber', 'bankName', 'bic', 'bankAddress', 'mobileWallet', 'phMobileNumber'] },
  { code: 'OTHER', name: 'Other / International (IBAN+BIC)', fields: ['accountHolder', 'iban', 'bic', 'intermediaryBic', 'bankName', 'bankAddress'] },
]

export const TI_BANK_LABELS: Record<string, string> = {
  accountHolder: 'Account holder',
  sortCode: 'Sort code',
  accountNumber: 'Account number',
  routingNumber: 'Routing number (ABA)',
  iban: 'IBAN',
  bic: 'BIC / SWIFT',
  intermediaryBic: 'Intermediary BIC',
  transitNumber: 'Transit #',
  institutionNumber: 'Institution #',
  bsbCode: 'BSB code',
  bankName: 'Bank name',
  bankAddress: 'Bank address',
  mobileWallet: 'Mobile wallet (GCash / PayMaya / Maya)',
  phMobileNumber: 'Mobile wallet number (+63 …)',
}

export function tiCountry(code: string): TiCountry {
  return TI_COUNTRIES.find((c) => c.code === code) || TI_COUNTRIES[0]
}

export function tiBankFieldsFor(code: string): string[] {
  return tiCountry(code).fields
}

export function fmtTiMonth(id: string): string {
  if (!id) return '—'
  const [y, m] = id.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
}
