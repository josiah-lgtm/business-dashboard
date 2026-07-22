// Bearer gate for the MCP endpoint. On failure it emits the WWW-Authenticate
// challenge carrying `resource_metadata`, which is what tells an MCP client
// where to begin the OAuth flow (RFC 9728 §5.1 + the MCP auth spec) instead of
// simply reporting a dead connector.
import type { FastifyReply, FastifyRequest } from 'fastify'
import { mcpConfig } from '../config.js'
import { safeEqual, sha256 } from '../crypto.js'
import { log } from '../log.js'
import { verifyAccessToken, type TokenIdentity } from './store.js'

function challenge(error?: string, description?: string): string {
  return error
    ? `Bearer error="${error}", error_description="${description}", resource_metadata="${mcpConfig.metadataUrl}"`
    : `Bearer resource_metadata="${mcpConfig.metadataUrl}"`
}

/** Audience check (RFC 8707). A token minted before the connector recorded an
 * audience (null) is grandfathered; anything naming a different resource is
 * refused, because a token must not be replayable against another endpoint. */
function audienceOk(tokenResource: string | null): boolean {
  if (!tokenResource || tokenResource.trim() === '') return true
  return tokenResource.trim().replace(/\/+$/, '') === mcpConfig.resourceUrl
}

/**
 * Authenticate an MCP request. Returns the identity, or null after having
 * already sent the 401 (callers must stop).
 *
 * Two accepted credentials, both derived from the ONE secret in .env:
 *   • an OAuth access token minted through the authorization-code flow, and
 *   • the raw MCP_SECRET_KEY as a static bearer, for clients that cannot do
 *     OAuth (Claude Code, MCP Inspector, curl). MCP_ALLOW_STATIC_TOKEN=0 turns
 *     that off and forces everyone through the flow.
 */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<TokenIdentity | null> {
  const header = (req.headers['authorization'] as string | undefined) ?? ''
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim()
  if (!token) {
    reply
      .code(401)
      .header('WWW-Authenticate', challenge())
      .send({ error: 'invalid_token', error_description: 'Missing bearer token.' })
    return null
  }

  if (mcpConfig.allowStaticToken && safeEqual(sha256(token), sha256(mcpConfig.secretKey))) {
    return {
      clientId: 'static',
      clientName: 'static key',
      scope: mcpConfig.scopesSupported.join(' '),
      resource: mcpConfig.resourceUrl,
      authMethod: 'static',
    }
  }

  const identity = await verifyAccessToken(token)
  if (!identity) {
    reply
      .code(401)
      .header('WWW-Authenticate', challenge('invalid_token', 'The access token is invalid or expired'))
      .send({ error: 'invalid_token', error_description: 'Invalid or expired access token.' })
    return null
  }
  if (!audienceOk(identity.resource)) {
    log.warn('mcp audience mismatch', { clientId: identity.clientId, tokenResource: identity.resource })
    reply
      .code(401)
      .header('WWW-Authenticate', challenge('invalid_token', 'The access token was not issued for this resource'))
      .send({
        error: 'invalid_token',
        error_description: `This token was issued for a different resource. Re-authorize against ${mcpConfig.resourceUrl}.`,
      })
    return null
  }
  return identity
}

export type { TokenIdentity }
