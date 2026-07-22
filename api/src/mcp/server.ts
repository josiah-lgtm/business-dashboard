// Builds a fresh McpServer for one authenticated caller.
//
// A NEW server (and a NEW transport) is constructed per request: the stateless
// Streamable-HTTP transport cannot be reused, and every tool closes over the
// caller's context anyway, so there is nothing worth caching.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { prisma } from '../db.js'
import { mcpConfig } from './config.js'
import { errorResult, wrapResult } from './envelope.js'
import { errMessage, log } from './log.js'
import { allowToolCall } from './oauth/rateLimit.js'
import { MCP_PROMPTS } from './prompts.js'
import { ALL_TOOLS } from './registry.js'
import { MCP_RESOURCES } from './resources.js'
import { McpUserError, type McpContext, type ToolDef } from './types.js'

/** The first ~512 characters have to stand alone: ChatGPT and several CLI
 * surfaces truncate server instructions there. */
export const SERVER_INSTRUCTIONS = [
  `${mcpConfig.resourceName} is the finance and operations dashboard for Agency Advanta: monthly P&L, the expense ledger, revenue, refunds, the team roster and payouts, outbound client invoices, inbound team invoices, budgets and tasks — one shared workspace that two people edit in the browser at the same time.`,
  '',
  'Start with `whoami`, then `get_overview`. `get_data_dictionary` has every field and formula; read it before quoting a metric you have not seen defined.',
  '',
  'Six facts that decide whether an answer is right:',
  '• GBP is the canonical currency. Foreign expenses are stored as entered and converted on read at meta.fxRates ("1 GBP = X foreign").',
  '• `invoices` are OUTBOUND (billed to clients). `teamInvoices` are INBOUND (team members billing you). They are different collections with different statuses — never mix them.',
  '• months[].revenue is the reported revenue. `revenueEntries` are supporting cash-in lines and do NOT roll up into it automatically.',
  '• merchantFees, referralPayoutsTotal and founderComp prefer the summed expense category and fall back to the month figure only when that sum is zero. refundsTotal prefers the refunds ledger the same way.',
  '• Percentages are out of 100. Rates with a zero denominator are null, never 0.',
  '• Deletes are tombstones ("collection:id" → ISO). That is why a delete sticks across devices, and why `undelete` and `restore_snapshot` exist.',
  '',
  `Writes go through the same locked union-merge a browser save does and push a live update to every open tab, so treat them as immediately visible to the humans using the app. Destructive tools need confirm:true; bulk tools preview unless apply:true.${mcpConfig.allowWrites ? '' : ' This connection is currently READ-ONLY.'}`,
].join('\n')

function annotationsFor(tool: ToolDef) {
  return (
    tool.annotations ?? {
      readOnlyHint: !tool.write,
      destructiveHint: Boolean(tool.destructive),
      idempotentHint: !tool.write,
      openWorldHint: false,
    }
  )
}

/** Fire-and-forget audit row. Never allowed to fail a tool call. */
function audit(ctx: McpContext, tool: ToolDef, args: unknown, ok: boolean, ms: number, error: string | null): void {
  prisma.mcpAuditLog
    .create({
      data: {
        clientId: ctx.auth.clientId,
        clientName: ctx.auth.clientName,
        tool: tool.name,
        workspaceId: ctx.workspaceKey,
        write: Boolean(tool.write),
        ok,
        durationMs: ms,
        // Arguments are small and non-secret by construction (no tool takes a
        // credential), and they are what makes the log answer "who changed that".
        args: (args ?? {}) as any,
        error,
      },
    })
    .catch((e) => log.warn('audit write failed', { error: errMessage(e), tool: tool.name }))
}

export function buildServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    {
      name: mcpConfig.serverName,
      title: mcpConfig.resourceName,
      version: mcpConfig.serverVersion,
      websiteUrl: mcpConfig.publicUrl,
    } as any,
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  for (const tool of ALL_TOOLS) {
    // A write tool on a read-only connector is hidden from tools/list entirely,
    // so the model never proposes something it will only be refused for.
    if (tool.write && !mcpConfig.allowWrites) continue
    if (!mcpConfig.allowSql && (tool.name === 'query_sql' || tool.name === 'list_tables' || tool.name === 'describe_table')) continue

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema as any } : {}),
        annotations: annotationsFor(tool),
      } as any,
      (async (args: any) => {
        const started = Date.now()
        try {
          const limit = allowToolCall(ctx.auth.clientId)
          if (!limit.ok) {
            audit(ctx, tool, args, false, Date.now() - started, 'rate_limited')
            return errorResult(
              `Rate limit reached for this connection. Wait ${limit.retryAfterSeconds}s and retry.`,
              'Prefer one aggregate tool call over many small ones.',
            )
          }

          // Per-tool deadline. Without it a pathological query would hold the
          // HTTP request open until the client gives up with no explanation.
          const timeout = AbortSignal.timeout(mcpConfig.toolTimeoutMs)
          const payload = await Promise.race([
            tool.handler(args ?? {}, { ...ctx, signal: timeout }),
            new Promise((_, reject) => {
              timeout.addEventListener('abort', () =>
                reject(new McpUserError(`${tool.name} exceeded its ${mcpConfig.toolTimeoutMs / 1000}s budget.`, 'Narrow the range or add a filter.')),
              )
            }),
          ])

          audit(ctx, tool, args, true, Date.now() - started, null)
          return wrapResult(payload, { bare: tool.bareResult })
        } catch (err) {
          const ms = Date.now() - started
          if (err instanceof McpUserError) {
            audit(ctx, tool, args, false, ms, err.message)
            return errorResult(err.message, err.hint)
          }
          const message = errMessage(err)
          log.error('tool failed', { tool: tool.name, error: message })
          audit(ctx, tool, args, false, ms, message)
          // Don't leak stack traces or SQL internals to the model; say what it
          // can do about it instead.
          return errorResult(
            `${tool.name} failed: ${message}`,
            'If this persists, check the api logs — the workspace itself is unchanged (writes are transactional).',
          )
        }
      }) as any,
    )
  }

  for (const res of MCP_RESOURCES) {
    server.registerResource(
      res.name,
      res.uri,
      { title: res.title, description: res.description, mimeType: res.mimeType },
      async (uri: URL) => {
        const body = await res.read(ctx)
        return { contents: [{ uri: uri.href, mimeType: res.mimeType, text: JSON.stringify(body, null, 2) }] }
      },
    )
  }

  for (const prompt of MCP_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        ...(prompt.argsSchema ? { argsSchema: prompt.argsSchema } : {}),
      } as any,
      ((args: Record<string, unknown>) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.build(args ?? {}) } }],
      })) as any,
    )
  }

  // The SDK stamps `listChanged: true` onto tools/resources/prompts inside
  // register*(), and registerCapabilities() only MERGES, so it cannot be undone
  // through the public API. This server is stateless with GET 405'd: there is no
  // stream to deliver notifications/*/list_changed on, and advertising a
  // capability we cannot service is a spec violation. Strip the flags in place,
  // before connect(), after every registration.
  const caps = (server.server as any)._capabilities as Record<string, { listChanged?: boolean } | undefined> | undefined
  if (caps) {
    for (const key of ['tools', 'resources', 'prompts']) {
      const c = caps[key]
      if (c && typeof c === 'object') delete c.listChanged
    }
  }

  return server
}
