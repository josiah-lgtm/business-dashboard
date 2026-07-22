// ChatGPT compatibility bridge.
//
// Two tools named literally `search` and `fetch`, with the literal input
// signatures `{ query: string }` and `{ id: string }`. Those names and shapes
// are a hard requirement: ChatGPT admits an MCP server as a knowledge source
// only when both INPUT signatures match, and the deep-research models refuse a
// server that does not implement the pair. Renaming either tool, adding a second
// required input, or nesting `query` under an object silently removes this
// connector from both surfaces.
//
// The contract (developers.openai.com/api/docs/mcp):
//   search → { results: [{ id, title, url }] }
//   fetch  → { id, title, text, url, metadata }
//
// Two rules that are easy — and expensive — to get wrong:
//   • `url` must be an ABSOLUTE, user-openable app URL or "". ChatGPT mints a
//     citation only for a non-empty url, so every opaque handle lives in `id`.
//   • `id` round-trips verbatim from search to fetch. Ours is prefixed so fetch
//     can dispatch without a lookup table:
//        month:YYYY-MM | expense:<id> | invoice:<id> | teaminvoice:<id>
//        task:<id> | member:<id> | vendor:<id> | refund:<id> | revenue:<id>
import { z } from 'zod'
import { mcpConfig } from '../config.js'
import { calcMonth, gbpAmount, monthOf, round2, sortedMonthIds } from '../calc.js'
import { McpUserError, type ToolDef } from '../types.js'
import { matches, safeMember } from '../util.js'

/** The SPA is hash-routed; these are the deep links a person can actually open. */
const VIEW: Record<string, string> = {
  month: '/overview',
  expense: '/finance',
  vendor: '/finance',
  refund: '/finance',
  revenue: '/finance',
  member: '/finance',
  task: '/tasks',
  invoice: '/invoices',
  teaminvoice: '/invoices',
}

function appUrl(kind: string): string {
  return `${mcpConfig.publicUrl}/#${VIEW[kind] || '/overview'}`
}

interface Hit {
  id: string
  title: string
  url: string
  score: number
}

export const TOOLS: ToolDef[] = [
  {
    name: 'search',
    title: 'Search the dashboard',
    description:
      'Free-text search across months, expenses, vendors, invoices, team, tasks, refunds and revenue entries. Returns handles for `fetch`.',
    bareResult: true,
    inputSchema: { query: z.string().describe('What to look for.') },
    outputSchema: {
      results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const q = String(args.query || '').trim()
      const hits: Hit[] = []
      const push = (kind: string, id: string, title: string, score: number) =>
        hits.push({ id: `${kind}:${id}`, title, url: appUrl(kind), score })

      const needle = q.toLowerCase()
      // Months: match the id itself, and always surface the latest few for a
      // vague query like "revenue" so the model has something to fetch.
      for (const m of sortedMonthIds(state)) {
        const c = calcMonth(state, m)
        if (!c) continue
        const title = `${m} — revenue £${c.adjRev.toLocaleString('en-GB')}, net £${c.netProfit.toLocaleString('en-GB')}`
        if (!q || m.includes(needle) || /revenue|profit|month|p&l|pnl|margin/.test(needle)) push('month', m, title, m >= (sortedMonthIds(state).slice(-3)[0] || '') ? 3 : 1)
      }
      for (const e of state.expenses || []) {
        if (matches(q, e.vendor, e.category, e.month)) {
          push('expense', e.id, `Expense ${e.date} · ${e.vendor} · ${e.category} · £${round2(gbpAmount(state, e))}`, 2)
        }
      }
      for (const v of state.vendors || []) {
        if (matches(q, v.name, v.category)) push('vendor', v.id, `Vendor ${v.name} (${v.category})`, 2)
      }
      for (const i of state.invoices || []) {
        if (matches(q, i.number, i.client?.name, i.notes, i.status)) {
          push('invoice', i.id, `Invoice ${i.number} · ${i.client?.name ?? 'client'} · ${i.status} · ${i.currency} ${i.total}`, 3)
        }
      }
      for (const i of state.teamInvoices || []) {
        const name = (state.team || []).find((m) => m.id === i.memberId)?.name ?? 'member'
        if (matches(q, i.number, i.services, i.notes, i.status, name)) {
          push('teaminvoice', i.id, `Team invoice ${i.number} · ${name} · ${i.status} · ${i.amount}`, 3)
        }
      }
      for (const m of state.team || []) {
        if (matches(q, m.name, m.role, m.email)) push('member', m.id, `Team · ${m.name} (${m.role})`, 3)
      }
      for (const t of state.tasks || []) {
        if (matches(q, t.title, t.action, t.notes, t.status)) push('task', t.id, `Task · ${t.title} [${t.status}]`, 2)
      }
      for (const r of state.refunds || []) {
        if (matches(q, r.recipient, r.month)) push('refund', r.id, `Refund ${r.month} · ${r.recipient} · ${r.amount}`, 2)
      }
      for (const r of state.revenueEntries || []) {
        if (matches(q, r.source, r.notes, r.month)) push('revenue', r.id, `Revenue ${r.date} · ${r.source} · ${r.amount}`, 2)
      }

      hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      return { results: hits.slice(0, 40).map(({ id, title, url }) => ({ id, title, url })) }
    },
  },

  {
    name: 'fetch',
    title: 'Fetch a record',
    description: 'Retrieve the full record behind an id returned by `search`.',
    bareResult: true,
    inputSchema: { id: z.string().describe('An id from `search`, e.g. "expense:ab12cd34".') },
    outputSchema: {
      id: z.string(),
      title: z.string(),
      text: z.string(),
      url: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const raw = String(args.id || '')
      const sep = raw.indexOf(':')
      if (sep < 0) throw new McpUserError(`"${raw}" is not a fetch handle.`, 'Use an id returned by `search`, e.g. "month:2026-05".')
      const kind = raw.slice(0, sep)
      const id = raw.slice(sep + 1)
      const url = appUrl(kind)

      const wrap = (title: string, body: unknown, metadata: Record<string, unknown> = {}) => ({
        id: raw,
        title,
        text: JSON.stringify(body, null, 2),
        url,
        metadata: { kind, workspace: ctx.workspaceKey, ...metadata },
      })

      switch (kind) {
        case 'month': {
          const c = calcMonth(state, id)
          if (!c) throw new McpUserError(`No month ${id}.`)
          return wrap(`Month ${id}`, { ...c, figures: state.months[id] }, { month: id })
        }
        case 'expense': {
          const e = (state.expenses || []).find((x) => x.id === id)
          if (!e) throw new McpUserError(`No expense ${id}.`)
          return wrap(`Expense ${e.date} · ${e.vendor}`, { ...e, gbp: round2(gbpAmount(state, e)) }, { month: e.month || monthOf(e.date) })
        }
        case 'vendor': {
          const v = (state.vendors || []).find((x) => x.id === id)
          if (!v) throw new McpUserError(`No vendor ${id}.`)
          const spend = (state.expenses || []).filter((e) => e.vendor === v.name)
          return wrap(`Vendor ${v.name}`, { ...v, expense_count: spend.length, total_gbp: round2(spend.reduce((s, e) => s + gbpAmount(state, e), 0)) })
        }
        case 'invoice': {
          const i = (state.invoices || []).find((x) => x.id === id)
          if (!i) throw new McpUserError(`No invoice ${id}.`)
          return wrap(`Invoice ${i.number}`, i, { status: i.status })
        }
        case 'teaminvoice': {
          const i = (state.teamInvoices || []).find((x) => x.id === id)
          if (!i) throw new McpUserError(`No team invoice ${id}.`)
          const name = (state.team || []).find((m) => m.id === i.memberId)?.name ?? null
          return wrap(`Team invoice ${i.number}`, { ...i, memberName: name }, { status: i.status })
        }
        case 'member': {
          const m = (state.team || []).find((x) => x.id === id)
          if (!m) throw new McpUserError(`No team member ${id}.`)
          return wrap(`Team · ${m.name}`, safeMember(m), { active: m.active })
        }
        case 'task': {
          const t = (state.tasks || []).find((x) => x.id === id)
          if (!t) throw new McpUserError(`No task ${id}.`)
          return wrap(`Task · ${t.title}`, t, { status: t.status })
        }
        case 'refund': {
          const r = (state.refunds || []).find((x) => x.id === id)
          if (!r) throw new McpUserError(`No refund ${id}.`)
          return wrap(`Refund ${r.month} · ${r.recipient}`, r, { month: r.month })
        }
        case 'revenue': {
          const r = (state.revenueEntries || []).find((x) => x.id === id)
          if (!r) throw new McpUserError(`No revenue entry ${id}.`)
          return wrap(`Revenue ${r.date} · ${r.source}`, r, { month: r.month })
        }
        default:
          throw new McpUserError(`Unknown handle type "${kind}".`, 'Valid types: month, expense, vendor, invoice, teaminvoice, member, task, refund, revenue.')
      }
    },
  },
]
