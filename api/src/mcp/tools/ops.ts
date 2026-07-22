// Recovery + observability: the post-merge snapshots the api takes on every
// write, and this connector's own audit trail.
import { z } from 'zod'
import { prisma } from '../../db.js'
import { ID_COLLECTIONS } from '../../serialize.js'
import { McpUserError, type ToolDef } from '../types.js'
import { requireWrite } from '../util.js'

function countsOf(value: any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of ID_COLLECTIONS) out[c] = Array.isArray(value?.[c]) ? value[c].length : 0
  out.months = value?.months ? Object.keys(value.months).length : 0
  out.budgets = value?.budgets ? Object.keys(value.budgets).length : 0
  out.deletions = value?.deletions ? Object.keys(value.deletions).length : 0
  return out
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_snapshots',
    title: 'List snapshots',
    description:
      'Recovery points. The api snapshots the whole workspace after every change that alters data (the last 100 are kept).',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      reason: z.string().optional().describe('Filter: post (a normal write), fx (rate refresh), mcp (a write from here).'),
    },
    handler: async (args, ctx) => {
      const rows = await prisma.snapshot.findMany({
        where: { workspaceId: ctx.workspaceKey, ...(args.reason ? { reason: String(args.reason) } : {}) },
        orderBy: { takenAt: 'desc' },
        take: args.limit ?? 25,
        select: { id: true, takenAt: true, reason: true, updatedBy: true },
      })
      return {
        count: rows.length,
        snapshots: rows.map((r) => ({ id: r.id, taken_at: r.takenAt.toISOString(), reason: r.reason, by: r.updatedBy })),
        note: 'Snapshots have portal passwords stripped. Use get_snapshot to inspect one and restore_snapshot to bring rows back.',
      }
    },
  },

  {
    name: 'get_snapshot',
    title: 'Inspect a snapshot',
    description: 'Row counts inside one snapshot, and (with `collection`) the rows themselves. Compares against the live workspace.',
    inputSchema: {
      id: z.string(),
      collection: z.string().optional().describe('e.g. expenses — return this collection\'s rows.'),
      limit: z.number().int().min(1).max(200).optional(),
    },
    handler: async (args, ctx) => {
      const snap = await prisma.snapshot.findUnique({ where: { id: String(args.id) } })
      if (!snap || snap.workspaceId !== ctx.workspaceKey) throw new McpUserError(`No snapshot "${args.id}" in this workspace.`)
      const value: any = snap.value
      const { state } = await ctx.state()
      const snapCounts = countsOf(value)
      const liveCounts = countsOf(state)
      const base = {
        id: snap.id,
        taken_at: snap.takenAt.toISOString(),
        reason: snap.reason,
        by: snap.updatedBy,
        counts: snapCounts,
        live_counts: liveCounts,
        delta_vs_live: Object.fromEntries(Object.keys(snapCounts).map((k) => [k, snapCounts[k] - (liveCounts[k] ?? 0)])),
      }
      if (!args.collection) return base
      const rows = value?.[String(args.collection)]
      if (rows === undefined) throw new McpUserError(`Snapshot has no collection "${args.collection}".`)
      const list = Array.isArray(rows) ? rows : Object.entries(rows).map(([k, v]) => ({ key: k, value: v }))
      return { ...base, collection: args.collection, rows: list.slice(0, args.limit ?? 50), collection_total: list.length }
    },
  },

  {
    name: 'restore_snapshot',
    title: 'Restore rows from a snapshot',
    description:
      'Bring back rows that exist in a snapshot but not in the live workspace (and clear their tombstones). ADDITIVE by default: nothing currently present is deleted, and existing rows are left alone unless overwrite:true. Previews unless apply:true.',
    write: true,
    destructive: true,
    inputSchema: {
      id: z.string().describe('Snapshot id from list_snapshots.'),
      collections: z.array(z.string()).optional().describe('Limit to these collections; omit for all.'),
      overwrite: z.boolean().optional().describe('Also replace rows that still exist with the snapshot version.'),
      apply: z.boolean().optional().describe('false/omitted = preview only.'),
    },
    handler: async (args, ctx) => {
      const snap = await prisma.snapshot.findUnique({ where: { id: String(args.id) } })
      if (!snap || snap.workspaceId !== ctx.workspaceKey) throw new McpUserError(`No snapshot "${args.id}" in this workspace.`)
      const value: any = snap.value
      const wanted = new Set(
        (args.collections as string[] | undefined) ?? [...ID_COLLECTIONS, 'months'],
      )
      const { state } = await ctx.state()

      const plan: Record<string, { restore: number; overwrite: number; untomb: number }> = {}
      for (const coll of ID_COLLECTIONS) {
        if (!wanted.has(coll)) continue
        const snapRows: any[] = Array.isArray(value?.[coll]) ? value[coll] : []
        const live = new Map(((state as any)[coll] || []).map((r: any) => [r.id, r]))
        let restore = 0
        let over = 0
        let untomb = 0
        for (const r of snapRows) {
          if (!r?.id) continue
          if (!live.has(r.id)) restore++
          else if (args.overwrite) over++
          if (state.deletions?.[`${coll}:${r.id}`]) untomb++
        }
        if (restore || over || untomb) plan[coll] = { restore, overwrite: over, untomb }
      }
      if (wanted.has('months')) {
        const snapMonths = Object.keys(value?.months || {})
        const missing = snapMonths.filter((m) => !state.months?.[m])
        if (missing.length) plan.months = { restore: missing.length, overwrite: 0, untomb: missing.filter((m) => state.deletions?.[`months:${m}`]).length }
      }

      const totals = Object.values(plan).reduce(
        (a, p) => ({ restore: a.restore + p.restore, overwrite: a.overwrite + p.overwrite, untomb: a.untomb + p.untomb }),
        { restore: 0, overwrite: 0, untomb: 0 },
      )

      if (args.apply !== true) {
        return {
          applied: false,
          snapshot: { id: snap.id, taken_at: snap.takenAt.toISOString(), reason: snap.reason },
          plan,
          totals,
          next_step: 'Re-run with apply:true to write. Nothing currently in the workspace is deleted either way.',
        }
      }
      requireWrite()
      const out = await ctx.mutate((s: any) => {
        let restored = 0
        let overwritten = 0
        let untombed = 0
        for (const coll of ID_COLLECTIONS) {
          if (!wanted.has(coll)) continue
          const snapRows: any[] = Array.isArray(value?.[coll]) ? value[coll] : []
          const arr: any[] = Array.isArray(s[coll]) ? s[coll] : []
          const byId = new Map(arr.map((r: any) => [r.id, r]))
          for (const r of snapRows) {
            if (!r?.id) continue
            const key = `${coll}:${r.id}`
            if (s.deletions?.[key]) {
              delete s.deletions[key]
              untombed++
            }
            const existing = byId.get(r.id)
            if (!existing) {
              arr.push(r)
              restored++
            } else if (args.overwrite) {
              Object.assign(existing, r)
              overwritten++
            }
          }
          s[coll] = arr
        }
        if (wanted.has('months')) {
          for (const [m, fig] of Object.entries(value?.months || {})) {
            if (s.deletions?.[`months:${m}`]) {
              delete s.deletions[`months:${m}`]
              untombed++
            }
            if (!s.months[m]) {
              s.months[m] = fig
              restored++
            } else if (args.overwrite) {
              s.months[m] = fig
              overwritten++
            }
          }
        }
        return { restored, overwritten, untombed }
      })
      return { applied: true, snapshot_id: snap.id, ...out.result, changed: out.changed, updated_at: out.updated_at }
    },
  },

  {
    name: 'list_mcp_activity',
    title: 'MCP activity log',
    description: 'Recent tool calls made through this connector — what ran, from which client, and whether it wrote.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      writes_only: z.boolean().optional(),
      tool: z.string().optional(),
      since: z.string().optional().describe('ISO timestamp.'),
    },
    handler: async (args, ctx) => {
      const rows = await prisma.mcpAuditLog.findMany({
        where: {
          workspaceId: ctx.workspaceKey,
          ...(args.writes_only ? { write: true } : {}),
          ...(args.tool ? { tool: String(args.tool) } : {}),
          ...(args.since ? { at: { gte: new Date(String(args.since)) } } : {}),
        },
        orderBy: { at: 'desc' },
        take: args.limit ?? 50,
      })
      return {
        count: rows.length,
        entries: rows.map((r) => ({
          at: r.at.toISOString(),
          tool: r.tool,
          client: r.clientName || r.clientId,
          write: r.write,
          ok: r.ok,
          duration_ms: r.durationMs,
          args: r.args,
          error: r.error,
        })),
      }
    },
  },
]
