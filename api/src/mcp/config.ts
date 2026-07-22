// ============================================================
// MCP connector configuration, resolved once from the environment at boot.
//
// ONE secret runs the whole thing: MCP_SECRET_KEY. It is the password on the
// OAuth login page (Claude / ChatGPT flow) and, when static tokens are left
// enabled, it also works as a plain `Authorization: Bearer <key>` for CLI
// clients that cannot do OAuth. Unset = the connector is not mounted at all.
// ============================================================

function optional(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() !== '' ? v.trim() : fallback
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(v.trim())
}

function int(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return fallback
  const n = Number.parseInt(v.trim(), 10)
  return Number.isFinite(n) ? n : fallback
}

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

/**
 * Public origin this connector is reachable at — the OAuth issuer AND the
 * RFC 8707 audience frozen into every token at mint time. It MUST be the origin
 * root with no path, because discovery documents live at `<publicUrl>/.well-known/…`
 * and the resource URL is `<publicUrl>/mcp`.
 *
 * Changing this host orphans every token already issued: they carry the old
 * audience and stop matching. Keep it byte-identical to the public hostname.
 */
const publicUrl = stripTrailingSlash(
  optional('MCP_PUBLIC_URL', 'https://businessdashboard.agencyadvanta.com'),
)

/** The one secret. Empty => MCP disabled (server.ts skips mounting the routes). */
const secretKey = optional('MCP_SECRET_KEY', '')

export const mcpConfig = {
  enabled: secretKey !== '' && bool('MCP_ENABLED', true),
  secretKey,
  publicUrl,

  /** Path the MCP endpoint is served at. `baseURL/mcp`. */
  path: '/mcp',
  /** Absolute resource URL = the audience recorded on every token. */
  resourceUrl: `${publicUrl}/mcp`,
  metadataPath: '/.well-known/oauth-protected-resource/mcp',
  metadataUrl: `${publicUrl}/.well-known/oauth-protected-resource/mcp`,

  /**
   * The workspace every tool reads and writes. The SPA pins all users to one
   * shared key (VITE_WORKSPACE_KEY), so the connector does the same rather than
   * taking a workspace argument on 60 tools — a per-call workspace parameter is
   * one typo away from writing an expense into a workspace nobody is looking at.
   * `list_workspaces` shows what else exists if this ever needs changing.
   */
  workspaceKey: optional('MCP_WORKSPACE_KEY', 'bd-agencyadvanta-shared'),

  /** Master switch for every mutating tool. Off = read-only connector. */
  allowWrites: bool('MCP_ALLOW_WRITES', true),
  /** Expose the read-only SQL tools (query_sql / describe_table / list_tables). */
  allowSql: bool('MCP_ALLOW_SQL', true),
  sqlMaxRows: int('MCP_SQL_MAX_ROWS', 500),
  sqlTimeoutMs: int('MCP_SQL_TIMEOUT_MS', 15_000),

  /**
   * Accept the raw secret as a bearer token (no OAuth dance). Convenient for
   * Claude Code / MCP Inspector / curl; turn off to force every client through
   * the authorization-code flow.
   */
  allowStaticToken: bool('MCP_ALLOW_STATIC_TOKEN', true),

  /** Token / code lifetimes (seconds). */
  accessTokenTtl: int('MCP_ACCESS_TOKEN_TTL', 3600),
  refreshTokenTtl: int('MCP_REFRESH_TOKEN_TTL', 60 * 60 * 24 * 30),
  authCodeTtl: int('MCP_AUTH_CODE_TTL', 600),

  /** Login brute-force lockout (per IP) on the authorize form. */
  loginMaxFailures: int('MCP_LOGIN_MAX_FAILURES', 8),
  loginWindowMs: int('MCP_LOGIN_WINDOW_MS', 10 * 60 * 1000),
  loginLockoutMs: int('MCP_LOGIN_LOCKOUT_MS', 15 * 60 * 1000),

  /** Per-connection tool-call ceiling (calls per rolling minute). */
  rateLimitPerMinute: int('MCP_RATE_LIMIT_PER_MINUTE', 120),

  /** Hard wall-clock budget for one tool call. */
  toolTimeoutMs: int('MCP_TOOL_TIMEOUT_MS', 45_000),

  scopesSupported: ['mcp'] as const,
  resourceName: optional('MCP_RESOURCE_NAME', 'Business Dashboard'),
  serverName: 'business-dashboard',
  serverVersion: '1.0.0',

  /**
   * Browser-origin allow-list for the MCP + OAuth routes. Claude and ChatGPT
   * call from these origins; a server-side client sends no Origin at all and is
   * always allowed (DNS rebinding needs a browser).
   */
  browserOrigins: optional(
    'MCP_BROWSER_ORIGINS',
    'https://claude.ai,https://claude.com,https://chatgpt.com,https://chat.openai.com,https://platform.openai.com',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const

export type McpConfig = typeof mcpConfig
