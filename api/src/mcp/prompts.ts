// Prompts — one-click starting points a client can offer the user. Each expands
// to a short instruction naming the tools to use, which keeps a fresh session
// from guessing its way around the catalog.
import { z } from 'zod'

export interface PromptDef {
  name: string
  title: string
  description: string
  argsSchema?: z.ZodRawShape
  build: (args: Record<string, unknown>) => string
}

export const MCP_PROMPTS: PromptDef[] = [
  {
    name: 'monthly_review',
    title: 'Monthly review',
    description: 'Full review of one month: P&L, targets, channels and what to do next.',
    argsSchema: { month: z.string().describe('YYYY-MM').optional() },
    build: (a) => {
      const m = a.month ? `for ${a.month}` : 'for the most recent month on file'
      return [
        `Review the business ${m}.`,
        '',
        'Do this in order:',
        '1. `get_month` for the full P&L, then `compare_months` against the previous month.',
        '2. `get_budget_health` to score it against the targets.',
        '3. `get_category_breakdown` and `get_channel_decisions` for where the money went and what the trend says.',
        '4. `get_client_economics` for CAC and gross profit per client.',
        '',
        'Then write: what changed, what is off target and by how much, the two or three things worth acting on, and what you would need to know to be sure. Quote the actual numbers and name the month.',
      ].join('\n')
    },
  },
  {
    name: 'cost_audit',
    title: 'Cost audit',
    description: 'Hunt for waste: vendor spend, recurring costs and category drift.',
    argsSchema: { last_n: z.string().describe('How many trailing months to audit (default 6)').optional() },
    build: (a) => {
      const n = a.last_n || '6'
      return [
        `Audit spending over the last ${n} months.`,
        '',
        `Use \`get_vendor_spend\` (last_n: ${n}) for the biggest vendors, \`get_category_breakdown\` (last_n: ${n}, include_other: true) for drift between categories, and \`list_vendors\` (recurring_only: true) for the standing commitments.`,
        'Flag: vendors whose spend grew fastest, anything recurring that has not been used recently, categories rising faster than revenue, and duplicate-looking vendors.',
        'Give a ranked list of candidate cuts with the monthly saving next to each. Do not change any data — this is a read-only audit.',
      ].join('\n')
    },
  },
  {
    name: 'cash_position',
    title: 'Cash position',
    description: 'What is owed to us, what we owe, and what to set aside for tax.',
    build: () =>
      [
        'Work out the current cash position.',
        '',
        'Use `get_receivables` for outbound invoices outstanding and their ageing, `get_team_invoice_summary` (unpaid_only: true) for what the team is owed, and `get_budget_health` for the tax and founder-tax reserves.',
        'Report: money in (by ageing bucket), money out, the net, and the set-aside. Call out anything over 60 days.',
      ].join('\n'),
  },
  {
    name: 'close_the_month',
    title: 'Close the month',
    description: 'Checklist pass over a month before it is called final.',
    argsSchema: { month: z.string().describe('YYYY-MM').optional() },
    build: (a) => {
      const m = a.month ? a.month : 'the most recent month'
      return [
        `Check whether ${m} is ready to close.`,
        '',
        `Verify with tools: month figures exist and look complete (\`get_month\`), expenses are categorised (\`list_expenses\` for that month, look for blank or odd categories), refunds are logged (\`list_refunds\`), team invoices for the period are recorded and their statuses are current (\`list_team_invoices\`), and revenue entries roughly reconcile to the month figure (\`get_revenue_summary\`).`,
        'List anything missing or suspicious as a checklist with the tool call that would fix each item. Ask before writing anything.',
      ].join('\n')
    },
  },
]
