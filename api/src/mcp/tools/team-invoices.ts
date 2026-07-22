// INBOUND invoices — the ones team members submit to get paid. Distinct from
// outbound `invoices` in every way that matters: they belong to a member, carry
// a period and hours, and their number series is per-member.
import { z } from 'zod'
import { monthOf, round2 } from '../calc.js'
import { nextTeamInvoiceNumber } from '../invoice-number.js'
import { McpUserError, type ToolDef } from '../types.js'
import { CURRENCIES, findById, freshId, matches, nowIso, num, paginate, requireDate, requireWrite, todayDate, tombstone } from '../util.js'

const STATUSES = ['draft', 'pending', 'submitted', 'accepted', 'paid'] as const

export const TOOLS: ToolDef[] = [
  {
    name: 'list_team_invoices',
    title: 'List inbound invoices',
    description: 'Invoices submitted by team members, filterable by member, status, month or period.',
    inputSchema: {
      member_id: z.string().optional(),
      member_name: z.string().optional().describe('Case-insensitive substring of the member name.'),
      status: z.enum(STATUSES).optional(),
      unpaid_only: z.boolean().optional(),
      month: z.string().optional().describe('YYYY-MM of the invoice date.'),
      q: z.string().optional().describe('Free text across number, services and notes.'),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const names = new Map((state.team || []).map((m) => [m.id, m.name]))
      let rows = (state.teamInvoices || []).slice()
      if (args.member_id) rows = rows.filter((i) => i.memberId === args.member_id)
      if (args.member_name) {
        const needle = String(args.member_name).toLowerCase()
        rows = rows.filter((i) => (names.get(i.memberId) || '').toLowerCase().includes(needle))
      }
      if (args.status) rows = rows.filter((i) => i.status === args.status)
      if (args.unpaid_only) rows = rows.filter((i) => i.status !== 'paid')
      if (args.month) rows = rows.filter((i) => monthOf(i.date) === args.month)
      if (args.q) rows = rows.filter((i) => matches(args.q, i.number, i.services, i.notes))
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const byStatus: Record<string, { count: number; total: number }> = {}
      for (const i of rows) {
        const b = (byStatus[i.status] = byStatus[i.status] || { count: 0, total: 0 })
        b.count++
        b.total = round2(b.total + (Number(i.amount) || 0))
      }
      const page = paginate(rows, args.limit ?? 50, args.offset ?? 0)
      return {
        by_status: byStatus,
        matched_total: round2(rows.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
        ...page,
        rows: page.rows.map((i) => ({ ...i, memberName: names.get(i.memberId) ?? null })),
      }
    },
  },

  {
    name: 'get_team_invoice',
    title: 'Get inbound invoice',
    description: 'One submitted invoice in full, with the member it belongs to.',
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const inv = findById(state.teamInvoices, String(args.id), 'team invoice')
      const member = (state.team || []).find((m) => m.id === inv.memberId)
      return { ...inv, memberName: member?.name ?? null, memberRole: member?.role ?? null }
    },
  },

  {
    name: 'create_team_invoice',
    title: 'Create inbound invoice',
    description: 'Record an invoice on a team member\'s behalf. The number is derived from that member\'s own series unless you pass one.',
    write: true,
    inputSchema: {
      member_id: z.string(),
      amount: z.number(),
      date: z.string().optional().describe('YYYY-MM-DD, defaults to today.'),
      number: z.string().optional(),
      period: z.string().optional().describe('Free text, e.g. "June 2026" or a date range.'),
      services: z.string().optional(),
      hours: z.number().optional(),
      rate: z.number().optional(),
      due_date: z.string().optional(),
      taxPct: z.number().optional(),
      currency: z.enum(CURRENCIES).optional(),
      status: z.enum(STATUSES).optional().describe('Default draft.'),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const date = args.date ? requireDate(args.date) : todayDate()
      const amount = num(args.amount, 'amount')
      const out = await ctx.mutate((state) => {
        const member = findById(state.team, String(args.member_id), 'team member')
        const inv: any = {
          id: freshId((state.teamInvoices || []).map((i) => i.id)),
          memberId: member.id,
          number: args.number ? String(args.number) : nextTeamInvoiceNumber(state.teamInvoices, member.id, member.name),
          date,
          amount,
          status: args.status || 'draft',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        if (args.period) inv.period = String(args.period)
        if (args.services) inv.services = String(args.services)
        if (args.hours !== undefined) inv.hours = num(args.hours, 'hours')
        if (args.rate !== undefined) inv.rate = num(args.rate, 'rate')
        if (args.due_date) inv.dueDate = requireDate(args.due_date, 'due_date')
        if (args.taxPct !== undefined) inv.taxPct = num(args.taxPct, 'taxPct')
        if (args.currency) inv.currency = args.currency
        if (args.notes) inv.notes = String(args.notes)
        state.teamInvoices = [...(state.teamInvoices || []), inv]
        return { ...inv, memberName: member.name }
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'set_team_invoice_status',
    title: 'Set inbound invoice status',
    description: 'Move a submitted invoice through draft → pending/submitted → accepted → paid. Stamps acceptedAt when accepted.',
    write: true,
    inputSchema: { id: z.string(), status: z.enum(STATUSES) },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const inv: any = findById(state.teamInvoices, String(args.id), 'team invoice')
        const from = inv.status
        inv.status = args.status
        if (args.status === 'accepted' && !inv.acceptedAt) inv.acceptedAt = nowIso()
        // teamInvoices tie-break on updatedAt/acceptedAt/declinedAt — stamping is
        // what keeps a stale browser copy from winning the merge.
        inv.updatedAt = nowIso()
        return { id: inv.id, number: inv.number, from, to: inv.status, amount: inv.amount }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'update_team_invoice',
    title: 'Update inbound invoice',
    description: 'Change fields on a submitted invoice. Only the fields you pass change.',
    write: true,
    inputSchema: {
      id: z.string(),
      amount: z.number().optional(),
      date: z.string().optional(),
      number: z.string().optional(),
      period: z.string().optional(),
      services: z.string().optional(),
      hours: z.number().optional(),
      rate: z.number().optional(),
      due_date: z.string().optional(),
      taxPct: z.number().optional(),
      currency: z.enum(CURRENCIES).optional(),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const inv: any = findById(state.teamInvoices, String(args.id), 'team invoice')
        const before = { ...inv }
        if (args.amount !== undefined) inv.amount = num(args.amount, 'amount')
        if (args.date !== undefined) inv.date = requireDate(args.date)
        if (args.number !== undefined) inv.number = String(args.number)
        if (args.period !== undefined) inv.period = String(args.period)
        if (args.services !== undefined) inv.services = String(args.services)
        if (args.hours !== undefined) inv.hours = num(args.hours, 'hours')
        if (args.rate !== undefined) inv.rate = num(args.rate, 'rate')
        if (args.due_date !== undefined) inv.dueDate = requireDate(args.due_date, 'due_date')
        if (args.taxPct !== undefined) inv.taxPct = num(args.taxPct, 'taxPct')
        if (args.currency !== undefined) inv.currency = args.currency
        if (args.notes !== undefined) inv.notes = String(args.notes)
        inv.updatedAt = nowIso()
        return { before, after: { ...inv } }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_team_invoice',
    title: 'Delete inbound invoice',
    description: 'Remove a submitted invoice and tombstone it. Requires confirm:true.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string(), confirm: z.boolean().describe('Must be true.') },
    handler: async (args, ctx) => {
      requireWrite()
      if (args.confirm !== true) throw new McpUserError('Refusing to delete a team invoice without confirm:true.')
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const inv = findById(state.teamInvoices, id, 'team invoice')
        state.teamInvoices = (state.teamInvoices || []).filter((x) => x.id !== id)
        tombstone(state, 'teamInvoices', id)
        return inv
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_team_invoice_summary',
    title: 'Inbound invoice summary',
    description: 'What each member has invoiced and what is still unpaid, by member and by month.',
    inputSchema: { month: z.string().optional().describe('Restrict to one YYYY-MM.'), unpaid_only: z.boolean().optional() },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const names = new Map((state.team || []).map((m) => [m.id, m.name]))
      let rows = (state.teamInvoices || []).slice()
      if (args.month) rows = rows.filter((i) => monthOf(i.date) === args.month)
      if (args.unpaid_only) rows = rows.filter((i) => i.status !== 'paid')
      const byMember = new Map<string, { member: string; count: number; total: number; unpaid: number; unpaid_total: number }>()
      const byMonth: Record<string, number> = {}
      for (const i of rows) {
        const key = i.memberId
        const cur = byMember.get(key) || { member: names.get(key) || key, count: 0, total: 0, unpaid: 0, unpaid_total: 0 }
        cur.count++
        cur.total = round2(cur.total + (Number(i.amount) || 0))
        if (i.status !== 'paid') {
          cur.unpaid++
          cur.unpaid_total = round2(cur.unpaid_total + (Number(i.amount) || 0))
        }
        byMember.set(key, cur)
        const m = monthOf(i.date)
        byMonth[m] = round2((byMonth[m] || 0) + (Number(i.amount) || 0))
      }
      return {
        filters: { month: args.month ?? null, unpaid_only: Boolean(args.unpaid_only) },
        total: round2(rows.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
        by_member: [...byMember.entries()].map(([id, v]) => ({ member_id: id, ...v })).sort((a, b) => b.total - a.total),
        by_month: byMonth,
      }
    },
  },
]
