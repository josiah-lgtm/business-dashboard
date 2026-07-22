// ============================================================
// OAuth 2.1 authorization server for the MCP connector, as Fastify routes.
//
// Everything lives at the origin root because MCP clients bootstrap the entire
// flow from the connector URL alone:
//
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 — "who authorizes me"
//   GET  /.well-known/oauth-authorization-server[/mcp] RFC 8414 — endpoint map
//   POST /mcp-oauth/register                           RFC 7591 — dynamic client registration
//   GET  /mcp-oauth/authorize                          login form (the one secret)
//   POST /mcp-oauth/authorize                          verify secret -> redirect with code
//   POST /mcp-oauth/token                              code (PKCE) + refresh grants
//   POST /mcp-oauth/revoke                             RFC 7009
//   GET  /mcp-info                                     human landing page
//
// The user-facing credential is a SINGLE shared secret (MCP_SECRET_KEY), so
// there is no user database, no per-user scope, and no offboarding story beyond
// rotating that key — which is exactly what was asked for. PKCE S256 is still
// mandatory, codes are single-use, refresh tokens rotate with family revocation
// on reuse, and every stored credential is a hash.
// ============================================================
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { mcpConfig } from '../config.js'
import { log } from '../log.js'
import { pkceS256, randomId, randomToken, safeEqual, sha256 } from '../crypto.js'
import { loginPage, errorPage, landingPage, type LoginParams } from './pages.js'
import { allowToolCall, clearFailures, isLockedOut, recordFailure } from './rateLimit.js'
import {
  consumeAuthCode,
  consumeRefreshRow,
  createAuthCode,
  findRefreshToken,
  getClient,
  insertClient,
  issueTokens,
  revokeFamily,
  revokeToken,
  type OAuthClient,
} from './store.js'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const SCOPE = mcpConfig.scopesSupported.join(' ')

// ---- discovery ---------------------------------------------------------------

function protectedResourceMetadata() {
  return {
    resource: mcpConfig.resourceUrl,
    authorization_servers: [mcpConfig.publicUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: mcpConfig.scopesSupported,
    resource_name: `${mcpConfig.resourceName} MCP`,
    resource_documentation: `${mcpConfig.publicUrl}/mcp-info`,
  }
}

function authorizationServerMetadata() {
  return {
    issuer: mcpConfig.publicUrl,
    authorization_endpoint: `${mcpConfig.publicUrl}/mcp-oauth/authorize`,
    token_endpoint: `${mcpConfig.publicUrl}/mcp-oauth/token`,
    registration_endpoint: `${mcpConfig.publicUrl}/mcp-oauth/register`,
    revocation_endpoint: `${mcpConfig.publicUrl}/mcp-oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: mcpConfig.scopesSupported,
    service_documentation: `${mcpConfig.publicUrl}/mcp-info`,
  }
}

// ---- dynamic client registration (RFC 7591) ----------------------------------

function isValidRedirect(u: unknown): u is string {
  if (typeof u !== 'string') return false
  try {
    const url = new URL(u)
    if (url.protocol === 'https:') return true
    // http only for loopback (local dev / MCP Inspector).
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

async function registerClient(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const redirectUris = body.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(isValidRedirect)) {
    return reply.code(400).send({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must be a non-empty array of absolute https (or loopback http) URIs.',
    })
  }
  const tokenAuth = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none'
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(tokenAuth)) {
    return reply.code(400).send({
      error: 'invalid_client_metadata',
      error_description: `Unsupported token_endpoint_auth_method: ${tokenAuth}`,
    })
  }

  const grantTypes =
    Array.isArray(body.grant_types) && body.grant_types.length
      ? (body.grant_types as string[])
      : ['authorization_code', 'refresh_token']
  const responseTypes =
    Array.isArray(body.response_types) && body.response_types.length ? (body.response_types as string[]) : ['code']
  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null
  const scope = typeof body.scope === 'string' ? body.scope : SCOPE

  const clientId = randomId('bdmcp_', 16)
  let clientSecret: string | undefined
  let clientSecretHash: string | null = null
  if (tokenAuth !== 'none') {
    clientSecret = randomToken(32)
    clientSecretHash = sha256(clientSecret)
  }

  await insertClient({
    clientId,
    clientSecretHash,
    clientName,
    redirectUris: redirectUris as string[],
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod: tokenAuth,
    scope,
    metadata: body,
  })
  log.info('registered oauth client', { clientId, clientName, tokenAuth })

  return reply.code(201).send({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenAuth,
    client_name: clientName,
    scope,
  })
}

// ---- authorize ---------------------------------------------------------------

function redirectError(reply: FastifyReply, redirectUri: string, state: string, error: string, description: string) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (description) url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  return reply.redirect(url.toString(), 302)
}

/** The RFC 8707 audience the client asked for. Absent => our one resource.
 * Present but naming something else => invalid_target rather than a token that
 * would be rejected later by the audience check (a 401 loop is far harder to
 * diagnose than a refusal here). */
function resourceOk(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === '') return true
  if (typeof raw !== 'string') return false
  return raw.trim().replace(/\/+$/, '') === mcpConfig.resourceUrl
}

async function authorizeGet(req: FastifyRequest, reply: FastifyReply) {
  const q = (req.query ?? {}) as Record<string, unknown>
  const clientId = str(q.client_id)
  const redirectUri = str(q.redirect_uri)
  const responseType = str(q.response_type)
  const codeChallenge = str(q.code_challenge)
  const codeChallengeMethod = str(q.code_challenge_method) || 'S256'
  const state = str(q.state)
  const scope = str(q.scope) || SCOPE

  const client = clientId ? await getClient(clientId) : null
  if (!client) {
    return reply.code(400).type('text/html').send(errorPage('Unknown client', 'This client_id is not registered.'))
  }
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return reply
      .code(400)
      .type('text/html')
      .send(errorPage('Invalid redirect', 'The redirect_uri does not match a registered value for this client.'))
  }
  // Past this point errors are safe to bounce back to the client.
  if (responseType !== 'code') {
    return redirectError(reply, redirectUri, state, 'unsupported_response_type', 'Only response_type=code is supported.')
  }
  if (!codeChallenge) {
    return redirectError(reply, redirectUri, state, 'invalid_request', 'PKCE code_challenge is required.')
  }
  if (codeChallengeMethod !== 'S256') {
    return redirectError(reply, redirectUri, state, 'invalid_request', 'Only code_challenge_method=S256 is supported.')
  }
  if (!resourceOk(q.resource)) {
    return redirectError(
      reply,
      redirectUri,
      state,
      'invalid_target',
      `Unknown resource. This connector serves ${mcpConfig.resourceUrl}.`,
    )
  }

  const params: LoginParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: mcpConfig.resourceUrl,
  }
  return reply
    .code(200)
    .type('text/html')
    .send(loginPage(params, { clientName: client.clientName ?? undefined }))
}

async function authorizePost(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as Record<string, unknown>
  const clientId = str(b.client_id)
  const redirectUri = str(b.redirect_uri)
  const state = str(b.state)
  const scope = str(b.scope) || SCOPE
  const codeChallenge = str(b.code_challenge)
  const codeChallengeMethod = str(b.code_challenge_method) || 'S256'
  const secret = str(b.secret)

  const client = clientId ? await getClient(clientId) : null
  // The hidden fields round-trip through the browser, so re-validate every one
  // of them here; a tampered form must not be able to widen anything.
  if (
    !client ||
    !redirectUri ||
    !client.redirectUris.includes(redirectUri) ||
    !codeChallenge ||
    codeChallengeMethod !== 'S256'
  ) {
    return reply
      .code(400)
      .type('text/html')
      .send(
        errorPage(
          'Invalid request',
          'Client, redirect or PKCE challenge is invalid. Restart the connection from your MCP client.',
        ),
      )
  }

  const params: LoginParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: mcpConfig.resourceUrl,
  }
  const renderLogin = (error: string) =>
    reply
      .code(200)
      .type('text/html')
      .send(loginPage(params, { clientName: client.clientName ?? undefined, error }))

  const ipKey = `ip:${req.ip || 'unknown'}`
  if (isLockedOut(ipKey)) {
    return renderLogin('Too many attempts. Wait a few minutes and try again.')
  }
  if (!secret) return renderLogin('Enter the access key.')
  if (!safeEqual(sha256(secret), sha256(mcpConfig.secretKey))) {
    recordFailure(ipKey)
    log.warn('mcp authorize denied', { clientId, ip: req.ip })
    return renderLogin('That access key is not correct.')
  }
  clearFailures(ipKey)

  const code = await createAuthCode({
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: 'S256',
    scope,
    resource: mcpConfig.resourceUrl,
  })
  log.info('mcp authorization granted', { clientId, clientName: client.clientName })

  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return reply.redirect(url.toString(), 302)
}

// ---- token -------------------------------------------------------------------

function extractClientCreds(
  req: FastifyRequest,
  b: Record<string, unknown>,
): { clientId: string; clientSecret: string | undefined } {
  let clientId = str(b.client_id)
  let clientSecret: string | undefined = str(b.client_secret) || undefined
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && /^Basic\s/i.test(auth)) {
    const decoded = Buffer.from(auth.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx >= 0) {
      const id = decodeURIComponent(decoded.slice(0, idx))
      const sec = decodeURIComponent(decoded.slice(idx + 1))
      clientId = clientId || id
      if (!clientSecret) clientSecret = sec
    }
  }
  return { clientId, clientSecret }
}

function clientAuthFails(client: OAuthClient, clientSecret: string | undefined): boolean {
  if (client.tokenEndpointAuthMethod === 'none') return false
  return !clientSecret || !client.clientSecretHash || !safeEqual(sha256(clientSecret), client.clientSecretHash)
}

async function tokenEndpoint(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as Record<string, unknown>
  const grantType = str(b.grant_type)
  const { clientId, clientSecret } = extractClientCreds(req, b)

  if (!clientId) {
    return reply.code(400).send({ error: 'invalid_request', error_description: 'client_id is required.' })
  }
  const client = await getClient(clientId)
  if (!client) return reply.code(401).send({ error: 'invalid_client', error_description: 'Unknown client.' })
  if (clientAuthFails(client, clientSecret)) {
    return reply.code(401).send({ error: 'invalid_client', error_description: 'Client authentication failed.' })
  }

  if (grantType === 'authorization_code') {
    const code = str(b.code)
    const redirectUri = str(b.redirect_uri)
    const codeVerifier = str(b.code_verifier)
    if (!code) return reply.code(400).send({ error: 'invalid_request', error_description: 'code is required.' })

    // Atomic single-use consume; anything wrong after this burns the code.
    const consumed = await consumeAuthCode(code)
    if (!consumed) {
      return reply
        .code(400)
        .send({ error: 'invalid_grant', error_description: 'Code is invalid, expired or already used.' })
    }
    if (consumed.clientId !== clientId) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Code was issued to a different client.' })
    }
    if (consumed.redirectUri !== redirectUri) {
      return reply
        .code(400)
        .send({ error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request.' })
    }
    if (!codeVerifier || !safeEqual(pkceS256(codeVerifier), consumed.codeChallenge)) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'PKCE verification failed.' })
    }

    const tokens = await issueTokens({ clientId, scope: consumed.scope, resource: consumed.resource })
    return reply.send({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: consumed.scope ?? SCOPE,
    })
  }

  if (grantType === 'refresh_token') {
    const refreshToken = str(b.refresh_token)
    if (!refreshToken) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'refresh_token is required.' })
    }
    const row = await findRefreshToken(refreshToken, clientId)
    if (!row) return reply.code(400).send({ error: 'invalid_grant', error_description: 'Refresh token is invalid.' })
    if (row.revoked || row.expired) {
      // Presenting an already-rotated token is the signature of a stolen one;
      // cut the whole family rather than just refusing this request.
      if (row.revoked) await revokeFamily(row.familyId)
      return reply
        .code(400)
        .send({ error: 'invalid_grant', error_description: 'Refresh token is expired or has been superseded.' })
    }
    if (!(await consumeRefreshRow(row.id))) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Refresh token already used.' })
    }
    const tokens = await issueTokens({
      clientId,
      scope: row.scope,
      resource: row.resource,
      familyId: row.familyId,
    })
    return reply.send({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: row.scope ?? SCOPE,
    })
  }

  return reply
    .code(400)
    .send({ error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` })
}

// ---- mount -------------------------------------------------------------------

export function registerOAuthRoutes(app: FastifyInstance): void {
  const prm = async (_req: FastifyRequest, reply: FastifyReply) => reply.send(protectedResourceMetadata())
  app.get('/.well-known/oauth-protected-resource', prm)
  app.get('/.well-known/oauth-protected-resource/mcp', prm)

  const asm = async (_req: FastifyRequest, reply: FastifyReply) => reply.send(authorizationServerMetadata())
  app.get('/.well-known/oauth-authorization-server', asm)
  app.get('/.well-known/oauth-authorization-server/mcp', asm)
  // Some clients probe the OpenID discovery path before the OAuth one.
  app.get('/.well-known/openid-configuration', asm)

  app.post('/mcp-oauth/register', registerClient)
  app.get('/mcp-oauth/authorize', authorizeGet)
  app.post('/mcp-oauth/authorize', authorizePost)
  app.post('/mcp-oauth/token', tokenEndpoint)
  app.post('/mcp-oauth/revoke', async (req, reply) => {
    // RFC 7009: always answer 200, whatever the token turns out to be.
    const token = str(((req.body ?? {}) as Record<string, unknown>).token)
    if (token) await revokeToken(token)
    return reply.send({})
  })

  app.get('/mcp-info', async (_req, reply) => reply.type('text/html').send(landingPage()))
}

export { allowToolCall }
