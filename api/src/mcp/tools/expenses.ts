// The spend ledger: expenses and the vendor library that feeds it.
import { z } from 'zod'
import { CATEGORY_ORDER, gbpAmount, monthOf, resolveMonths, round2 } from '../calc.js'
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

const expenseFilters = {
  month: z.string().optional().describe('Exact month, YYYY-MM.'),
  from: z.string().optional().describe('Inclusive start date, YYYY-MM-DD.'),
  to: z.string().optional().describe('Inclusive end date, YYYY-MM-DD.'),
  category: z.string().optional().describe(`One of: ${CATEGORY_ORDER.join(', ')} (or any custom category in use).`),
  vendor: z.string().optional().describe('Vendor name, case-insensitive substring.'),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  q: z.string().optional().describe('Free text across vendor and category.'),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
}

function filterExpenses(state: any, args: any) {
  let rows = (state.expenses || []).slice()
  if (args.month) rows = rows.filter((e: any) => (e.month || monthOf(e.date)) === args.month)
  if (args.from) rows = rows.filter((e: any) => (e.date || '') >= args.from)
  if (args.to) rows = rows.filter((e: any) => (e.date || '') <= args.to)
  if (args.category) rows = rows.filter((e: any) => (e.category || '').toLowerCase() === String(args.category).toLowerCase())
  if (args.vendor) rows = rows.filter((e: any) => (e.vendor || '').toLowerCase().includes(String(args.vendor).toLowerCase()))
  if (args.q) rows = rows.filter((e: any) => matches(args.q, e.vendor, e.category))
  if (args.min_amount != null) rows = rows.filter((e: any) => gbpAmount(state, e) >= Number(args.min_amount))
  if (args.max_amount != null) rows = rows.filter((e: any) => gbpAmount(state, e) <= Number(args.max_amount))
  const sort = args.sort || 'date_desc'
  rows.sort((a: any, b: any) => {
    if (sort === 'amount_desc') return gbpAmount(state, b) - gbpAmount(state, a)
    if (sort === 'amount_asc') return gbpAmount(state, a) - gbpAmount(state, b)
    if (sort === 'date_asc') return String(a.date).localeCompare(String(b.date))
    return String(b.date).localeCompare(String(a.date))
  })
  return rows
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_expenses',
    title: 'List expenses',
    description: 'Filter the expense ledger by month, date range, category, vendor or amount. Returns GBP-converted totals alongside the raw rows.',
    inputSchema: expenseFilters,
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const rows = filterExpenses(state, args)
      const page = paginate(rows, args.limit ?? 50, args.offset ?? 0)
      return {
        filters: { month: args.month ?? null, from: args.from ?? null, to: args.to ?? null, category: args.category ?? null, vendor: args.vendor ?? null, q: args.q ?? null },
        ...page,
        matched_total_gbp: round2(rows.reduce((s: number, e: any) => s + gbpAmount(state, e), 0)),
        rows: page.rows.map((e: any) => ({ ...e, gbp: round2(gbpAmount(state, e)) })),
      }
    },
  },

  {
    name: 'get_expense',
    title: 'Get expense',
    description: 'One expense row by id, with its GBP equivalent.',
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const e = findById(state.expenses, String(args.id), 'expense')
      return { ...e, gbp: round2(gbpAmount(state, e)) }
    },
  },

  {
    name: 'create_expense',
    title: 'Create expense',
    description: 'Add a spend line. `month` defaults to the month of `date`. Foreign currencies are stored as entered and converted on read.',
    write: true,
    inputSchema: {
      date: z.string().describe('YYYY-MM-DD'),
      vendor: z.string(),
      category: z.string().describe(`Usually one of: ${CATEGORY_ORDER.join(', ')}`),
      amount: z.number(),
      currency: z.enum(CURRENCIES).optional().describe('Defaults to GBP.'),
      month: z.string().optional().describe('YYYY-MM; defaults to the month of `date`.'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const date = requireDate(args.date)
      const month = args.month ? requireMonth(args.month) : monthOf(date)
      const amount = num(args.amount, 'amount')
      const out = await ctx.mutate((state) => {
        const row: any = {
          id: freshId((state.expenses || []).map((e) => e.id)),
          date,
          vendor: String(args.vendor || '').trim(),
          category: String(args.category || '').trim(),
          amount,
          month,
        }
        if (args.currency && args.currency !== 'GBP') row.currency = args.currency
        state.expenses = [...(state.expenses || []), row]
        return row
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'bulk_create_expenses',
    title: 'Bulk create expenses',
    description: 'Add many expense lines in ONE locked write (much safer than looping create_expense). Max 200 per call.',
    write: true,
    inputSchema: {
      expenses: z
        .array(
          z.object({
            date: z.string(),
            vendor: z.string(),
            category: z.string(),
            amount: z.number(),
            currency: z.enum(CURRENCIES).optional(),
            month: z.string().optional(),
          }),
        )
        .max(200),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const input = (args.expenses || []) as any[]
      if (!input.length) throw new McpUserError('`expenses` is empty.')
      const prepared = input.map((e, i) => {
        const date = requireDate(e.date, `expenses[${i}].date`)
        return {
          date,
          vendor: String(e.vendor || '').trim(),
          category: String(e.category || '').trim(),
          amount: num(e.amount, `expenses[${i}].amount`),
          month: e.month ? requireMonth(e.month, `expenses[${i}].month`) : monthOf(date),
          currency: e.currency && e.currency !== 'GBP' ? e.currency : undefined,
        }
      })
      const out = await ctx.mutate((state) => {
        const taken = new Set((state.expenses || []).map((e) => e.id))
        const created = prepared.map((p) => {
          const id = freshId(taken)
          taken.add(id)
          const row: any = { id, date: p.date, vendor: p.vendor, category: p.category, amount: p.amount, month: p.month }
          if (p.currency) row.currency = p.currency
          return row
        })
        state.expenses = [...(state.expenses || []), ...created]
        return created
      })
      return { created_count: out.result.length, created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'update_expense',
    title: 'Update expense',
    description: 'Change fields on one expense. Only the fields you pass change; changing `date` does NOT move `month` unless you pass it too.',
    write: true,
    inputSchema: {
      id: z.string(),
      date: z.string().optional(),
      vendor: z.string().optional(),
      category: z.string().optional(),
      amount: z.number().optional(),
      currency: z.enum(CURRENCIES).optional(),
      month: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const e: any = findById(state.expenses, id, 'expense')
        const before = { ...e }
        if (args.date !== undefined) e.date = requireDate(args.date)
        if (args.vendor !== undefined) e.vendor = String(args.vendor)
        if (args.category !== undefined) e.category = String(args.category)
        if (args.amount !== undefined) e.amount = num(args.amount, 'amount')
        if (args.month !== undefined) e.month = requireMonth(args.month)
        if (args.currency !== undefined) {
          if (args.currency === 'GBP') delete e.currency
          else e.currency = args.currency
        }
        return { before, after: { ...e } }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_expense',
    title: 'Delete expense',
    description: 'Remove an expense and tombstone it so the delete propagates to every device.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const e = findById(state.expenses, id, 'expense')
        state.expenses = (state.expenses || []).filter((x) => x.id !== id)
        tombstone(state, 'expenses', id)
        return e
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'recategorize_expenses',
    title: 'Recategorize expenses',
    description:
      'Move every expense matching a filter to another category. Previews by default — pass apply:true to write. Reports exactly what it touched.',
    write: true,
    destructive: true,
    inputSchema: {
      to_category: z.string().describe('Target category.'),
      from_category: z.string().optional().describe('Only rows currently in this category.'),
      vendor: z.string().optional().describe('Only rows whose vendor contains this text.'),
      month: z.string().optional(),
      from: z.string().optional().describe('Inclusive start date.'),
      to: z.string().optional().describe('Inclusive end date.'),
      apply: z.boolean().optional().describe('false/omitted = preview only.'),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const target = String(args.to_category || '').trim()
      if (!target) throw new McpUserError('`to_category` is required.')
      const selector = { category: args.from_category, vendor: args.vendor, month: args.month, from: args.from, to: args.to }
      if (!args.from_category && !args.vendor && !args.month && !args.from && !args.to) {
        throw new McpUserError('Refusing to recategorize the ENTIRE ledger.', 'Add at least one of from_category, vendor, month, from/to.')
      }
      const matched = filterExpenses(state, selector).filter((e: any) => e.category !== target)
      const preview = {
        would_change: matched.length,
        to_category: target,
        sample: matched.slice(0, 10).map((e: any) => ({ id: e.id, date: e.date, vendor: e.vendor, from: e.category, amount: e.amount })),
        total_gbp: round2(matched.reduce((s: number, e: any) => s + gbpAmount(state, e), 0)),
      }
      if (args.apply !== true) {
        return { applied: false, ...preview, next_step: 'Re-run with apply:true to write these changes.' }
      }
      requireWrite()
      const ids = new Set(matched.map((e: any) => e.id))
      const out = await ctx.mutate((s) => {
        let n = 0
        for (const e of s.expenses || []) {
          if (ids.has(e.id)) {
            e.category = target
            n++
          }
        }
        return n
      })
      return { applied: true, changed_count: out.result, to_category: target, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_vendor_spend',
    title: 'Vendor spend',
    description: 'Spend per vendor over a month range: total, count, average, first/last date and the categories they appear under.',
    inputSchema: {
      from: z.string().optional().describe('Inclusive first month, YYYY-MM.'),
      to: z.string().optional().describe('Inclusive last month, YYYY-MM.'),
      last_n: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Top N vendors by spend (default 25).'),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const inRange = new Set(range.months)
      const acc = new Map<string, { vendor: string; total: number; count: number; first: string; last: string; categories: Set<string> }>()
      for (const e of state.expenses || []) {
        const m = e.month || monthOf(e.date)
        if (!inRange.has(m)) continue
        const key = (e.vendor || '(no vendor)').trim()
        const cur = acc.get(key) || { vendor: key, total: 0, count: 0, first: e.date, last: e.date, categories: new Set<string>() }
        cur.total += gbpAmount(state, e)
        cur.count++
        if (e.date < cur.first) cur.first = e.date
        if (e.date > cur.last) cur.last = e.date
        cur.categories.add(e.category)
        acc.set(key, cur)
      }
      const rows = [...acc.values()]
        .map((v) => ({
          vendor: v.vendor,
          total_gbp: round2(v.total),
          count: v.count,
          avg_gbp: round2(v.total / v.count),
          first_date: v.first,
          last_date: v.last,
          categories: [...v.categories],
        }))
        .sort((a, b) => b.total_gbp - a.total_gbp)
      const limit = args.limit ?? 25
      return {
        range: { from: range.from, to: range.to, label: range.label },
        vendor_count: rows.length,
        total_gbp: round2(rows.reduce((s, r) => s + r.total_gbp, 0)),
        top: rows.slice(0, limit),
      }
    },
  },

  {
    name: 'list_vendors',
    title: 'List vendors',
    description: 'The vendor library (name, category, typical amount, recurring flag). This is the reusable list, not the spend itself.',
    inputSchema: {
      q: z.string().optional(),
      category: z.string().optional(),
      recurring_only: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = (state.vendors || []).slice()
      if (args.q) rows = rows.filter((v) => matches(args.q, v.name, v.category))
      if (args.category) rows = rows.filter((v) => (v.category || '').toLowerCase() === String(args.category).toLowerCase())
      if (args.recurring_only) rows = rows.filter((v) => v.recurring)
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      return paginate(rows, args.limit ?? 100, args.offset ?? 0)
    },
  },

  {
    name: 'upsert_vendor',
    title: 'Create or update vendor',
    description: 'Add a vendor to the library, or update one by id. Does not touch existing expense rows.',
    write: true,
    inputSchema: {
      id: z.string().optional().describe('Omit to create.'),
      name: z.string().optional(),
      category: z.string().optional(),
      typicalAmount: z.number().optional(),
      recurring: z.boolean().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        if (args.id) {
          const v: any = findById(state.vendors, String(args.id), 'vendor')
          if (args.name !== undefined) v.name = String(args.name)
          if (args.category !== undefined) v.category = String(args.category)
          if (args.typicalAmount !== undefined) v.typicalAmount = num(args.typicalAmount, 'typicalAmount')
          if (args.recurring !== undefined) v.recurring = Boolean(args.recurring)
          return { created: false, vendor: { ...v } }
        }
        if (!args.name) throw new McpUserError('`name` is required when creating a vendor.')
        const v: any = {
          id: freshId((state.vendors || []).map((x) => x.id)),
          name: String(args.name),
          category: String(args.category || ''),
          typicalAmount: args.typicalAmount !== undefined ? num(args.typicalAmount, 'typicalAmount') : 0,
          recurring: Boolean(args.recurring),
        }
        state.vendors = [...(state.vendors || []), v]
        return { created: true, vendor: v }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_vendor',
    title: 'Delete vendor',
    description: 'Remove a vendor from the library. Expenses referencing it by name are left untouched.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const v = findById(state.vendors, id, 'vendor')
        state.vendors = (state.vendors || []).filter((x) => x.id !== id)
        tombstone(state, 'vendors', id)
        return v
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },
]
