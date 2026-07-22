// Persistence for OAuth clients, authorization codes and tokens (Prisma →
// the same Postgres the dashboard already runs on). Codes and tokens are stored
// as sha-256 hashes only.
import { prisma } from '../../db.js'
import { mcpConfig } from '../config.js'
import { newUuid, randomToken, sha256 } from '../crypto.js'

export interface OAuthClient {
  clientId: string
  clientSecretHash: string | null
  clientName: string | null
  redirectUris: string[]
  grantTypes: string[]
  responseTypes: string[]
  tokenEndpointAuthMethod: string
  scope: string | null
}

export interface RegisterClientInput extends OAuthClient {
  metadata: unknown
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const row = await prisma.mcpOAuthClient.findUnique({ where: { clientId } })
  if (!row) return null
  return {
    clientId: row.clientId,
    clientSecretHash: row.clientSecretHash,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes,
    responseTypes: row.responseTypes,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    scope: row.scope,
  }
}

export async function insertClient(c: RegisterClientInput): Promise<void> {
  await prisma.mcpOAuthClient.create({
    data: {
      clientId: c.clientId,
      clientSecretHash: c.clientSecretHash,
      clientName: c.clientName,
      redirectUris: c.redirectUris,
      grantTypes: c.grantTypes,
      responseTypes: c.responseTypes,
      tokenEndpointAuthMethod: c.tokenEndpointAuthMethod,
      scope: c.scope,
      metadata: (c.metadata ?? {}) as any,
    },
  })
}

export interface AuthCodeInput {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scope: string | null
  resource: string | null
}

export interface ConsumedCode {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scope: string | null
  resource: string | null
}

/** Mint + persist an authorization code; returns the plaintext code. */
export async function createAuthCode(input: AuthCodeInput): Promise<string> {
  const code = randomToken(32)
  await prisma.mcpAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scope: input.scope,
      resource: input.resource,
      expiresAt: new Date(Date.now() + mcpConfig.authCodeTtl * 1000),
    },
  })
  return code
}

/**
 * Atomically fetch + consume a code (single use). Null if missing, expired or
 * already used. updateMany + a `consumed: false` predicate is the atomic part:
 * two concurrent redemptions cannot both see count > 0.
 */
export async function consumeAuthCode(code: string): Promise<ConsumedCode | null> {
  const codeHash = sha256(code)
  const claimed = await prisma.mcpAuthCode.updateMany({
    where: { codeHash, consumed: false, expiresAt: { gt: new Date() } },
    data: { consumed: true },
  })
  if (claimed.count === 0) return null
  const row = await prisma.mcpAuthCode.findUnique({ where: { codeHash } })
  if (!row) return null
  return {
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: row.codeChallengeMethod,
    scope: row.scope,
    resource: row.resource,
  }
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface IssueTokenParams {
  clientId: string
  scope: string | null
  resource: string | null
  /** Carry an existing rotation family (rotation); omit to start a new one. */
  familyId?: string | null
}

export async function issueTokens(params: IssueTokenParams): Promise<IssuedTokens> {
  const accessToken = randomToken(32)
  const refreshToken = randomToken(32)
  const now = Date.now()
  await prisma.mcpToken.create({
    data: {
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      clientId: params.clientId,
      scope: params.scope,
      resource: params.resource,
      familyId: params.familyId || newUuid(),
      accessExpiresAt: new Date(now + mcpConfig.accessTokenTtl * 1000),
      refreshExpiresAt: new Date(now + mcpConfig.refreshTokenTtl * 1000),
    },
  })
  return { accessToken, refreshToken, expiresIn: mcpConfig.accessTokenTtl }
}

export interface RefreshRow {
  id: string
  scope: string | null
  resource: string | null
  familyId: string
  revoked: boolean
  expired: boolean
}

/** Look up a presented refresh token WITHOUT filtering on revoked/expiry, so
 * the caller can tell "active" from "already rotated" (reuse) and "expired". */
export async function findRefreshToken(refreshToken: string, clientId: string): Promise<RefreshRow | null> {
  const row = await prisma.mcpToken.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } })
  if (!row || row.clientId !== clientId) return null
  return {
    id: row.id,
    scope: row.scope,
    resource: row.resource,
    familyId: row.familyId,
    revoked: row.revoked,
    expired: row.refreshExpiresAt.getTime() <= Date.now(),
  }
}

/** Reuse detected → cut the whole rotation chain. */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.mcpToken.updateMany({ where: { familyId, revoked: false }, data: { revoked: true } })
}

/** Atomically consume (revoke) one active row. False if lost to a concurrent rotation. */
export async function consumeRefreshRow(id: string): Promise<boolean> {
  const res = await prisma.mcpToken.updateMany({ where: { id, revoked: false }, data: { revoked: true } })
  return res.count > 0
}

export interface TokenIdentity {
  clientId: string
  clientName: string | null
  scope: string | null
  /** RFC 8707 audience frozen in at mint time — a claim to be CHECKED, never a
   * selector for what the caller may do. */
  resource: string | null
  authMethod: 'oauth' | 'static'
}

/** Verify a bearer access token and return the caller identity, or null. */
export async function verifyAccessToken(token: string): Promise<TokenIdentity | null> {
  const row = await prisma.mcpToken.findUnique({
    where: { accessTokenHash: sha256(token) },
    include: { client: { select: { clientName: true } } },
  })
  if (!row || row.revoked || row.accessExpiresAt.getTime() <= Date.now()) return null
  // Best-effort last-used stamp; never fail the request over it.
  prisma.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return {
    clientId: row.clientId,
    clientName: row.client?.clientName ?? null,
    scope: row.scope,
    resource: row.resource,
    authMethod: 'oauth',
  }
}

/** RFC 7009 — revoke by either access or refresh token. */
export async function revokeToken(token: string): Promise<void> {
  const h = sha256(token)
  await prisma.mcpToken.updateMany({
    where: { OR: [{ accessTokenHash: h }, { refreshTokenHash: h }], revoked: false },
    data: { revoked: true },
  })
}

/** Opportunistic GC of expired codes and long-dead tokens. */
export async function gc(): Promise<{ codes: number; tokens: number }> {
  const now = new Date()
  const codes = await prisma.mcpAuthCode.deleteMany({ where: { expiresAt: { lt: now } } })
  const tokens = await prisma.mcpToken.deleteMany({ where: { refreshExpiresAt: { lt: now } } })
  return { codes: codes.count, tokens: tokens.count }
}
