// ============================================================
// POST /mcp — the Streamable-HTTP endpoint, mounted on the existing Fastify app
// so the connector lives at `<baseURL>/mcp` with no extra service to deploy.
//
// Traps this file exists to handle:
//   • Fastify owns the reply lifecycle; the SDK transport writes to the raw
//     socket. reply.hijack() hands it over — without it Fastify also tries to
//     respond and the client sees a truncated body.
//   • Fastify has already parsed the JSON body, so it MUST be passed to
//     handleRequest as parsedBody. Letting the transport re-read the stream
//     yields a -32700 Parse error on an already-consumed request.
//   • The transport requires an Accept header offering BOTH application/json
//     and text/event-stream. Claude and ChatGPT send both; curl, Inspector and
//     several SDKs do not, and the resulting 406 reads as "broken connector".
//     We normalise the header rather than making people debug it.
//   • GET in stateless mode would return 200 plus an SSE stream nothing ever
//     writes to, leaking a connection — it has to be 405.
// ============================================================
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpConfig } from './config.js'
import { makeContext } from './context.js'
import { errMessage, log } from './log.js'
import { authenticate } from './oauth/bearer.js'
import { registerOAuthRoutes } from './oauth/routes.js'
import { gc } from './oauth/store.js'
import { sweep } from './oauth/rateLimit.js'
import { buildServer } from './server.js'
import { TOOL_COUNT } from './registry.js'

const REQUIRED_ACCEPT = 'application/json, text/event-stream'

/**
 * Give the transport an Accept header it will accept.
 *
 * The SDK's Node adapter builds its Web Request through @hono/node-server, which
 * reads `incoming.rawHeaders` — NOT `req.headers`. Patching only the parsed map
 * therefore does nothing and the caller still gets an opaque 406, so both have
 * to be rewritten.
 */
function normaliseAccept(req: FastifyRequest): void {
  const raw = String(req.headers['accept'] || '')
  const hasJson = raw.includes('application/json') || raw.includes('*/*')
  const hasSse = raw.includes('text/event-stream')
  if (hasJson && hasSse) return

  req.raw.headers.accept = REQUIRED_ACCEPT
  const rebuilt: string[] = []
  const src = req.raw.rawHeaders || []
  for (let i = 0; i < src.length; i += 2) {
    if (src[i].toLowerCase() === 'accept') continue
    rebuilt.push(src[i], src[i + 1])
  }
  rebuilt.push('accept', REQUIRED_ACCEPT)
  req.raw.rawHeaders = rebuilt
}

/**
 * CORS for the hijacked path. reply.hijack() skips Fastify's onSend hooks, and
 * @fastify/cors adds its headers there — so on the success path the plugin never
 * runs and a browser client (claude.ai) would reject the response it just got.
 * Setting them on the raw socket before handing over is the fix; Node merges
 * setHeader values into the transport's later writeHead.
 */
function applyCorsToRaw(req: FastifyRequest, reply: FastifyReply): void {
  const origin = req.headers['origin']
  reply.raw.setHeader('Vary', 'Origin')
  if (typeof origin === 'string' && mcpConfig.browserOrigins.includes(origin)) {
    reply.raw.setHeader('Access-Control-Allow-Origin', origin)
    reply.raw.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version')
  }
}

/**
 * Origin check. A browser-based client (claude.ai, chatgpt.com) always sends
 * Origin; a server-side one sends none at all. Present-and-unknown => 403.
 * Absent => allow, because DNS rebinding needs a browser to rebind.
 */
function originAllowed(req: FastifyRequest): boolean {
  const origin = req.headers['origin']
  if (!origin || typeof origin !== 'string') return true
  return mcpConfig.browserOrigins.includes(origin)
}

const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
  reply.code(405).send({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed (stateless server; use POST).' },
    id: null,
  })

async function handleMcpPost(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!originAllowed(req)) {
    reply.code(403).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Origin not allowed.' }, id: null })
    return
  }

  const auth = await authenticate(req, reply)
  if (!auth) return // 401 already sent, with the WWW-Authenticate challenge

  normaliseAccept(req)

  const abort = new AbortController()
  req.raw.on('close', () => abort.abort())

  const ctx = makeContext(auth, abort.signal)
  const server = buildServer(ctx)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session to resume, nothing to leak
    enableJsonResponse: true,
  })

  applyCorsToRaw(req, reply)
  reply.hijack()
  reply.raw.on('close', () => {
    transport.close().catch(() => {})
    server.close().catch(() => {})
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  } catch (err) {
    log.error('mcp request failed', { error: errMessage(err) })
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'content-type': 'application/json' })
      reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }))
    } else {
      reply.raw.end()
    }
  }
}

/** Mount the connector: OAuth server, discovery, landing page and /mcp itself. */
export function registerMcp(app: FastifyInstance): void {
  // The OAuth token + authorize endpoints are posted as HTML forms; Fastify
  // parses JSON only, so teach it urlencoded here rather than pulling in a
  // plugin for two routes.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const out: Record<string, string> = {}
      for (const [k, v] of new URLSearchParams(body as string)) out[k] = v
      done(null, out)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  registerOAuthRoutes(app)

  app.post(mcpConfig.path, handleMcpPost)
  app.get(mcpConfig.path, methodNotAllowed)
  app.delete(mcpConfig.path, methodNotAllowed)

  // Expired codes/tokens and stale rate-limit state, every 15 minutes.
  const timer = setInterval(
    () => {
      sweep()
      gc().catch((e) => log.warn('oauth gc failed', { error: errMessage(e) }))
    },
    15 * 60 * 1000,
  )
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))

  log.info('mcp connector mounted', {
    endpoint: mcpConfig.resourceUrl,
    workspace: mcpConfig.workspaceKey,
    tools: TOOL_COUNT,
    writes: mcpConfig.allowWrites,
    static_token: mcpConfig.allowStaticToken,
  })
}

/** Paths the api's own API_TOKEN gate must NOT apply to — the MCP surface
 * authenticates with OAuth bearers instead. */
export function isMcpPath(url: string): boolean {
  const path = url.split('?')[0]
  return (
    path === mcpConfig.path ||
    path === '/mcp-info' ||
    path.startsWith('/mcp-oauth/') ||
    path.startsWith('/.well-known/')
  )
}
