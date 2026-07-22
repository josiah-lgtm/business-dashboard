// OUTBOUND invoices — the ones you send to clients.
// (Inbound invoices your team submits are teamInvoices; see team-invoices.ts.)
import { z } from 'zod'
import { monthOf, round2 } from '../calc.js'
import { nextInvoiceNumber, nextInvoiceSeq } from '../invoice-number.js'
import { McpUserError, type ToolDef } from '../types.js'
import { CURRENCIES, findById, freshId, matches, nowIso, num, paginate, requireDate, requireWrite, todayDate, tombstone } from '../util.js'

const STATUSES = ['draft', 'sent', 'paid'] as const

const itemSchema = z.object({
  description: z.string(),
  qty: z.number(),
  rate: z.number(),
})

/** Recompute subtotal/tax/total from the line items — never trust totals a
 * caller supplies, or the invoice PDF and the P&L stop agreeing. */
function recalc(inv: any): void {
  const subtotal = (inv.items || []).reduce((s: number, it: any) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0)
  inv.subtotal = round2(subtotal)
  inv.tax = round2((subtotal * (Number(inv.taxPct) || 0)) / 100)
  inv.total = round2(inv.subtotal + inv.tax)
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_invoices',
    title: 'List outbound invoices',
    description: 'Invoices you send: filter by status, client, month or date range. Includes totals per status.',
    inputSchema: {
      status: z.enum(STATUSES).optional(),
      client: z.string().optional().describe('Client name, case-insensitive substring.'),
      month: z.string().optional().describe('YYYY-MM of the invoice date.'),
      from: z.string().optional(),
      to: z.string().optional(),
      q: z.string().optional().describe('Free text across number, client name and notes.'),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = (state.invoices || []).slice()
      if (args.status) rows = rows.filter((i) => i.status === args.status)
      if (args.client) rows = rows.filter((i) => (i.client?.name || '').toLowerCase().includes(String(args.client).toLowerCase()))
      if (args.month) rows = rows.filter((i) => monthOf(i.date) === args.month)
      if (args.from) rows = rows.filter((i) => (i.date || '') >= args.from)
      if (args.to) rows = rows.filter((i) => (i.date || '') <= args.to)
      if (args.q) rows = rows.filter((i) => matches(args.q, i.number, i.client?.name, i.notes))
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const byStatus: Record<string, { count: number; total: number }> = {}
      for (const i of rows) {
        const b = (byStatus[i.status] = byStatus[i.status] || { count: 0, total: 0 })
        b.count++
        b.total = round2(b.total + (Number(i.total) || 0))
      }
      const page = paginate(rows, args.limit ?? 50, args.offset ?? 0)
      return {
        by_status: byStatus,
        matched_total: round2(rows.reduce((s, i) => s + (Number(i.total) || 0), 0)),
        ...page,
        rows: page.rows.map((i) => ({
          id: i.id,
          number: i.number,
          date: i.date,
          status: i.status,
          currency: i.currency,
          client: i.client?.name ?? null,
          subtotal: i.subtotal,
          tax: i.tax,
          total: i.total,
          items: (i.items || []).length,
        })),
      }
    },
  },

  {
    name: 'get_invoice',
    title: 'Get outbound invoice',
    description: 'One outbound invoice in full, including line items and client details.',
    inputSchema: { id: z.string().optional(), number: z.string().optional().describe('Exact invoice number.') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      if (args.id) return findById(state.invoices, String(args.id), 'invoice')
      if (args.number) {
        const hit = (state.invoices || []).find((i) => i.number === args.number)
        if (!hit) throw new McpUserError(`No invoice numbered "${args.number}".`)
        return hit
      }
      throw new McpUserError('Pass an `id` or a `number`.')
    },
  },

  {
    name: 'next_invoice_number',
    title: 'Next invoice number',
    description: 'The number the dashboard would suggest next — derived from the highest existing number, so cancelled drafts never burn one.',
    inputSchema: { year: z.string().optional().describe('4-digit year for the label; defaults to the current year.') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const year = String(args.year || new Date().getUTCFullYear())
      return {
        next_number: nextInvoiceNumber(state, year),
        next_sequence: nextInvoiceSeq(state),
        existing_invoices: (state.invoices || []).length,
        highest_existing: (state.invoices || []).map((i) => i.number).sort().slice(-1)[0] ?? null,
      }
    },
  },

  {
    name: 'create_invoice',
    title: 'Create outbound invoice',
    description: 'Draft an invoice. Totals are computed from the line items; the number is auto-derived unless you pass one.',
    write: true,
    inputSchema: {
      client_name: z.string(),
      items: z.array(itemSchema).min(1).describe('[{description, qty, rate}]'),
      client_email: z.string().optional(),
      client_address: z.string().optional(),
      date: z.string().optional().describe('YYYY-MM-DD, defaults to today.'),
      number: z.string().optional().describe('Defaults to the next derived number.'),
      status: z.enum(STATUSES).optional().describe('Default draft.'),
      currency: z.enum(CURRENCIES).optional().describe('Default GBP.'),
      taxPct: z.number().optional(),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const date = args.date ? requireDate(args.date) : todayDate()
      const out = await ctx.mutate((state) => {
        const inv: any = {
          id: freshId((state.invoices || []).map((i) => i.id)),
          number: args.number ? String(args.number) : nextInvoiceNumber(state, date.slice(0, 4)),
          date,
          status: args.status || 'draft',
          currency: args.currency || 'GBP',
          client: {
            name: String(args.client_name || ''),
            email: String(args.client_email || ''),
            address: String(args.client_address || ''),
          },
          items: (args.items as any[]).map((it) => ({
            description: String(it.description || ''),
            qty: num(it.qty, 'items[].qty'),
            rate: num(it.rate, 'items[].rate'),
          })),
          subtotal: 0,
          taxPct: args.taxPct !== undefined ? num(args.taxPct, 'taxPct') : 0,
          tax: 0,
          total: 0,
          notes: String(args.notes || ''),
          updatedAt: nowIso(),
        }
        recalc(inv)
        state.invoices = [...(state.invoices || []), inv]
        return inv
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'update_invoice',
    title: 'Update outbound invoice',
    description: 'Change an invoice. Passing `items` replaces the whole line-item list and recomputes the totals.',
    write: true,
    inputSchema: {
      id: z.string(),
      items: z.array(itemSchema).optional().describe('Replaces ALL line items.'),
      client_name: z.string().optional(),
      client_email: z.string().optional(),
      client_address: z.string().optional(),
      date: z.string().optional(),
      number: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      currency: z.enum(CURRENCIES).optional(),
      taxPct: z.number().optional(),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const inv: any = findById(state.invoices, String(args.id), 'invoice')
        const before = JSON.parse(JSON.stringify(inv))
        if (args.items !== undefined) {
          inv.items = (args.items as any[]).map((it) => ({
            description: String(it.description || ''),
            qty: num(it.qty, 'items[].qty'),
            rate: num(it.rate, 'items[].rate'),
          }))
        }
        if (args.client_name !== undefined) inv.client = { ...(inv.client || {}), name: String(args.client_name) }
        if (args.client_email !== undefined) inv.client = { ...(inv.client || {}), email: String(args.client_email) }
        if (args.client_address !== undefined) inv.client = { ...(inv.client || {}), address: String(args.client_address) }
        if (args.date !== undefined) inv.date = requireDate(args.date)
        if (args.number !== undefined) inv.number = String(args.number)
        if (args.status !== undefined) inv.status = args.status
        if (args.currency !== undefined) inv.currency = args.currency
        if (args.taxPct !== undefined) inv.taxPct = num(args.taxPct, 'taxPct')
        if (args.notes !== undefined) inv.notes = String(args.notes)
        recalc(inv)
        // The merge tie-breaks invoices on updatedAt, so an MCP edit MUST stamp
        // it or a stale browser copy could win and silently undo this change.
        inv.updatedAt = nowIso()
        return { before, after: JSON.parse(JSON.stringify(inv)) }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'set_invoice_status',
    title: 'Set invoice status',
    description: 'Move an outbound invoice between draft, sent and paid.',
    write: true,
    inputSchema: { id: z.string(), status: z.enum(STATUSES) },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const inv: any = findById(state.invoices, String(args.id), 'invoice')
        const from = inv.status
        inv.status = args.status
        inv.updatedAt = nowIso()
        return { id: inv.id, number: inv.number, from, to: inv.status, total: inv.total }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_invoice',
    title: 'Delete outbound invoice',
    description: 'Remove an invoice and tombstone it. Requires confirm:true.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string(), confirm: z.boolean().describe('Must be true.') },
    handler: async (args, ctx) => {
      requireWrite()
      if (args.confirm !== true) throw new McpUserError('Refusing to delete an invoice without confirm:true.')
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const inv = findById(state.invoices, id, 'invoice')
        state.invoices = (state.invoices || []).filter((x) => x.id !== id)
        tombstone(state, 'invoices', id)
        return inv
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_receivables',
    title: 'Receivables',
    description: 'Outstanding outbound invoices with ageing buckets, plus paid totals by month. The "who owes us" view.',
    inputSchema: { as_of: z.string().optional().describe('YYYY-MM-DD, defaults to today.') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const asOf = args.as_of ? requireDate(args.as_of, 'as_of') : todayDate()
      const asOfMs = Date.parse(asOf)
      const open = (state.invoices || []).filter((i) => i.status !== 'paid')
      const bucket = (days: number) => (days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+')
      const aged = open.map((i) => {
        const days = Math.max(0, Math.round((asOfMs - Date.parse(i.date || asOf)) / 86_400_000))
        return {
          id: i.id,
          number: i.number,
          client: i.client?.name ?? null,
          date: i.date,
          status: i.status,
          currency: i.currency,
          total: i.total,
          days_outstanding: days,
          bucket: bucket(days),
        }
      })
      const buckets: Record<string, { count: number; total: number }> = {}
      for (const a of aged) {
        const b = (buckets[a.bucket] = buckets[a.bucket] || { count: 0, total: 0 })
        b.count++
        b.total = round2(b.total + (Number(a.total) || 0))
      }
      const paidByMonth: Record<string, number> = {}
      for (const i of state.invoices || []) {
        if (i.status !== 'paid') continue
        const m = monthOf(i.date)
        paidByMonth[m] = round2((paidByMonth[m] || 0) + (Number(i.total) || 0))
      }
      return {
        as_of: asOf,
        outstanding_count: aged.length,
        outstanding_total: round2(aged.reduce((s, a) => s + (Number(a.total) || 0), 0)),
        ageing: buckets,
        invoices: aged.sort((a, b) => b.days_outstanding - a.days_outstanding),
        paid_by_month: paidByMonth,
        caveat: 'Ageing counts from the invoice date — outbound invoices carry no due date in this app.',
      }
    },
  },
]
