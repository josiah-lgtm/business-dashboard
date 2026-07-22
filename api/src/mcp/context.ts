// Per-request tool context: the authenticated caller, the workspace it may
// touch, a memoized State read, and the locked write path.
import { publish } from '../events.js'
import { mutateState, readState } from '../store.js'
import type { State } from '../types.js'
import { mcpConfig } from './config.js'
import type { TokenIdentity } from './oauth/bearer.js'
import type { McpContext, StateView } from './types.js'

/** Device label written to `workspaces.updatedBy`, so an MCP edit is
 * distinguishable from a browser edit in the UI and in the audit log. */
export function writerLabel(auth: TokenIdentity): string {
  const who = auth.clientName || auth.clientId || 'client'
  return `mcp:${who}`.slice(0, 80)
}

export function makeContext(auth: TokenIdentity, signal: AbortSignal): McpContext {
  const key = mcpConfig.workspaceKey
  let cached: Promise<StateView> | null = null

  return {
    auth,
    workspaceKey: key,
    signal,
    state() {
      if (!cached) cached = readState(key)
      return cached
    },
    async mutate<T>(fn: (state: State) => T) {
      const out = await mutateState(key, writerLabel(auth), fn)
      // Invalidate the read cache: a second tool call in the same JSON-RPC
      // batch must not see the pre-write blob.
      cached = null
      // Same nudge a browser POST sends, so every open tab pulls immediately
      // instead of waiting out its 30s poll.
      if (out.changed) publish(key, { updated_at: out.updated_at, updated_by: writerLabel(auth) })
      return out
    },
  }
}
