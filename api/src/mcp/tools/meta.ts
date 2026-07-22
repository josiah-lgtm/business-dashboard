// Orientation tools: who am I connected as, what is in here, is it fresh.
// These are the cheapest calls in the catalog and the most load-bearing — they
// are what stops a model guessing a month id or inventing a field name.
import { z } from 'zod'
import { prisma } from '../../db.js'
import { mcpConfig } from '../config.js'
import { CATEGORY_ORDER, DEFAULT_BUCKETS, calcAggregates, sortedMonthIds, teamCost } from '../calc.js'
import { MONEY_NOTE } from '../envelope.js'
import type { ToolDef } from '../types.js'
import { safeBusiness, safeMember, todayMonth } from '../util.js'

const collectionCounts = (s: any) => ({
  months: Object.keys(s.months || {}).length,
  expenses: (s.expenses || []).length,
  vendors: (s.vendors || []).length,
  refunds: (s.refunds || []).length,
  team: (s.team || []).length,
  tasks: (s.tasks || []).length,
  invoices: (s.invoices || []).length,
  teamInvoices: (s.teamInvoices || []).length,
  revenueEntries: (s.revenueEntries || []).length,
  customBuckets: (s.customBuckets || []).length,
  teamPayouts: (s.teamPayouts || []).length,
  budgets: Object.keys(s.budgets || {}).length,
  tombstones: Object.keys(s.deletions || {}).length,
})

export const TOOLS: ToolDef[] = [
  {
    name: 'whoami',
    title: 'Who am I',
    description:
      'Connection identity, the workspace served, what is in it, and the month range on file. Call this first.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state, exists, updated_at, updated_by } = await ctx.state()
      const months = sortedMonthIds(state)
      return {
        connection: {
          client: ctx.auth.clientName || ctx.auth.clientId,
          client_id: ctx.auth.clientId,
          auth_method: ctx.auth.authMethod,
          scope: ctx.auth.scope,
          server: `${mcpConfig.serverName} v${mcpConfig.serverVersion}`,
          endpoint: mcpConfig.resourceUrl,
        },
        workspace: {
          key: ctx.workspaceKey,
          exists,
          writes_enabled: mcpConfig.allowWrites,
          sql_enabled: mcpConfig.allowSql,
          last_changed_at: updated_at,
          last_changed_by: updated_by,
        },
        data: {
          ...collectionCounts(state),
          first_month: months[0] ?? null,
          last_month: months[months.length - 1] ?? null,
          current_month: todayMonth(),
        },
        business: safeBusiness(state.business),
        start_here:
          'get_overview for the headline numbers, list_months for what exists, get_data_dictionary for field meanings.',
      }
    },
  },

  {
    name: 'get_data_dictionary',
    title: 'Data dictionary',
    description:
      'Every collection, its fields, the expense categories, and the exact formulas behind revenue, margin and CAC.',
    inputSchema: {},
    handler: async () => ({
      note: MONEY_NOTE,
      storage:
        'One shared workspace blob synced between browsers and this connector. Writes here go through the same ' +
        'union-merge + advisory lock a browser POST does, so nothing is ever silently overwritten, and every open ' +
        'dashboard tab is pushed the change immediately.',
      collections: {
        months: 'Record<YYYY-MM, Month>. Hand-entered monthly figures: revenue, merchantFees, salariesTotal, commissionsTotal, referralPayoutsTotal, refundsTotal, founderComp, taxPct, newClients, activeClients, churnedClients.',
        expenses: 'id, date (YYYY-MM-DD), vendor, category, amount, currency?, month (YYYY-MM). The line-item spend ledger.',
        vendors: 'id, name, category, typicalAmount, recurring. A reusable library, NOT the spend itself.',
        refunds: 'id, month, date?, recipient, amount, currency?.',
        revenueEntries: 'id, month, date, amount, source, notes. Individual cash-in lines; months[].revenue is the figure the dashboard actually reports.',
        team: 'id, name, role, payType (salary|commission), monthlySalary, commissionAmount, active, isFounder?, email, country, bank. The portal password is never exposed by this connector.',
        teamPayouts: 'id, memberId, month, date, amount, type, invoiceId?, invoiceNumber?, notes?.',
        tasks: 'id, title, status (todo|in-progress|done|cancelled), linkedVendorId, action, notes, createdAt.',
        invoices: 'OUTBOUND invoices you send: id, number, date, status (draft|sent|paid), currency, client{name,email,address}, items[{description,qty,rate}], subtotal, taxPct, tax, total, notes.',
        teamInvoices: 'INBOUND invoices your team submits: id, memberId, number, date, dueDate?, period?, services?, hours?, rate?, amount, taxPct?, currency?, status (draft|pending|submitted|accepted|paid).',
        budgets: 'Record<key, Budget>. Saved budget scenarios; dynamic numeric fields plus _savedAt.',
        customBuckets: 'id, name, color, icon?, kind (expense|team|refund), categoryMap?, fallbackMonthField?. User-defined Finance Hub buckets on top of the defaults.',
        deletions: 'Tombstone map "collection:id" -> ISO timestamp. Delete-wins across devices; this is why deletes stick.',
      },
      categories: CATEGORY_ORDER,
      default_buckets: DEFAULT_BUCKETS,
      formulas: {
        adjRev: 'revenue - refundsTotal - merchantFees',
        marketingCosts: 'LinkedIn Channel + Email Channel + SMS + One off + commissionsTotal',
        deliveryCosts: 'Base Software',
        overheadCosts: 'salariesTotal + referralPayoutsTotal',
        totalExpenses: 'marketingCosts + deliveryCosts + overheadCosts + refundsTotal',
        grossProfit: 'adjRev - deliveryCosts',
        netProfit: 'adjRev - (totalExpenses - refundsTotal)',
        grossMarginPct: 'grossProfit / adjRev * 100 (0 when adjRev <= 0)',
        netMarginPct: 'netProfit / adjRev * 100 (0 when adjRev <= 0)',
        refundPct: 'refundsTotal / revenue * 100',
        overheadPct: 'overheadCosts / adjRev * 100',
        taxReserve: 'max(0, netProfit) * month.taxPct / 100',
        founderTaxReserve: 'founderComp * targets.founderTaxPct / 100',
        cacOverall: 'marketingCosts / newClients (null when newClients = 0)',
        avgGpPerClient: 'grossProfit / activeClients (null when activeClients = 0)',
        churnRate: 'churnedClients / activeClients * 100',
      },
      fallback_rule:
        'merchantFees, referralPayoutsTotal and founderComp each prefer the summed line items of the matching expense ' +
        'category; the month-level number is used ONLY when that sum is zero. refundsTotal prefers the refunds ledger. ' +
        'This is why editing a month figure can appear to do nothing when line items already cover it.',
    }),
  },

  {
    name: 'get_sync_status',
    title: 'Sync status',
    description: 'When the workspace last changed and by whom, FX-rate freshness, snapshot count, row counts.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state, exists, updated_at, updated_by } = await ctx.state()
      const [snapshots, latest] = await Promise.all([
        prisma.snapshot.count({ where: { workspaceId: ctx.workspaceKey } }),
        prisma.snapshot.findFirst({
          where: { workspaceId: ctx.workspaceKey },
          orderBy: { takenAt: 'desc' },
          select: { takenAt: true, reason: true, updatedBy: true },
        }),
      ])
      const fx = (state.meta?.fxRates || {}) as Record<string, number>
      const fxStamp = Number(fx._updatedAt) || 0
      return {
        workspace: ctx.workspaceKey,
        exists,
        last_changed_at: updated_at,
        last_changed_by: updated_by,
        counts: collectionCounts(state),
        fx_rates: { USD: fx.USD ?? null, EUR: fx.EUR ?? null },
        fx_updated_at: fxStamp ? new Date(fxStamp).toISOString() : null,
        fx_age_hours: fxStamp ? Math.round(((Date.now() - fxStamp) / 3_600_000) * 10) / 10 : null,
        snapshots,
        latest_snapshot: latest,
      }
    },
  },

  {
    name: 'list_workspaces',
    title: 'List workspaces',
    description:
      'Every workspace key in the database with its row counts. Only the one marked `served` is readable/writable here.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const rows = await prisma.workspace.findMany({
        select: { key: true, dataUpdatedAt: true, updatedBy: true, createdAt: true },
        orderBy: { dataUpdatedAt: 'desc' },
      })
      const counts = await Promise.all(
        rows.map(async (w) => ({
          key: w.key,
          served: w.key === ctx.workspaceKey,
          last_changed_at: w.dataUpdatedAt.toISOString(),
          last_changed_by: w.updatedBy,
          expenses: await prisma.expense.count({ where: { workspaceId: w.key, deletedAt: null } }),
          months: await prisma.monthFigure.count({ where: { workspaceId: w.key, deletedAt: null } }),
        })),
      )
      return {
        served: ctx.workspaceKey,
        workspaces: counts,
        note_on_switching:
          'The served workspace is fixed by MCP_WORKSPACE_KEY on the server. It is deliberately not a per-call ' +
          'argument — a mistyped workspace on a write would put an expense somewhere nobody is looking.',
      }
    },
  },

  {
    name: 'export_state',
    title: 'Export workspace',
    description:
      'The full workspace blob, portal passwords stripped and the logo omitted. Large — pass `collections` to narrow it.',
    inputSchema: {
      collections: z
        .array(z.string())
        .optional()
        .describe('Subset to return, e.g. ["expenses","months"]. Omit for everything.'),
    },
    handler: async (args, ctx) => {
      const { state, updated_at } = await ctx.state()
      const clone: any = { ...state }
      clone.team = (state.team || []).map(safeMember)
      clone.business = safeBusiness(state.business)
      if (Array.isArray(args.collections) && args.collections.length) {
        const wanted = new Set(args.collections as string[])
        for (const k of Object.keys(clone)) if (!wanted.has(k)) delete clone[k]
      }
      return { workspace: ctx.workspaceKey, exported_at: new Date().toISOString(), last_changed_at: updated_at, state: clone }
    },
  },

  {
    name: 'get_health_summary',
    title: 'Business health summary',
    description:
      'One-call verdict: latest month vs targets, trailing-3-month aggregates, payroll load and open work. Good opener for "how are we doing".',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const { state } = await ctx.state()
      const months = sortedMonthIds(state)
      const last = months[months.length - 1] ?? null
      const trailing = calcAggregates(state, months.slice(-3))
      const t = state.targets || ({} as any)
      const cost = teamCost(state)
      const openTasks = (state.tasks || []).filter((x) => x.status === 'todo' || x.status === 'in-progress').length
      const unpaidOut = (state.invoices || []).filter((i) => i.status !== 'paid')
      const pendingIn = (state.teamInvoices || []).filter((i) => i.status !== 'paid')
      return {
        latest_month: last,
        trailing_3_months: trailing,
        targets: {
          grossMarginPct: t.gmPct ?? null,
          netMarginPct: t.nmPct ?? null,
          refundPctMax: t.refundPctMax ?? null,
          overheadPctMax: t.overheadPctMax ?? null,
          cashMonths: t.cashMonths ?? null,
        },
        payroll: cost,
        open_tasks: openTasks,
        outbound_invoices_unpaid: { count: unpaidOut.length, total: Math.round(unpaidOut.reduce((s, i) => s + (i.total || 0), 0) * 100) / 100 },
        inbound_invoices_unpaid: { count: pendingIn.length, total: Math.round(pendingIn.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100 },
        next_step: 'get_overview for the same numbers with per-month detail, or get_budget_health for target-by-target verdicts.',
      }
    },
  },
]
