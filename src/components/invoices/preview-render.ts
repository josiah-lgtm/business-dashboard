// Print/PDF preview renderers for invoices — ported verbatim from the legacy
// app (showInvoicePreview + showTiInvoicePreview). These return HTML strings
// rendered via v-html into the printable .invoice-print element. No
// interactivity here beyond the Print/Close buttons (wired by the host).
import { escapeHtml, fmtDate } from '@/lib/format'
import { tiCountry, TI_BANK_LABELS } from '@/lib/countries'
import type { Invoice, TeamInvoice, Business, TeamMember } from '@/types'

// Default Agency Advanta AA logo — bundled logo.png in the repo (empty
// business.logoDataUrl falls back to this).
const AA_LOGO_SVG = `<img src="logo.png" alt="Agency Advanta" style="max-width:100%;max-height:100%;object-fit:contain" />`

function symFor(c?: string): string {
  return c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'PHP' ? '₱' : '£'
}

// ---- Outbound (client) invoice preview ----
export function renderOutboundPreview(inv: Invoice, b: Business): string {
  const bank: any = (b.banks && b.banks[inv.currency]) || {}
  const sym = symFor(inv.currency)
  const fmt = (v: number) => sym + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const logoHtml = b.logoDataUrl ? `<img src="${b.logoDataUrl}" alt="logo" />` : AA_LOGO_SVG
  const bankRows: [string, string][] = [
    ['Account holder', bank.holder],
    ['Bank', bank.bank],
    ['IBAN', bank.iban],
    ['BIC / SWIFT', bank.bic],
    ['Intermediary BIC', bank.intermediaryBic],
    ['Sort code', bank.sortCode],
    ['Account number', bank.accountNumber],
    ['Bank address', bank.address],
  ].filter((r) => r[1]) as [string, string][]
  return `
    <div class="inv-actions-bar">
      <button data-act="print" class="primary">Print / Save as PDF</button>
      <button data-act="close">Close</button>
    </div>
    <div class="inv-header">
      <div class="inv-logo">${logoHtml}</div>
      <div class="inv-meta">
        <div><strong>${escapeHtml(b.tradingAs || b.name)}</strong></div>
        ${b.tradingAs ? `<div style="font-size:11px">${escapeHtml(b.name)}</div>` : ''}
        <div>${escapeHtml(b.address)}</div>
        ${b.companyNumber ? `<div>Company No: ${escapeHtml(b.companyNumber)}</div>` : ''}
        ${b.taxId ? `<div>Tax ID: ${escapeHtml(b.taxId)}</div>` : ''}
        ${b.email ? `<div>${escapeHtml(b.email)}</div>` : ''}
      </div>
    </div>
    <div style="margin-bottom:24px">
      <span class="inv-status ${inv.status}">${inv.status}</span>
      <h1 style="margin-top:4px">Invoice ${escapeHtml(inv.number)}</h1>
      <div style="color:#555;font-size:13px">Date: ${fmtDate(inv.date)}</div>
    </div>
    <div class="inv-from-to">
      <div class="inv-block">
        <h4>Bill to</h4>
        <div class="name">${escapeHtml(inv.client.name)}</div>
        ${inv.client.email ? `<div class="line">${escapeHtml(inv.client.email)}</div>` : ''}
        ${inv.client.address ? `<div class="line" style="white-space:pre-line">${escapeHtml(inv.client.address)}</div>` : ''}
      </div>
      <div class="inv-block" style="text-align:right">
        <h4>From</h4>
        <div class="name">${escapeHtml(b.tradingAs || b.name)}</div>
        <div class="line" style="white-space:pre-line">${escapeHtml(b.address)}</div>
      </div>
    </div>
    <table class="items">
      <thead><tr><th style="width:55%">Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${inv.items
          .map(
            (i) => `<tr>
          <td>${escapeHtml(i.description)}</td>
          <td class="num">${(i.qty || 0).toLocaleString('en-GB')}</td>
          <td class="num">${fmt(i.rate || 0)}</td>
          <td class="num">${fmt((i.qty || 0) * (i.rate || 0))}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="3" class="num" style="color:#888">Subtotal</td><td class="num">${fmt(inv.subtotal)}</td></tr>
        ${inv.taxPct ? `<tr><td colspan="3" class="num" style="color:#888">Tax (${inv.taxPct}%)</td><td class="num">${fmt(inv.tax)}</td></tr>` : ''}
        <tr class="grand"><td colspan="3" class="num">Total ${inv.currency}</td><td class="num">${fmt(inv.total)}</td></tr>
      </tfoot>
    </table>
    ${inv.notes ? `<div class="inv-notes">${escapeHtml(inv.notes)}</div>` : ''}
    ${
      bankRows.length
        ? `<div class="inv-bank">
      <h4>Payment details — ${inv.currency} account</h4>
      ${bankRows.map(([l, v]) => `<div class="bank-row"><span class="lbl">${l}</span><span class="val">${escapeHtml(v)}</span></div>`).join('')}
    </div>`
        : ''
    }
    <div class="inv-footer">
      ${escapeHtml(b.name)} · Company No. ${escapeHtml(b.companyNumber || '')} · ${escapeHtml(b.taxId || '')}
    </div>
  `
}

// ---- Inbound (contractor / team) invoice preview ----
export function renderTiPreview(inv: TeamInvoice, m: TeamMember, b: Business): string {
  const sym = symFor(inv.currency)
  const fmtMoney = (n: number) => sym + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtMoneyExact = fmtMoney
  const fmtDDMMYYYY = (iso?: string) => {
    if (!iso) return '—'
    const [y, mo, d] = iso.split('-')
    return `${d}/${mo}/${y}`
  }

  // Footer "PAYABLE VIA BANK TRANSFER" block — bank details in a specific
  // order: Account name → Account number → Sort code → anything else.
  const c = tiCountry(m.country)
  const bank: Record<string, string> = (m.bank as any) || {}
  const accountHolder = bank.accountHolder || m.name
  const PRIORITY = ['accountNumber', 'sortCode', 'routingNumber']
  const seen = new Set<string>()
  const footerBankLines: string[] = []
  footerBankLines.push(`Account name: ${accountHolder}`)
  PRIORITY.forEach((f) => {
    if (!c.fields.includes(f)) return
    const v = bank[f]
    if (v) {
      footerBankLines.push(`${TI_BANK_LABELS[f] || f}: ${v}`)
      seen.add(f)
    }
  })
  c.fields.forEach((f) => {
    if (seen.has(f) || f === 'accountHolder') return
    const label = TI_BANK_LABELS[f] || f
    if (label === 'Bank name' || label === 'Bank address') return
    const v = bank[f]
    if (v) footerBankLines.push(`${label}: ${v}`)
  })

  const taxPct = Number(inv.taxPct) || 0
  const amount = Number(inv.amount) || 0
  const taxAmount = amount * (taxPct / 100)
  const total = amount + taxAmount

  return `
    <div class="contractor-invoice-shell">
      <div class="inv-actions-bar">
        <button data-act="print" class="primary">Print / Save as PDF</button>
        <button data-act="close">Close</button>
      </div>

      <div class="ci-header">
        <div class="ci-title">Contractor<br/>Invoice</div>
        <div class="ci-meta">
          <div class="lbl">INVOICE #</div>
          <div class="val">${escapeHtml(inv.number)}</div>
          <div class="lbl">DATE</div>
          <div class="val">${fmtDDMMYYYY(inv.date)}</div>
          <div class="lbl">INVOICE DUE DATE</div>
          <div class="val">${fmtDDMMYYYY(inv.dueDate || inv.date)}</div>
        </div>
      </div>

      <div class="ci-parties">
        <div>
          <div class="ci-section-lbl">ISSUED BY:</div>
          <div class="ci-name">${escapeHtml(m.name)}</div>
          ${m.address ? `<div class="ci-line" style="white-space:pre-line">${escapeHtml(m.address)}</div>` : ''}
        </div>
        <div>
          <div class="ci-section-lbl">ISSUED TO:</div>
          <div class="ci-name">${escapeHtml(b.name)}</div>
          <div class="ci-line" style="white-space:pre-line">${escapeHtml(b.address)}</div>
        </div>
      </div>

      <hr class="ci-divider" />

      <table class="ci-items">
        <thead>
          <tr>
            <th>ITEMS</th>
            <th>DESCRIPTION</th>
            <th class="num">TAX</th>
            <th class="num">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(inv.itemCategory || 'Commission')}</td>
            <td>${escapeHtml(inv.services || '')}</td>
            <td class="num">${taxPct}%</td>
            <td class="num">${fmtMoney(amount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="ci-spacer"></div>

      <div class="ci-footer">
        <div class="ci-pay">
          <div class="ci-pay-lbl">PAYABLE VIA BANK TRANSFER</div>
          ${footerBankLines.map((l) => `<div class="ci-pay-line">${escapeHtml(l)}</div>`).join('')}
          ${inv.notes ? `<div class="ci-pay-line" style="margin-top:10px;opacity:.75">${escapeHtml(inv.notes)}</div>` : ''}
        </div>
        <div class="ci-total">
          <div class="ci-total-lbl">TOTAL</div>
          <div class="ci-total-val">${fmtMoneyExact(total)}</div>
        </div>
      </div>
    </div>
  `
}
