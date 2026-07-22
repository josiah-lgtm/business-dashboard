// The analytics surface — everything the Overview and Finance Hub views show,
// computed by the SAME engine the SPA uses (src/mcp/calc.ts is a verbatim port),
// so a number quoted here always matches the number on screen.
import { z } from 'zod'
import {
  CATEGORY_ORDER,
  DEFAULT_BUCKETS,
  calcAggregates,
  calcMonth,
  categoryTotals,
  decisionForCategory,
  expensesForMonth,
  gbpAmount,
  otherCategoryTotals,
  refundsForMonth,
  resolveMonths,
  round2,
  sortedMonthIds,
  teamCost,
} from '../calc.js'
import { rate } from '../envelope.js'
import { McpUserError, type ToolDef } from '../types.js'
import { requireMonth, requireWrite } from '../util.js'

const rangeSchema = {
  from: z.string().optional().describe('Inclusive first month, YYYY-MM.'),
  to: z.string().optional().describe('Inclusive last month, YYYY-MM.'),
  last_n: z.number().int().positive().optional().describe('Instead of from/to: the most recent N months on file.'),
}

/** The metrics get_metric_series can plot. Keys are MonthCalc fields. */
const SERIES_METRICS = [
  'revenue',
  'adjRev',
  'grossProfit',
  'netProfit',
  'grossMarginPct',
  'netMarginPct',
  'marketingCosts',
  'deliveryCosts',
  'overheadCosts',
  'totalExpenses',
  'refundsTotal',
  'refundPct',
  'overheadPct',
  'merchantFees',
  'founderComp',
  'taxReserve',
  'cacOverall',
  'avgGpPerClient',
  'churnRate',
  'newClients',
  'activeClients',
  'churnedClients',
] as const

export const TOOLS: ToolDef[] = [
  {
    name: 'get_overview',
    title: 'Overview',
    description:
      'Headline numbers over a month range: per-month P&L, aggregates, margins, CAC and the channel verdicts. The default "how is the business doing" call.',
    inputSchema: { ...rangeSchema },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const rows = range.months.map((m) => calcMonth(state, m)).filter(Boolean)
      const totals = calcAggregates(state, range.months)
      const latest = rows[rows.length - 1] ?? null
      const previous = rows.length > 1 ? rows[rows.length - 2] : null
      return {
        range: { from: range.from, to: range.to, months: range.months.length, label: range.label },
        totals,
        latest_month: latest,
        month_over_month: latest && previous
          ? {
              revenue: round2(latest.adjRev - previous.adjRev),
              netProfit: round2(latest.netProfit - previous.netProfit),
              marketingCosts: round2(latest.marketingCosts - previous.marketingCosts),
              netMarginPctPoints: round2(latest.netMarginPct - previous.netMarginPct),
            }
          : null,
        months: rows,
        channels: CATEGORY_ORDER.slice(0, 5).map((c) => decisionForCategory(state, c)),
        team_cost_monthly: teamCost(state),
      }
    },
  },

  {
    name: 'list_months',
    title: 'List months',
    description: 'Every month on file with its stored figures and computed revenue/profit. Cheap; call before any month-specific tool.',
    inputSchema: { ...rangeSchema },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      return {
        range: { from: range.from, to: range.to, label: range.label },
        count: range.months.length,
        months: range.months.map((m) => {
          const c = calcMonth(state, m)!
          const raw = state.months[m]
          return {
            month: m,
            revenue: c.revenue,
            adjRev: c.adjRev,
            netProfit: c.netProfit,
            netMarginPct: c.netMarginPct,
            expenseCount: c.expenseCount,
            figures: raw,
          }
        }),
      }
    },
  },

  {
    name: 'get_month',
    title: 'Month detail',
    description: 'Full P&L for one month: every derived metric, the category split, refunds, and the top line items.',
    inputSchema: {
      month: z.string().describe('YYYY-MM'),
      include_expenses: z.boolean().optional().describe('Include the month\'s expense rows (default true, capped at 100).'),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const month = requireMonth(args.month)
      const calc = calcMonth(state, month)
      if (!calc) {
        throw new McpUserError(
          `No month record for ${month}.`,
          `Months on file: ${sortedMonthIds(state).join(', ') || 'none'}. Use set_month_figures to create one.`,
        )
      }
      const expenses = expensesForMonth(state, month)
      return {
        ...calc,
        other_categories: otherCategoryTotals(state, month),
        refunds: refundsForMonth(state, month),
        revenue_entries: (state.revenueEntries || []).filter((r) => r.month === month),
        top_expenses: [...expenses]
          .sort((a, b) => gbpAmount(state, b) - gbpAmount(state, a))
          .slice(0, 10)
          .map((e) => ({ ...e, gbp: round2(gbpAmount(state, e)) })),
        expenses: args.include_expenses === false ? undefined : expenses.slice(0, 100),
      }
    },
  },

  {
    name: 'get_pnl',
    title: 'Profit & loss',
    description: 'Per-month P&L table (revenue, the three cost blocks, profit, margins) plus column totals.',
    inputSchema: { ...rangeSchema },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const rows = range.months.map((m) => {
        const c = calcMonth(state, m)!
        return {
          month: m,
          revenue: c.revenue,
          refunds: c.refundsTotal,
          merchantFees: c.merchantFees,
          adjRev: c.adjRev,
          delivery: c.deliveryCosts,
          marketing: c.marketingCosts,
          overhead: c.overheadCosts,
          grossProfit: c.grossProfit,
          netProfit: c.netProfit,
          grossMarginPct: c.grossMarginPct,
          netMarginPct: c.netMarginPct,
          taxReserve: c.taxReserve,
        }
      })
      return { range: { from: range.from, to: range.to, label: range.label }, rows, totals: calcAggregates(state, range.months) }
    },
  },

  {
    name: 'compare_months',
    title: 'Compare two months',
    description: 'Side-by-side metrics for two months with absolute and percentage deltas.',
    inputSchema: { a: z.string().describe('First month, YYYY-MM'), b: z.string().describe('Second month, YYYY-MM') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const a = calcMonth(state, requireMonth(args.a, 'a'))
      const b = calcMonth(state, requireMonth(args.b, 'b'))
      if (!a || !b) {
        throw new McpUserError(
          `Both months must exist. Missing: ${[!a ? args.a : null, !b ? args.b : null].filter(Boolean).join(', ')}.`,
          `On file: ${sortedMonthIds(state).join(', ')}`,
        )
      }
      const keys = ['revenue', 'adjRev', 'grossProfit', 'netProfit', 'marketingCosts', 'deliveryCosts', 'overheadCosts', 'totalExpenses', 'refundsTotal'] as const
      const deltas: Record<string, { a: number; b: number; delta: number; pct: number | null }> = {}
      for (const k of keys) {
        const av = a[k] as number
        const bv = b[k] as number
        deltas[k] = { a: av, b: bv, delta: round2(bv - av), pct: av !== 0 ? round2(((bv - av) / Math.abs(av)) * 100) : null }
      }
      return {
        a: { month: a.monthId, ...a },
        b: { month: b.monthId, ...b },
        deltas,
        margin_points: {
          grossMarginPct: round2(b.grossMarginPct - a.grossMarginPct),
          netMarginPct: round2(b.netMarginPct - a.netMarginPct),
        },
      }
    },
  },

  {
    name: 'get_metric_series',
    title: 'Metric timeseries',
    description: `Monthly series for one metric. Metrics: ${SERIES_METRICS.join(', ')}.`,
    inputSchema: {
      metric: z.string().describe('One of the metric keys listed in the description.'),
      ...rangeSchema,
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const metric = String(args.metric)
      if (!(SERIES_METRICS as readonly string[]).includes(metric)) {
        throw new McpUserError(`Unknown metric "${metric}".`, `Valid metrics: ${SERIES_METRICS.join(', ')}`)
      }
      const range = resolveMonths(state, args)
      const points = range.months.map((m) => {
        const c = calcMonth(state, m)!
        return { month: m, value: (c as any)[metric] as number | null }
      })
      const nums = points.map((p) => p.value).filter((v): v is number => typeof v === 'number')
      const first = nums[0]
      const last = nums[nums.length - 1]
      return {
        metric,
        range: { from: range.from, to: range.to, label: range.label },
        points,
        summary: {
          min: nums.length ? round2(Math.min(...nums)) : null,
          max: nums.length ? round2(Math.max(...nums)) : null,
          mean: nums.length ? round2(nums.reduce((s, v) => s + v, 0) / nums.length) : null,
          first: first ?? null,
          last: last ?? null,
          change: nums.length > 1 ? round2(last - first) : null,
          change_pct: nums.length > 1 && first !== 0 ? round2(((last - first) / Math.abs(first)) * 100) : null,
        },
      }
    },
  },

  {
    name: 'get_category_breakdown',
    title: 'Category breakdown',
    description: 'Spend per expense category per month (GBP-converted), with row and column totals and each category\'s share.',
    inputSchema: { ...rangeSchema, include_other: z.boolean().optional().describe('Also break out non-canonical categories found in the data.') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const perMonth = range.months.map((m) => ({ month: m, ...categoryTotals(state, m) }))
      const totals: Record<string, number> = {}
      for (const c of CATEGORY_ORDER) totals[c] = round2(perMonth.reduce((s, r) => s + ((r as any)[c] || 0), 0))
      const grand = round2(Object.values(totals).reduce((s, v) => s + v, 0))
      const other: Record<string, number> = {}
      if (args.include_other) {
        for (const m of range.months) {
          for (const [k, v] of Object.entries(otherCategoryTotals(state, m))) other[k] = round2((other[k] || 0) + v)
        }
      }
      return {
        range: { from: range.from, to: range.to, label: range.label },
        per_month: perMonth.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]))),
        totals,
        grand_total: grand,
        share_pct: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, grand > 0 ? round2((v / grand) * 100) : 0])),
        ...(args.include_other ? { other_categories: other } : {}),
      }
    },
  },

  {
    name: 'get_bucket_totals',
    title: 'Finance Hub buckets',
    description: 'Totals per Finance Hub bucket (the default buckets plus any custom ones), month by month.',
    inputSchema: { ...rangeSchema },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const buckets = [
        ...DEFAULT_BUCKETS.map((b) => ({ ...b })),
        ...((state.customBuckets || []).map((b) => ({
          id: b.id,
          name: b.name,
          kind: (b.kind || 'expense') as string,
          categoryMap: b.categoryMap,
          fallbackMonthField: b.fallbackMonthField,
        })) as any[]),
      ]
      const rows = buckets.map((b: any) => {
        const per = range.months.map((m) => {
          const month: any = state.months[m] || {}
          if (b.kind === 'refund') return round2(refundsForMonth(state, m).reduce((s, r) => s + (Number(r.amount) || 0), 0) || month.refundsTotal || 0)
          if (b.kind === 'team') return round2((month.salariesTotal || 0) + (month.commissionsTotal || 0))
          const fromItems = b.categoryMap ? categoryTotals(state, m)[b.categoryMap] || otherCategoryTotals(state, m)[b.categoryMap] || 0 : 0
          if (fromItems > 0) return round2(fromItems)
          return round2(b.fallbackMonthField ? Number(month[b.fallbackMonthField]) || 0 : 0)
        })
        return {
          bucket: b.name,
          id: b.id,
          kind: b.kind,
          per_month: Object.fromEntries(range.months.map((m, i) => [m, per[i]])),
          total: round2(per.reduce((s, v) => s + v, 0)),
        }
      })
      return { range: { from: range.from, to: range.to, label: range.label }, buckets: rows }
    },
  },

  {
    name: 'get_channel_decisions',
    title: 'Channel verdicts',
    description: 'The Overview "double down / maintain / fix" verdict per marketing channel, from the last 3 months of spend.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state } = await ctx.state()
      return { channels: CATEGORY_ORDER.map((c) => decisionForCategory(state, c)) }
    },
  },

  {
    name: 'get_budget_health',
    title: 'Targets vs actuals',
    description: 'Every target in Settings scored against the latest month and the trailing 3, with pass/fail verdicts.',
    inputSchema: { month: z.string().optional().describe('Month to score, YYYY-MM. Defaults to the latest on file.') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const months = sortedMonthIds(state)
      const month = args.month ? requireMonth(args.month) : months[months.length - 1]
      if (!month) throw new McpUserError('No months on file to score.')
      const c = calcMonth(state, month)
      if (!c) throw new McpUserError(`No month record for ${month}.`, `On file: ${months.join(', ')}`)
      const t = state.targets || ({} as any)
      const check = (label: string, actual: number | null, target: number | null, dir: 'min' | 'max') => ({
        metric: label,
        actual,
        target,
        direction: dir === 'min' ? 'at or above target' : 'at or below target',
        verdict: actual == null || target == null ? 'no target' : dir === 'min' ? (actual >= target ? 'pass' : 'miss') : actual <= target ? 'pass' : 'miss',
        gap: actual == null || target == null ? null : round2(dir === 'min' ? actual - target : target - actual),
      })
      const trailing = calcAggregates(state, months.slice(-3))
      return {
        month,
        checks: [
          check('grossMarginPct', c.grossMarginPct, t.gmPct ?? null, 'min'),
          check('netMarginPct', c.netMarginPct, t.nmPct ?? null, 'min'),
          check('refundPct', c.refundPct, t.refundPctMax ?? null, 'max'),
          check('overheadPct', c.overheadPct, t.overheadPctMax ?? null, 'max'),
        ],
        trailing_3_months: trailing,
        cash_target_months: t.cashMonths ?? null,
        monthly_burn_estimate: round2(c.totalExpenses),
        cash_needed_for_target: t.cashMonths ? round2(c.totalExpenses * t.cashMonths) : null,
        tax_set_aside: { taxReserve: c.taxReserve, founderTaxReserve: c.founderTaxReserve, total: c.totalToSetAside },
      }
    },
  },

  {
    name: 'forecast_month',
    title: 'Run-rate forecast',
    description: 'Projects the next month from a trailing average of revenue and each cost block. A straight run rate — no seasonality, no pipeline.',
    inputSchema: { basis_months: z.number().int().min(1).max(12).optional().describe('How many trailing months to average (default 3).') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const months = sortedMonthIds(state)
      const n = Math.min(Number(args.basis_months) || 3, months.length)
      if (!n) throw new McpUserError('No months on file to forecast from.')
      const basis = months.slice(-n)
      const rows = basis.map((m) => calcMonth(state, m)!)
      const avg = (k: keyof (typeof rows)[number]) => round2(rows.reduce((s, r) => s + ((r[k] as number) || 0), 0) / rows.length)
      const revenue = avg('adjRev')
      const marketing = avg('marketingCosts')
      const delivery = avg('deliveryCosts')
      const overhead = avg('overheadCosts')
      const net = round2(revenue - (marketing + delivery + overhead))
      const [y, mo] = basis[basis.length - 1].split('-').map(Number)
      const nextMonth = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
      return {
        basis_months: basis,
        projected_month: nextMonth,
        projection: {
          adjRev: revenue,
          marketingCosts: marketing,
          deliveryCosts: delivery,
          overheadCosts: overhead,
          netProfit: net,
          netMarginPct: revenue > 0 ? round2((net / revenue) * 100) : null,
        },
        caveat: 'Trailing average only. It carries no seasonality, no signed pipeline and no known one-offs — treat it as a floor for discussion, not a plan.',
      }
    },
  },

  {
    name: 'get_settings',
    title: 'Settings',
    description: 'Targets, business details, FX rates and invoice numbering — everything on the Settings screen except secrets.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state } = await ctx.state()
      const fx = (state.meta?.fxRates || {}) as Record<string, number>
      const b: any = state.business || {}
      const { logoDataUrl, banks, ...business } = b
      return {
        targets: state.targets,
        business: { ...business, hasLogo: Boolean(logoDataUrl) },
        bank_accounts: Object.keys(banks || {}),
        fx_rates: { USD: fx.USD ?? null, EUR: fx.EUR ?? null, updated_at: fx._updatedAt ? new Date(Number(fx._updatedAt)).toISOString() : null },
        invoice_counter: state.meta?.invoiceCounter ?? null,
        slack_webhook_configured: Boolean(state.slackWebhookUrl),
      }
    },
  },

  {
    name: 'set_targets',
    title: 'Set targets',
    description: 'Update the Settings targets (margins, tax %, cash months, refund/overhead ceilings). Only the fields you pass change.',
    write: true,
    inputSchema: {
      gmPct: z.number().optional().describe('Gross margin target, %'),
      nmPct: z.number().optional().describe('Net margin target, %'),
      taxPct: z.number().optional().describe('Company tax reserve, %'),
      founderTaxPct: z.number().optional().describe('Founder tax reserve, %'),
      cashMonths: z.number().optional().describe('Months of runway to hold'),
      refundPctMax: z.number().optional().describe('Refund ceiling, %'),
      overheadPctMax: z.number().optional().describe('Overhead ceiling, % of adjusted revenue'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const fields = ['gmPct', 'nmPct', 'taxPct', 'founderTaxPct', 'cashMonths', 'refundPctMax', 'overheadPctMax'] as const
      const given = fields.filter((f) => args[f] !== undefined)
      if (!given.length) throw new McpUserError('Pass at least one target to change.')
      const out = await ctx.mutate((state) => {
        const t: any = { ...(state.targets || {}) }
        for (const f of given) t[f] = Number(args[f])
        state.targets = t
        return t
      })
      return { updated: given, targets: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'set_month_figures',
    title: 'Set month figures',
    description:
      'Create or update a month record (revenue, salaries, commissions, client counts…). Only the fields you pass change. Line-item totals still win where they exist.',
    write: true,
    inputSchema: {
      month: z.string().describe('YYYY-MM'),
      revenue: z.number().optional(),
      merchantFees: z.number().optional(),
      salariesTotal: z.number().optional(),
      commissionsTotal: z.number().optional(),
      referralPayoutsTotal: z.number().optional(),
      refundsTotal: z.number().optional(),
      founderComp: z.number().optional(),
      taxPct: z.number().optional(),
      newClients: z.number().optional(),
      activeClients: z.number().optional(),
      churnedClients: z.number().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const month = requireMonth(args.month)
      const fields = [
        'revenue', 'merchantFees', 'salariesTotal', 'commissionsTotal', 'referralPayoutsTotal',
        'refundsTotal', 'founderComp', 'taxPct', 'newClients', 'activeClients', 'churnedClients',
      ] as const
      const given = fields.filter((f) => args[f] !== undefined)
      if (!given.length) throw new McpUserError('Pass at least one figure to set.')
      const out = await ctx.mutate((state) => {
        state.months = state.months || {}
        const existed = Boolean(state.months[month])
        // A new month starts from the same blank shape the SPA creates, so a
        // month written here is indistinguishable from one created in the UI.
        const blank = {
          revenue: 0,
          merchantFees: 0,
          salariesTotal: 0,
          commissionsTotal: 0,
          referralPayoutsTotal: 0,
          refundsTotal: 0,
          founderComp: 0,
          taxPct: state.targets?.taxPct ?? 15,
          newClients: 0,
          activeClients: 0,
          churnedClients: 0,
        }
        const m: any = { ...blank, ...(state.months[month] || {}) }
        for (const f of given) m[f] = Number(args[f])
        state.months[month] = m
        // Re-creating a month that was deleted must clear the tombstone, or the
        // merge would delete it again on the next sync.
        if (state.deletions) delete state.deletions[`months:${month}`]
        return { created: !existed, figures: m }
      })
      const { state } = await ctx.state()
      return { month, ...out.result, calc: calcMonth(state, month), changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_month',
    title: 'Delete month',
    description: 'Remove a month record. Its expenses/refunds are NOT deleted. Requires confirm:true.',
    write: true,
    destructive: true,
    inputSchema: { month: z.string().describe('YYYY-MM'), confirm: z.boolean().describe('Must be true.') },
    handler: async (args, ctx) => {
      requireWrite()
      const month = requireMonth(args.month)
      if (args.confirm !== true) throw new McpUserError('Refusing to delete a month without confirm:true.')
      const out = await ctx.mutate((state) => {
        if (!state.months?.[month]) throw new McpUserError(`No month record for ${month}.`)
        const removed = state.months[month]
        delete state.months[month]
        state.deletions = state.deletions || {}
        state.deletions[`months:${month}`] = new Date().toISOString()
        return removed
      })
      return { deleted_month: month, figures: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_client_economics',
    title: 'Client economics',
    description: 'CAC, gross profit per client, churn and client counts per month — the unit-economics view.',
    inputSchema: { ...rangeSchema },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const rows = range.months.map((m) => {
        const c = calcMonth(state, m)!
        return {
          month: m,
          newClients: c.newClients,
          activeClients: c.activeClients,
          churnedClients: c.churnedClients,
          marketingCosts: c.marketingCosts,
          cac: c.cacOverall,
          grossProfitPerClient: c.avgGpPerClient,
          churn: rate(c.churnedClients, c.activeClients),
          payback_months: c.cacOverall && c.avgGpPerClient && c.avgGpPerClient > 0 ? round2(c.cacOverall / c.avgGpPerClient) : null,
        }
      })
      const totalNew = rows.reduce((s, r) => s + r.newClients, 0)
      const totalMarketing = round2(rows.reduce((s, r) => s + r.marketingCosts, 0))
      return {
        range: { from: range.from, to: range.to, label: range.label },
        rows,
        blended: {
          new_clients: totalNew,
          marketing_spend: totalMarketing,
          blended_cac: totalNew > 0 ? round2(totalMarketing / totalNew) : null,
        },
      }
    },
  },
]
