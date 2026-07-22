// Read-only SQL over the relational projection of the workspace.
//
// The api's database user owns the schema, so "read-only" has to be enforced
// here rather than by grants: one statement, SELECT/WITH only, no write verb, a
// server-imposed LIMIT and a statement_timeout. Results are additionally walked
// for password-ish keys, because `team_members.raw` carries the portal password
// that no MCP path is allowed to return.
import { z } from 'zod'
import { prisma } from '../../db.js'
import { mcpConfig } from '../config.js'
import { McpUserError, type ToolDef } from '../types.js'

const READ_START = /^\s*(select|with)\b/i
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|analyze|reindex|cluster|call|do|listen|notify|lock|comment|security\s+label|refresh\s+materialized|set\s+role|reset\s+role|begin|commit|rollback|savepoint|prepare|execute|deallocate)\b/i

function assertReadOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (!trimmed) throw new McpUserError('`sql` is empty.')
  if (trimmed.includes(';')) {
    throw new McpUserError('Only ONE statement per call.', 'Split it into separate query_sql calls.')
  }
  if (!READ_START.test(trimmed)) {
    throw new McpUserError('Only SELECT (or WITH … SELECT) queries are allowed.', 'Use the curated write tools to change data.')
  }
  const m = FORBIDDEN.exec(trimmed)
  if (m) {
    throw new McpUserError(`This connector refuses SQL containing "${m[0]}".`, 'query_sql is read-only by design.')
  }
  return trimmed
}

const SECRET_KEY = /(password|secret|token|api[_-]?key)/i

/** Walk a result value and redact secret-ish keys wherever they appear —
 * including inside the `raw` jsonb column, which is how a portal password would
 * otherwise escape. Also stringifies BigInt, which JSON.stringify cannot. */
function sanitize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitize(v)
    }
    return out
  }
  return value
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_tables',
    title: 'List tables',
    description: 'Tables in the dashboard database with row counts. Every business table is scoped by a workspaceId column.',
    inputSchema: {},
    handler: async (_args, ctx) => {
      const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
      )
      const counts = await Promise.all(
        rows.map(async (r) => {
          const c = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint as n from "${r.table_name}"`)
          return { table: r.table_name, rows: Number(c[0]?.n ?? 0) }
        }),
      )
      return {
        workspace_column: 'workspaceId',
        served_workspace: ctx.workspaceKey,
        reminder: `Almost every query should include: where "workspaceId" = '${ctx.workspaceKey}' and "deletedAt" is null`,
        tables: counts,
      }
    },
  },

  {
    name: 'describe_table',
    title: 'Describe table',
    description: 'Columns, types, nullability and indexes for one table.',
    inputSchema: { table: z.string() },
    handler: async (args) => {
      const table = String(args.table)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new McpUserError('Invalid table name.')
      const columns = await prisma.$queryRawUnsafe<any[]>(
        `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = $1
          order by ordinal_position`,
        table,
      )
      if (!columns.length) throw new McpUserError(`No table "${table}".`, 'Call list_tables first.')
      const indexes = await prisma.$queryRawUnsafe<any[]>(
        `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1`,
        table,
      )
      return {
        table,
        columns: sanitize(columns),
        indexes: sanitize(indexes),
        note:
          table === 'team_members'
            ? 'The portal password lives only inside the `raw` jsonb and is redacted from every MCP result.'
            : undefined,
      }
    },
  },

  {
    name: 'query_sql',
    title: 'Run a read-only query',
    description:
      'One SELECT/WITH statement against the dashboard database. Row-capped and time-limited; write verbs are refused and password fields are redacted.',
    inputSchema: {
      sql: z.string().describe('A single SELECT (or WITH … SELECT) statement. No semicolons, no write verbs.'),
      limit: z.number().int().min(1).max(500).optional().describe(`Row cap (default ${mcpConfig.sqlMaxRows}).`),
    },
    handler: async (args, ctx) => {
      if (!mcpConfig.allowSql) throw new McpUserError('SQL tools are disabled on this connector (MCP_ALLOW_SQL=0).')
      const sql = assertReadOnly(String(args.sql))
      const limit = Math.min(Number(args.limit) || mcpConfig.sqlMaxRows, mcpConfig.sqlMaxRows)
      const started = Date.now()
      const rows = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, mcpConfig.sqlTimeoutMs)}`)
          // Wrapping (rather than appending LIMIT) means the cap holds even for a
          // query that already has its own LIMIT or a trailing ORDER BY.
          return tx.$queryRawUnsafe<any[]>(`select * from (${sql}) as _mcp_q limit ${limit + 1}`)
        },
        { timeout: Math.max(5000, mcpConfig.sqlTimeoutMs + 5000) },
      )
      const capped = rows.length > limit
      const out = sanitize(rows.slice(0, limit)) as any[]
      return {
        row_count: out.length,
        truncated: capped,
        limit,
        duration_ms: Date.now() - started,
        served_workspace: ctx.workspaceKey,
        rows: out,
        ...(capped ? { hint: 'More rows matched than the cap — narrow the query or raise `limit`.' } : {}),
      }
    },
  },
]
