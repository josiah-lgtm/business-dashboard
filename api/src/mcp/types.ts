// Shared contract every tool-group module compiles against. Deliberately
// dependency-light (zod + the State types) so importing it from a tool file
// never drags the transport or the OAuth layer into scope.
import type { z } from 'zod'
import type { State } from '../types.js'
import type { TokenIdentity } from './oauth/bearer.js'

export interface StateView {
  state: State
  /** False when the workspace has never been written (fresh database). */
  exists: boolean
  updated_at: string | null
  updated_by: string | null
}

export interface McpContext {
  auth: TokenIdentity
  /** The single workspace this connector serves (mcpConfig.workspaceKey). */
  workspaceKey: string
  /** Current workspace State, read once per request and cached. */
  state(): Promise<StateView>
  /**
   * Mutate the workspace under the per-workspace advisory lock, exactly the way
   * a browser POST does: same merge machinery, same snapshot, same SSE nudge to
   * every open tab. Throw inside `fn` to abort with nothing written.
   */
  mutate<T>(fn: (state: State) => T): Promise<{ result: T; changed: boolean; updated_at: string }>
  signal: AbortSignal
}

/**
 * Thrown by a handler to produce isError:true with a model-readable message
 * instead of a 500. Use it for bad ids, unparseable months, refused writes —
 * anything the model could fix by calling again differently.
 */
export class McpUserError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message)
    this.name = 'McpUserError'
  }
}

export interface ToolDef {
  name: string
  title: string
  /** Keep terse: tools/list is re-sent to the model every single turn. */
  description: string
  /** True for anything that changes stored data — gated by MCP_ALLOW_WRITES,
   * flagged in the audit log, and annotated readOnlyHint:false. */
  write?: boolean
  /** Deletes / bulk overwrites. Sets destructiveHint so clients can confirm. */
  destructive?: boolean
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  /** RAW SHAPE (a plain object of zod types), never z.object(...). */
  inputSchema: z.ZodRawShape
  outputSchema?: z.ZodRawShape
  /** Ship the handler payload verbatim — no notes, no truncation metadata.
   * Only for `search`/`fetch`, whose shape is fixed by the OpenAI contract. */
  bareResult?: boolean
  handler: (args: any, ctx: McpContext) => Promise<unknown>
}
