// Cash in and cash back: individual revenue entries and the refund ledger.
//
// Worth stating once, because models get it wrong: months[].revenue is the
// figure the dashboard reports. revenueEntries are the individual cash-in lines
// behind it and are NOT summed into the month automatically — set_month_figures
// is what moves the reported number.
import { z } from 'zod'
import { monthOf, resolveMonths, round2, toGbp } from '../calc.js'
import { McpUserError, type ToolDef } from '../types.js'
import {
  CURRENCIES,
  findById,
  freshId,
  matches,
  num,
  paginate,
  requireDate,
  requireMonth,
  requireWrite,
  tombstone,
} from '../util.js'

export const TOOLS: ToolDef[] = [
  {
    name: 'list_revenue_entries',
    title: 'List revenue entries',
    description: 'Individual cash-in lines (month, date, amount, source, notes) with filters and a total.',
    inputSchema: {
      month: z.string().optional(),
      from: z.string().optional().describe('Inclusive start date, YYYY-MM-DD.'),
      to: z.string().optional().describe('Inclusive end date, YYYY-MM-DD.'),
      source: z.string().optional(),
      q: z.string().optional().describe('Free text across source and notes.'),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = (state.revenueEntries || []).slice()
      if (args.month) rows = rows.filter((r) => r.month === args.month)
      if (args.from) rows = rows.filter((r) => (r.date || '') >= args.from)
      if (args.to) rows = rows.filter((r) => (r.date || '') <= args.to)
      if (args.source) rows = rows.filter((r) => (r.source || '').toLowerCase().includes(String(args.source).toLowerCase()))
      if (args.q) rows = rows.filter((r) => matches(args.q, r.source, r.notes))
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const page = paginate(rows, args.limit ?? 50, args.offset ?? 0)
      return { ...page, matched_total: round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)) }
    },
  },

  {
    name: 'get_revenue_summary',
    title: 'Revenue summary',
    description: 'Revenue entries rolled up by month and by source, next to the month figure the dashboard actually reports.',
    inputSchema: {
      from: z.string().optional().describe('Inclusive first month, YYYY-MM.'),
      to: z.string().optional().describe('Inclusive last month, YYYY-MM.'),
      last_n: z.number().int().positive().optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const inRange = new Set(range.months)
      const byMonth = new Map<string, number>()
      const bySource = new Map<string, { total: number; count: number }>()
      for (const r of state.revenueEntries || []) {
        const m = r.month || monthOf(r.date)
        if (!inRange.has(m)) continue
        byMonth.set(m, (byMonth.get(m) || 0) + (Number(r.amount) || 0))
        const key = (r.source || '(no source)').trim()
        const cur = bySource.get(key) || { total: 0, count: 0 }
        cur.total += Number(r.amount) || 0
        cur.count++
        bySource.set(key, cur)
      }
      return {
        range: { from: range.from, to: range.to, label: range.label },
        by_month: range.months.map((m) => ({
          month: m,
          entries_total: round2(byMonth.get(m) || 0),
          month_figure_revenue: round2(state.months[m]?.revenue || 0),
          difference: round2((state.months[m]?.revenue || 0) - (byMonth.get(m) || 0)),
        })),
        by_source: [...bySource.entries()]
          .map(([source, v]) => ({ source, total: round2(v.total), count: v.count }))
          .sort((a, b) => b.total - a.total),
        reminder:
          'Entries do not roll into months[].revenue automatically — a non-zero `difference` is normal when revenue is maintained at month level.',
      }
    },
  },

  {
    name: 'create_revenue_entry',
    title: 'Create revenue entry',
    description: 'Log a cash-in line. Does not change the reported month revenue — use set_month_figures for that.',
    write: true,
    inputSchema: {
      date: z.string().describe('YYYY-MM-DD'),
      amount: z.number(),
      source: z.string().optional(),
      notes: z.string().optional(),
      month: z.string().optional().describe('Defaults to the month of `date`.'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const date = requireDate(args.date)
      const month = args.month ? requireMonth(args.month) : monthOf(date)
      const amount = num(args.amount, 'amount')
      const out = await ctx.mutate((state) => {
        const row = {
          id: freshId((state.revenueEntries || []).map((r) => r.id)),
          month,
          date,
          amount,
          source: String(args.source || ''),
          notes: String(args.notes || ''),
        }
        state.revenueEntries = [...(state.revenueEntries || []), row]
        return row
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'update_revenue_entry',
    title: 'Update revenue entry',
    description: 'Change fields on one revenue entry. Only the fields you pass change.',
    write: true,
    inputSchema: {
      id: z.string(),
      date: z.string().optional(),
      amount: z.number().optional(),
      source: z.string().optional(),
      notes: z.string().optional(),
      month: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const r: any = findById(state.revenueEntries, id, 'revenue entry')
        const before = { ...r }
        if (args.date !== undefined) r.date = requireDate(args.date)
        if (args.amount !== undefined) r.amount = num(args.amount, 'amount')
        if (args.source !== undefined) r.source = String(args.source)
        if (args.notes !== undefined) r.notes = String(args.notes)
        if (args.month !== undefined) r.month = requireMonth(args.month)
        return { before, after: { ...r } }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_revenue_entry',
    title: 'Delete revenue entry',
    description: 'Remove a revenue entry and tombstone it so the delete propagates.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const r = findById(state.revenueEntries, id, 'revenue entry')
        state.revenueEntries = (state.revenueEntries || []).filter((x) => x.id !== id)
        tombstone(state, 'revenueEntries', id)
        return r
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'list_refunds',
    title: 'List refunds',
    description: 'The refund ledger. When a month has refund rows they OVERRIDE that month\'s refundsTotal figure.',
    inputSchema: {
      month: z.string().optional(),
      recipient: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = (state.refunds || []).slice()
      if (args.month) rows = rows.filter((r) => r.month === args.month)
      if (args.recipient) rows = rows.filter((r) => (r.recipient || '').toLowerCase().includes(String(args.recipient).toLowerCase()))
      rows.sort((a, b) => String(b.date || b.month).localeCompare(String(a.date || a.month)))
      const page = paginate(rows, args.limit ?? 50, args.offset ?? 0)
      return {
        ...page,
        matched_total_gbp: round2(rows.reduce((s, r) => s + toGbp(state, Number(r.amount) || 0, r.currency), 0)),
      }
    },
  },

  {
    name: 'create_refund',
    title: 'Create refund',
    description: 'Log a refund. This makes the month\'s refunds ledger authoritative over its refundsTotal figure.',
    write: true,
    inputSchema: {
      month: z.string().describe('YYYY-MM'),
      recipient: z.string(),
      amount: z.number(),
      date: z.string().optional().describe('YYYY-MM-DD'),
      currency: z.enum(CURRENCIES).optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const month = requireMonth(args.month)
      const amount = num(args.amount, 'amount')
      const date = args.date ? requireDate(args.date) : undefined
      const out = await ctx.mutate((state) => {
        const row: any = {
          id: freshId((state.refunds || []).map((r) => r.id)),
          month,
          recipient: String(args.recipient || ''),
          amount,
        }
        if (date) row.date = date
        if (args.currency && args.currency !== 'GBP') row.currency = args.currency
        state.refunds = [...(state.refunds || []), row]
        return row
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_refund',
    title: 'Delete refund',
    description: 'Remove a refund row and tombstone it.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const r = findById(state.refunds, id, 'refund')
        state.refunds = (state.refunds || []).filter((x) => x.id !== id)
        tombstone(state, 'refunds', id)
        return r
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_deletions',
    title: 'Deletion log',
    description: 'The tombstone map — what was deleted and when. Useful when a row "came back" or someone asks where something went.',
    inputSchema: {
      collection: z.string().optional().describe('e.g. expenses, invoices, team.'),
      since: z.string().optional().describe('ISO timestamp; only deletions after it.'),
      limit: z.number().int().min(1).max(500).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = Object.entries(state.deletions || {}).map(([key, at]) => {
        const sep = key.indexOf(':')
        return { collection: key.slice(0, sep), id: key.slice(sep + 1), deleted_at: at }
      })
      if (args.collection) rows = rows.filter((r) => r.collection === args.collection)
      if (args.since) rows = rows.filter((r) => r.deleted_at > String(args.since))
      rows.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)))
      const byCollection: Record<string, number> = {}
      for (const r of rows) byCollection[r.collection] = (byCollection[r.collection] || 0) + 1
      return { total: rows.length, by_collection: byCollection, rows: rows.slice(0, args.limit ?? 100) }
    },
  },

  {
    name: 'undelete',
    title: 'Undo a deletion',
    description:
      'Remove a tombstone so a row can come back on the next device sync. It only works if some device still holds the row — this connector cannot resurrect data by itself.',
    write: true,
    inputSchema: { collection: z.string().describe('e.g. expenses'), id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const key = `${args.collection}:${args.id}`
      const out = await ctx.mutate((state) => {
        if (!state.deletions || !(key in state.deletions)) {
          throw new McpUserError(`No tombstone for "${key}".`, 'Call get_deletions to see what was deleted.')
        }
        const at = state.deletions[key]
        delete state.deletions[key]
        return at
      })
      return {
        cleared: key,
        was_deleted_at: out.result,
        changed: out.changed,
        updated_at: out.updated_at,
        caveat: 'The row reappears only when a device that still has it syncs. Check with restore_snapshot if no device does.',
      }
    },
  },
]
