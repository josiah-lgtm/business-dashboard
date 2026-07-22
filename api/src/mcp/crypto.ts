// Token/secret generation + hashing for the MCP OAuth layer. Every bearer-like
// credential is persisted as a sha-256 hash only, so a database leak never
// yields a live token.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

/** URL-safe high-entropy opaque token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Prefixed identifier, e.g. bdmcp_ab12… for client ids. */
export function randomId(prefix: string, bytes = 16): string {
  return `${prefix}${randomBytes(bytes).toString('hex')}`
}

export function newUuid(): string {
  return randomUUID()
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** base64url(sha256(verifier)) — PKCE S256 challenge derivation (RFC 7636). */
export function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** Constant-time string compare. Length mismatch short-circuits (lengths are
 * not secret here — both sides are fixed-width hashes or an operator secret). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
