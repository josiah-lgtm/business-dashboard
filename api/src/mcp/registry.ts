// The whole tool catalog, assembled from the per-group modules. One file per
// domain area; each exports exactly one symbol: `export const TOOLS: ToolDef[]`.
import type { ToolDef } from './types.js'

import { TOOLS as metaTools } from './tools/meta.js'
import { TOOLS as financeTools } from './tools/finance.js'
import { TOOLS as expenseTools } from './tools/expenses.js'
import { TOOLS as revenueTools } from './tools/revenue.js'
import { TOOLS as teamTools } from './tools/team.js'
import { TOOLS as taskTools } from './tools/tasks.js'
import { TOOLS as invoiceTools } from './tools/invoices.js'
import { TOOLS as teamInvoiceTools } from './tools/team-invoices.js'
import { TOOLS as settingsTools } from './tools/settings.js'
import { TOOLS as sqlTools } from './tools/sql.js'
import { TOOLS as opsTools } from './tools/ops.js'
import { TOOLS as searchTools } from './tools/search.js'

export const ALL_TOOLS: ToolDef[] = [
  ...metaTools,
  ...financeTools,
  ...expenseTools,
  ...revenueTools,
  ...teamTools,
  ...taskTools,
  ...invoiceTools,
  ...teamInvoiceTools,
  ...settingsTools,
  ...sqlTools,
  ...opsTools,
  ...searchTools,
]

// ---- load-time integrity assertions -----------------------------------------
// A duplicate name silently shadows a tool at registration time and the loss is
// invisible until somebody notices an answer is missing. Fail at import instead.
{
  const seen = new Map<string, number>()
  const problems: string[] = []
  for (const t of ALL_TOOLS) {
    if (!t?.name) {
      problems.push(`tool with no name (title=${t?.title ?? '?'})`)
      continue
    }
    if (t.name.length > 64) problems.push(`tool name over 64 chars: "${t.name}"`)
    if (!/^[a-z][a-z0-9_]*$/.test(t.name)) problems.push(`tool name is not snake_case: "${t.name}"`)
    if (!t.description) problems.push(`tool "${t.name}" has no description`)
    seen.set(t.name, (seen.get(t.name) ?? 0) + 1)
  }
  for (const [name, n] of seen) if (n > 1) problems.push(`duplicate tool name "${name}" (${n}x)`)
  if (problems.length) {
    throw new Error(`MCP tool registry is invalid:\n  - ${problems.join('\n  - ')}`)
  }
}

export const TOOL_COUNT = ALL_TOOLS.length
export const WRITE_TOOLS = ALL_TOOLS.filter((t) => t.write).map((t) => t.name)
