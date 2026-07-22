// The kanban board.
import { z } from 'zod'
import { McpUserError, type ToolDef } from '../types.js'
import { findById, freshId, matches, nowIso, paginate, requireWrite, tombstone } from '../util.js'

const STATUSES = ['todo', 'in-progress', 'done', 'cancelled'] as const

export const TOOLS: ToolDef[] = [
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'The task board, filterable by status or free text, with per-status counts.',
    inputSchema: {
      status: z.enum(STATUSES).optional(),
      open_only: z.boolean().optional().describe('todo + in-progress only.'),
      q: z.string().optional().describe('Free text across title, action and notes.'),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async (args, ctx) => {
      const { state } = await ctx.state()
      let rows = (state.tasks || []).slice()
      const counts: Record<string, number> = { todo: 0, 'in-progress': 0, done: 0, cancelled: 0 }
      for (const t of rows) counts[t.status] = (counts[t.status] || 0) + 1
      if (args.status) rows = rows.filter((t) => t.status === args.status)
      if (args.open_only) rows = rows.filter((t) => t.status === 'todo' || t.status === 'in-progress')
      if (args.q) rows = rows.filter((t) => matches(args.q, t.title, t.action, t.notes))
      rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      const vendors = new Map((state.vendors || []).map((v) => [v.id, v.name]))
      const page = paginate(rows, args.limit ?? 100, args.offset ?? 0)
      return {
        counts,
        ...page,
        rows: page.rows.map((t) => ({ ...t, linkedVendorName: t.linkedVendorId ? (vendors.get(t.linkedVendorId) ?? null) : null })),
      }
    },
  },

  {
    name: 'create_task',
    title: 'Create task',
    description: 'Add a task to the board.',
    write: true,
    inputSchema: {
      title: z.string(),
      status: z.enum(STATUSES).optional().describe('Default todo.'),
      action: z.string().optional().describe('The next concrete step.'),
      notes: z.string().optional(),
      linked_vendor_id: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWrite()
      if (!String(args.title || '').trim()) throw new McpUserError('`title` is required.')
      const out = await ctx.mutate((state) => {
        if (args.linked_vendor_id) findById(state.vendors, String(args.linked_vendor_id), 'vendor')
        const row = {
          id: freshId((state.tasks || []).map((t) => t.id)),
          title: String(args.title).trim(),
          status: (args.status || 'todo') as (typeof STATUSES)[number],
          linkedVendorId: args.linked_vendor_id ? String(args.linked_vendor_id) : null,
          action: String(args.action || ''),
          notes: String(args.notes || ''),
          createdAt: nowIso(),
        }
        state.tasks = [...(state.tasks || []), row]
        return row
      })
      return { created: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'update_task',
    title: 'Update task',
    description: 'Change a task — most often its status. Only the fields you pass change.',
    write: true,
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      action: z.string().optional(),
      notes: z.string().optional(),
      linked_vendor_id: z.string().nullable().optional().describe('null clears the link.'),
    },
    handler: async (args, ctx) => {
      requireWrite()
      const out = await ctx.mutate((state) => {
        const t: any = findById(state.tasks, String(args.id), 'task')
        const before = { ...t }
        if (args.title !== undefined) t.title = String(args.title)
        if (args.status !== undefined) t.status = args.status
        if (args.action !== undefined) t.action = String(args.action)
        if (args.notes !== undefined) t.notes = String(args.notes)
        if (args.linked_vendor_id !== undefined) {
          if (args.linked_vendor_id === null) t.linkedVendorId = null
          else {
            findById(state.vendors, String(args.linked_vendor_id), 'vendor')
            t.linkedVendorId = String(args.linked_vendor_id)
          }
        }
        return { before, after: { ...t } }
      })
      return { ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'delete_task',
    title: 'Delete task',
    description: 'Remove a task and tombstone it. Setting status to cancelled is the reversible alternative.',
    write: true,
    destructive: true,
    inputSchema: { id: z.string() },
    handler: async (args, ctx) => {
      requireWrite()
      const id = String(args.id)
      const out = await ctx.mutate((state) => {
        const t = findById(state.tasks, id, 'task')
        state.tasks = (state.tasks || []).filter((x) => x.id !== id)
        tombstone(state, 'tasks', id)
        return t
      })
      return { deleted: out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },
]
