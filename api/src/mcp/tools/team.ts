// The roster and what it costs. The plaintext portal password on a team member
// is NEVER returned by any tool here — safeMember() strips it on every path, and
// there is deliberately no tool to read or set it.
import { z } from 'zod'
import { monthOf, resolveMonths, round2, teamCost } from '../calc.js'
import { McpUserError, type ToolDef } from '../types.js'
import { findById, freshId, matches, num, paginate, requireDate, requireMonth, requireWrite, safeMember, tombstone } from '../util.js'

export const TOOLS: ToolDef[] = [
  {
    name: 'list_team',
    title: 'List team',
    description: 'The roster with pay type, monthly salary, commission and status. Portal passwords are never returned.',
    inputSchema: {
      active_only: z.boolean().optional().describe('Default true — pass false to include former members.'),
      q: z.string().optional().describe('Free text across name, role, email.'),
      include_bank: z.boolean().optional().describe('Include bank details (default false).'),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = (state.team || []).slice()
      if (args.active_only !== false) rows = rows.filter((m) => m.active)
      if (args.q) rows = rows.filter((m) => matches(args.q, m.name, m.role, m.email))
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      return {
        count: rows.length,
        cost: teamCost(state),
        members: rows.map((m) => {
          const safe: any = safeMember(m)
          if (!args.include_bank) delete safe.bank
          return safe
        }),
      }
    },
  },

  {
    name: 'get_team_member',
    title: 'Get team member',
    description: 'One member by id or exact name, with their payouts and submitted invoices summarised.',
    inputSchema: { id: z.string().optional(), name: z.string().optional().describe('Exact name, case-insensitive.') },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let member = args.id ? findById(state.team, String(args.id), 'team member') : undefined
      if (!member && args.name) {
        member = (state.team || []).find((m) => (m.name || '').toLowerCase() === String(args.name).toLowerCase())
      }
      if (!member) {
        throw new McpUserError('Pass an `id` or an exact `name`.', `Roster: ${(state.team || []).map((m) => m.name).join(', ')}`)
      }
      const payouts = (state.teamPayouts || []).filter((p) => p.memberId === member!.id)
      const invoices = (state.teamInvoices || []).filter((i) => i.memberId === member!.id)
      return {
        member: safeMember(member),
        payouts: { count: payouts.length, total: round2(payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0)), rows: payouts.slice(0, 50) },
        invoices: {
          count: invoices.length,
          total: round2(invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
          unpaid: invoices.filter((i) => i.status !== 'paid').length,
        },
      }
    },
  },

  {
    name: 'upsert_team_member',
    title: 'Create or update team member',
    description: 'Add someone to the roster or update them by id. Cannot set the portal password — do that in the dashboard.',
    write: true,
    inputSchema: {
      id: z.string().optional().describe('Omit to create.'),
      name: z.string().optional(),
      role: z.string().optional(),
      payType: z.enum(['salary', 'commission']).optional(),
      monthlySalary: z.number().optional(),
      commissionAmount: z.number().optional(),
      amount: z.number().optional().describe('Legacy single pay figure kept in sync with the SPA.'),
      active: z.boolean().optional(),
      isFounder: z.boolean().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      country: z.string().optional().describe('ISO-2, e.g. GB.'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const apply = (m: any) => {
          if (args.name !== undefined) m.name = String(args.name)
          if (args.role !== undefined) m.role = String(args.role)
          if (args.payType !== undefined) m.payType = args.payType
          if (args.monthlySalary !== undefined) m.monthlySalary = num(args.monthlySalary, 'monthlySalary')
          if (args.commissionAmount !== undefined) m.commissionAmount = num(args.commissionAmount, 'commissionAmount')
          if (args.amount !== undefined) m.amount = num(args.amount, 'amount')
          if (args.active !== undefined) m.active = Boolean(args.active)
          if (args.isFounder !== undefined) m.isFounder = Boolean(args.isFounder)
          if (args.email !== undefined) m.email = String(args.email)
          if (args.address !== undefined) m.address = String(args.address)
          if (args.country !== undefined) m.country = String(args.country)
        }
        if (args.id) {
          const m: any = findById(state.team, String(args.id), 'team member')
          apply(m)
          return { created: false, member: safeMember(m) }
        }
        if (!args.name) throw new McpUserError('`name` is required when creating a team member.')
        const m: any = {
          id: freshId((state.team || []).map((x) => x.id)),
          name: '',
          role: '',
          payType: 'salary',
          amount: 0,
          monthlySalary: 0,
          commissionAmount: 0,
          active: true,
          email: '',
          address: '',
          country: 'GB',
          bank: {},
          password: '',
        }
        apply(m)
        state.team = [...(state.team || []), m]
        return { created: true, member: safeMember(m) }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'set_team_member_active',
    title: 'Activate / deactivate member',
    description: 'Flip a member active or inactive — the reversible way to offboard, keeping their history intact.',
    write: true,
    inputSchema: { id: z.string(), active: z.boolean() },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const m: any = findById(state.team, String(args.id), 'team member')
        m.active = Boolean(args.active)
        return safeMember(m)
      })
      return { member: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_team_member',
    title: 'Delete team member',
    description: 'Permanently remove someone from the roster (payouts and invoices stay). Prefer set_team_member_active. Requires confirm:true.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string(), confirm: z.boolean().describe('Must be true.') },
    handler: async (args, ctx) => {
      requireWrite()
      if (args.confirm !== true) throw new McpUserError('Refusing to delete a team member without confirm:true.', 'set_team_member_active with active:false is the reversible option.')
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const m = findById(state.team, id, 'team member')
        state.team = (state.team || []).filter((x) => x.id !== id)
        tombstone(state, 'team', id)
        return safeMember(m)
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'get_team_cost',
    title: 'Payroll cost',
    description: 'Monthly payroll from the roster, per-member and in total, next to the salaries/commissions recorded on each month.',
    inputSchema: { from: z.string().optional(), to: z.string().optional(), last_n: z.number().int().positive().optional() },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const range = resolveMonths(state, args)
      const roster = (state.team || []).filter((m) => m.active)
      return {
        roster_cost: teamCost(state),
        per_member: roster.map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          payType: m.payType,
          monthlySalary: round2(Number(m.monthlySalary) || 0),
          commissionAmount: round2(Number(m.commissionAmount) || 0),
          monthly_total: round2((Number(m.monthlySalary) || 0) + (Number(m.commissionAmount) || 0)),
        })),
        recorded_by_month: range.months.map((mo) => ({
          month: mo,
          salariesTotal: round2(state.months[mo]?.salariesTotal || 0),
          commissionsTotal: round2(state.months[mo]?.commissionsTotal || 0),
          total: round2((state.months[mo]?.salariesTotal || 0) + (state.months[mo]?.commissionsTotal || 0)),
        })),
        note_on_difference:
          'Roster cost is what the current roster implies; recorded_by_month is what was actually entered for that month. They diverge after joiners/leavers or unrecorded months.',
      }
    },
  },

  {
    name: 'list_team_payouts',
    title: 'List payouts',
    description: 'Money actually paid to team members, filterable by member, month or type.',
    inputSchema: {
      member_id: z.string().optional(),
      month: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      const names = new Map((state.team || []).map((m) => [m.id, m.name]))
      let rows = (state.teamPayouts || []).slice()
      if (args.member_id) rows = rows.filter((p) => p.memberId === args.member_id)
      if (args.month) rows = rows.filter((p) => (p.month || monthOf(p.date)) === args.month)
      if (args.type) rows = rows.filter((p) => (p.type || '').toLowerCase() === String(args.type).toLowerCase())
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const page = paginate(rows, args.limit ?? 50, args.offset ?? 0)
      return {
        ...page,
        matched_total: round2(rows.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
        rows: page.rows.map((p) => ({ ...p, memberName: names.get(p.memberId) ?? null })),
      }
    },
  },

  {
    name: 'create_team_payout',
    title: 'Create payout',
    description: 'Record a payment to a team member.',
    write: true,
    inputSchema: {
      member_id: z.string(),
      date: z.string().describe('YYYY-MM-DD'),
      amount: z.number(),
      type: z.string().optional().describe('e.g. salary, commission, bonus.'),
      month: z.string().optional().describe('Defaults to the month of `date`.'),
      invoice_number: z.string().optional(),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const date = requireDate(args.date)
      const month = args.month ? requireMonth(args.month) : monthOf(date)
      const amount = num(args.amount, 'amount')
      const out = await ctx.mutate((state) => {
        const member = findById(state.team, String(args.member_id), 'team member')
        const row: any = {
          id: freshId((state.teamPayouts || []).map((p) => p.id)),
          memberId: member.id,
          month,
          date,
          amount,
          type: String(args.type || ''),
        }
        if (args.invoice_number) row.invoiceNumber = String(args.invoice_number)
        if (args.notes) row.notes = String(args.notes)
        state.teamPayouts = [...(state.teamPayouts || []), row]
        return { ...row, memberName: member.name }
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_team_payout',
    title: 'Delete payout',
    description: 'Remove a payout row and tombstone it.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const p = findById(state.teamPayouts, id, 'team payout')
        state.teamPayouts = (state.teamPayouts || []).filter((x) => x.id !== id)
        tombstone(state, 'teamPayouts', id)
        return p
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },
]
