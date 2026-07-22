// MCP resources — documents a client can pull once and keep, rather than
// re-deriving from tool calls every turn.
import { calcAggregates, sortedMonthIds } from './calc.js'
import { mcpConfig } from './config.js'
import { ALL_TOOLS } from './registry.js'
import type { McpContext } from './types.js'

export interface ResourceDef {
  name: string
  uri: string
  title: string
  description: string
  mimeType: string
  read: (ctx: McpContext) => Promise<unknown>
}

export const MCP_RESOURCES: ResourceDef[] = [
  {
    name: 'guide',
    uri: 'dashboard://guide',
    title: 'Connector guide',
    description: 'How this connector is wired, which tool to reach for, and the traps worth knowing.',
    mimeType: 'text/markdown',
    read: async () => ({
      markdown: [
        `# ${mcpConfig.resourceName} MCP`,
        '',
        `Workspace: \`${mcpConfig.workspaceKey}\` · writes ${mcpConfig.allowWrites ? 'enabled' : 'DISABLED'} · ${ALL_TOOLS.length} tools.`,
        '',
        '## Where to start',
        '- `whoami` — what is connected and what is in the workspace.',
        '- `get_overview` — the headline P&L across a month range.',
        '- `get_data_dictionary` — field meanings and every formula.',
        '',
        '## The things models get wrong here',
        '1. **Two invoice systems.** `invoices` are OUTBOUND (you bill a client). `teamInvoices` are INBOUND (a team member bills you). They share nothing but the word.',
        '2. **Revenue lives on the month.** `months[].revenue` is the reported figure; `revenueEntries` are supporting lines that do NOT roll up automatically.',
        '3. **Line items beat month figures.** merchantFees, referralPayoutsTotal and founderComp use the summed expense category whenever it is non-zero, so editing the month figure can look like it did nothing.',
        '4. **GBP is canonical.** Foreign-currency expenses are stored as entered and converted on read at `meta.fxRates`.',
        '5. **Deletes are tombstones.** Removing a row writes `deletions["collection:id"]`; that is what makes a delete stick across devices — and why `undelete` exists.',
        '',
        '## Writing',
        'Every write goes through the same advisory-locked union merge a browser POST does, then pushes an SSE nudge, so open dashboard tabs update within a second or two. Destructive tools require `confirm:true`, and the bulk ones preview unless you pass `apply:true`.',
      ].join('\n'),
    }),
  },
  {
    name: 'schema',
    uri: 'dashboard://schema',
    title: 'Workspace schema',
    description: 'Collections, their fields, and the tools that read or write each one.',
    mimeType: 'application/json',
    read: async () => ({
      workspace_key: mcpConfig.workspaceKey,
      tools: ALL_TOOLS.map((t) => ({ name: t.name, title: t.title, write: Boolean(t.write), destructive: Boolean(t.destructive) })),
    }),
  },
  {
    name: 'snapshot',
    uri: 'dashboard://snapshot',
    title: 'Current numbers',
    description: 'A small always-current summary: month range, trailing-3-month aggregates, row counts.',
    mimeType: 'application/json',
    read: async (ctx) => {
      const { state, updated_at, updated_by } = await ctx.state()
      const months = sortedMonthIds(state)
      return {
        workspace: ctx.workspaceKey,
        last_changed_at: updated_at,
        last_changed_by: updated_by,
        months: { first: months[0] ?? null, last: months[months.length - 1] ?? null, count: months.length },
        trailing_3_months: calcAggregates(state, months.slice(-3)),
        counts: {
          expenses: (state.expenses || []).length,
          invoices: (state.invoices || []).length,
          teamInvoices: (state.teamInvoices || []).length,
          team: (state.team || []).length,
          tasks: (state.tasks || []).length,
        },
      }
    },
  },
]
