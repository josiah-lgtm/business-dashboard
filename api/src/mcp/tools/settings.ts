// Business identity, currency rates and the saved budget scenarios.
import { z } from 'zod'
import { publish } from '../../events.js'
import { fetchGbpRates } from '../../fx.js'
import { updateFxRates } from '../../store.js'
import { round2 } from '../calc.js'
import { writerLabel } from '../context.js'
import { McpUserError, type ToolDef } from '../types.js'
import { findById, freshId, nowIso, num, requireWrite, safeBusiness, tombstone } from '../util.js'

export const TOOLS: ToolDef[] = [
  {
    name: 'get_business',
    title: 'Business details',
    description: 'Company identity used on invoices: name, trading name, address, company/tax numbers, and which bank accounts exist.',
    inputSchema: { include_bank_details: z.boolean().optional().describe('Include full account numbers/IBANs (default false).') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const b: any = state.business || {}
      const safe = safeBusiness(b)
      if (args.include_bank_details) return { business: safe }
      return { business: { ...safe, banks: undefined }, bank_accounts: Object.keys(b.banks || {}) }
    },
  },

  {
    name: 'update_business',
    title: 'Update business details',
    description: 'Change the company details that appear on invoices. Only the fields you pass change. Cannot touch bank details or the logo.',
    write: true,
    inputSchema: {
      name: z.string().optional(),
      tradingAs: z.string().optional(),
      address: z.string().optional(),
      companyNumber: z.string().optional(),
      taxId: z.string().optional(),
      sin: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const fields = ['name', 'tradingAs', 'address', 'companyNumber', 'taxId', 'sin', 'email', 'website'] as const
      const given = fields.filter((f) => args[f] !== undefined)
      if (!given.length) throw new McpUserError('Pass at least one field to change.')
      const out = await ctx.mutate((state) => {
        const b: any = { ...(state.business || {}) }
        for (const f of given) b[f] = String(args[f])
        state.business = b
        return safeBusiness(b)
      })
      return { updated: given, business: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_fx_rates',
    title: 'FX rates',
    description: 'Current GBP-based rates ("1 GBP = X"), when they were last refreshed, and how stale that is.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state } = await ctx.state()
      const fx = (state.meta?.fxRates || {}) as Record<string, number>
      const stamp = Number(fx._updatedAt) || 0
      return {
        base: 'GBP',
        rates: Object.fromEntries(Object.entries(fx).filter(([k]) => !k.startsWith('_'))),
        updated_at: stamp ? new Date(stamp).toISOString() : null,
        age_hours: stamp ? round2((Date.now() - stamp) / 3_600_000) : null,
        auto_refresh: 'The server refreshes these 3x/day from the fawazahmed0 currency API; refresh_fx_rates forces it now.',
      }
    },
  },

  {
    name: 'refresh_fx_rates',
    title: 'Refresh FX rates',
    description: 'Fetch live GBP rates now and store them. Same path as the Settings "Refresh now" button.',
    write: true,
    inputSchema: {},
    handler: async (_args, ctx) => {
      requireWrite()
      const rates = await fetchGbpRates()
      if (!rates) throw new McpUserError('The rate source is unavailable right now.', 'Last-good rates are kept; try again shortly.')
      const res = await updateFxRates(ctx.workspaceKey, { USD: rates.usd, EUR: rates.eur })
      if (res.changed) publish(ctx.workspaceKey, { updated_at: res.updated_at, updated_by: writerLabel(ctx.auth) })
      return { rates: { USD: rates.usd, EUR: rates.eur }, source_date: rates.date, changed: res.changed, updated_at: res.updated_at }
    },
  },

  {
    name: 'set_fx_rate',
    title: 'Set an FX rate manually',
    description:
      'Override one currency rate ("1 GBP = X"). The 8-hourly auto-refresh will overwrite USD/EUR again — use refresh_fx_rates instead unless you specifically want a manual figure.',
    write: true,
    inputSchema: { currency: z.string().describe('e.g. USD'), rate: z.number().describe('Foreign units per 1 GBP.') },
    handler: async (args, ctx) => {
      requireWrite()
      const cur = String(args.currency).toUpperCase()
      const value = num(args.rate, 'rate')
      if (value <= 0) throw new McpUserError('`rate` must be greater than zero.')
      const out = await ctx.mutate((state) => {
        const fx: any = { ...(state.meta?.fxRates || {}) }
        fx[cur] = value
        fx._updatedAt = Date.now()
        state.meta = { ...(state.meta || ({} as any)), fxRates: fx }
        if (cur === 'USD') state.meta.fxRate = value // legacy mirror the SPA still reads
        return fx
      })
      return { currency: cur, rate: value, rates: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'list_budgets',
    title: 'List budget scenarios',
    description: 'Saved budget scenarios with their keys, when they were saved and their field counts.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state } = await ctx.state()
      const rows = Object.entries(state.budgets || {}).map(([key, b]: [string, any]) => ({
        key,
        saved_at: b?._savedAt ?? null,
        fields: Object.keys(b || {}).filter((k) => k !== '_savedAt').length,
      }))
      rows.sort((a, b) => String(b.saved_at ?? '').localeCompare(String(a.saved_at ?? '')))
      return { count: rows.length, budgets: rows }
    },
  },

  {
    name: 'get_budget',
    title: 'Get budget scenario',
    description: 'The full contents of one saved budget scenario.',
    inputSchema: { key: z.string() },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const b = (state.budgets || {})[String(args.key)]
      if (!b) {
        throw new McpUserError(`No budget "${args.key}".`, `Saved budgets: ${Object.keys(state.budgets || {}).join(', ') || 'none'}`)
      }
      return { key: args.key, budget: b }
    },
  },

  {
    name: 'save_budget',
    title: 'Save budget scenario',
    description: 'Create or update a budget scenario. `values` is a flat map of numeric fields; it MERGES into an existing scenario unless replace:true.',
    write: true,
    inputSchema: {
      key: z.string().describe('Scenario key, e.g. a YYYY-MM or a name.'),
      values: z.record(z.string(), z.number()).describe('Flat numeric fields.'),
      replace: z.boolean().optional().describe('true = drop any fields not passed.'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const key = String(args.key)
      const values = (args.values || {}) as Record<string, number>
      if (!Object.keys(values).length) throw new McpUserError('`values` is empty.')
      const out = await ctx.mutate((state) => {
        state.budgets = state.budgets || {}
        const existing = args.replace ? {} : { ...(state.budgets[key] || {}) }
        const next: any = { ...existing }
        for (const [k, v] of Object.entries(values)) next[k] = Number(v)
        next._savedAt = nowIso() // budgets tie-break on _savedAt
        state.budgets[key] = next
        return next
      })
      return { key, budget: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_budget',
    title: 'Delete budget scenario',
    description: 'Remove a saved budget scenario.',
    write: true,
    destructive: true,
    inputSchema: { key: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const key = String(args.key)
      const out = await ctx.mutate((state) => {
        if (!state.budgets?.[key]) throw new McpUserError(`No budget "${key}".`)
        const removed = state.budgets[key]
        delete state.budgets[key]
        return removed
      })
      return { deleted_key: key, budget: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'list_custom_buckets',
    title: 'List custom buckets',
    description: 'User-defined Finance Hub buckets layered on top of the built-in ones.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state } = await ctx.state()
      return { count: (state.customBuckets || []).length, buckets: state.customBuckets || [] }
    },
  },

  {
    name: 'upsert_custom_bucket',
    title: 'Create or update custom bucket',
    description: 'Add or edit a custom Finance Hub bucket. `category_map` is the expense category it sums.',
    write: true,
    inputSchema: {
      id: z.string().optional().describe('Omit to create.'),
      name: z.string().optional(),
      color: z.string().optional().describe('Hex, e.g. #5e9eff'),
      icon: z.string().optional(),
      kind: z.enum(['expense', 'team', 'refund']).optional(),
      category_map: z.string().optional(),
      fallback_month_field: z.string().optional().describe('Month figure to fall back to when no line items match.'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const apply = (b: any) => {
          if (args.name !== undefined) b.name = String(args.name)
          if (args.color !== undefined) b.color = String(args.color)
          if (args.icon !== undefined) b.icon = String(args.icon)
          if (args.kind !== undefined) b.kind = args.kind
          if (args.category_map !== undefined) b.categoryMap = String(args.category_map)
          if (args.fallback_month_field !== undefined) b.fallbackMonthField = String(args.fallback_month_field)
        }
        if (args.id) {
          const b: any = findById(state.customBuckets, String(args.id), 'custom bucket')
          apply(b)
          return { created: false, bucket: { ...b } }
        }
        if (!args.name) throw new McpUserError('`name` is required when creating a bucket.')
        const b: any = { id: freshId((state.customBuckets || []).map((x) => x.id)), name: '', color: '#5e9eff', kind: 'expense' }
        apply(b)
        state.customBuckets = [...(state.customBuckets || []), b]
        return { created: true, bucket: b }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_custom_bucket',
    title: 'Delete custom bucket',
    description: 'Remove a custom bucket. The underlying expenses are untouched.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const b = findById(state.customBuckets, id, 'custom bucket')
        state.customBuckets = (state.customBuckets || []).filter((x) => x.id !== id)
        tombstone(state, 'customBuckets', id)
        return b
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },
]
