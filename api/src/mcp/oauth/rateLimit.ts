// In-memory brute-force lockout for the authorize form, and a rolling per-client
// tool-call limiter. In-process is the right scope here: the api runs as a
// single container (see DEPLOY.md); if it is ever scaled to replicas these move
// to Postgres alongside the token store.
import { mcpConfig } from '../config.js'

interface Entry {
  failures: number
  first: number
  lockedUntil: number
}

const attempts = new Map<string, Entry>()

export function isLockedOut(key: string): boolean {
  const e = attempts.get(key)
  if (!e) return false
  if (e.lockedUntil > Date.now()) return true
  if (e.lockedUntil && e.lockedUntil <= Date.now()) attempts.delete(key)
  return false
}

export function recordFailure(key: string): void {
  const now = Date.now()
  const e = attempts.get(key)
  if (!e || now - e.first > mcpConfig.loginWindowMs) {
    attempts.set(key, { failures: 1, first: now, lockedUntil: 0 })
    return
  }
  e.failures += 1
  if (e.failures >= mcpConfig.loginMaxFailures) e.lockedUntil = now + mcpConfig.loginLockoutMs
}

export function clearFailures(key: string): void {
  attempts.delete(key)
}

// ---- tool-call rate limit ----------------------------------------------------

const calls = new Map<string, number[]>()

/** True when the caller may proceed. Counts calls in a rolling 60s window. */
export function allowToolCall(clientKey: string): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const cutoff = now - 60_000
  const hits = (calls.get(clientKey) || []).filter((t) => t > cutoff)
  if (hits.length >= mcpConfig.rateLimitPerMinute) {
    calls.set(clientKey, hits)
    const oldest = hits[0]
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)) }
  }
  hits.push(now)
  calls.set(clientKey, hits)
  return { ok: true, retryAfterSeconds: 0 }
}

/** Drop tracking state that can no longer matter (called from the GC timer). */
export function sweep(): void {
  const now = Date.now()
  for (const [k, e] of attempts) {
    if (e.lockedUntil < now && now - e.first > mcpConfig.loginWindowMs) attempts.delete(k)
  }
  const cutoff = now - 60_000
  for (const [k, hits] of calls) {
    const live = hits.filter((t) => t > cutoff)
    if (live.length) calls.set(k, live)
    else calls.delete(k)
  }
}
