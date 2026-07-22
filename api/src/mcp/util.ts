// Helpers shared by every tool module: id minting, validation, paging, and the
// small guards that keep a write honest.
import { randomBytes } from 'node:crypto'
import { mcpConfig } from './config.js'
import { McpUserError } from './types.js'
import type { State } from '../types.js'

/** 8-char base36, the same SHAPE the SPA's uid() produces, but from a CSPRNG so
 * two concurrent MCP writes can't collide on a 2^26 birthday. */
export function uid(): string {
  return randomBytes(8).toString('hex').slice(0, 8)
}

/** A uid guaranteed not to collide with an existing id in `taken`. */
export function freshId(taken: Iterable<string>): string {
  const seen = new Set(taken)
  for (let i = 0; i < 50; i++) {
    const id = uid()
    if (!seen.has(id)) return id
  }
  return `${uid()}${uid()}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Today as YYYY-MM-DD in UTC (the api container runs UTC; the SPA writes local
 * dates, and for a UK-based business the two only differ around midnight). */
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function todayMonth(): string {
  return todayDate().slice(0, 7)
}

export function requireWrite(): void {
  if (!mcpConfig.allowWrites) {
    throw new McpUserError(
      'This connector is running read-only (MCP_ALLOW_WRITES=0), so no data can be changed.',
      'Ask whoever runs the server to enable writes, or use the dashboard UI for this edit.',
    )
  }
}

export function requireMonth(v: unknown, field = 'month'): string {
  if (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v
  throw new McpUserError(`\`${field}\` must be a month in YYYY-MM form (got ${JSON.stringify(v)}).`)
}

export function requireDate(v: unknown, field = 'date'): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  throw new McpUserError(`\`${field}\` must be a date in YYYY-MM-DD form (got ${JSON.stringify(v)}).`)
}

export function optionalDate(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  return requireDate(v, field)
}

export function num(v: unknown, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new McpUserError(`\`${field}\` must be a number (got ${JSON.stringify(v)}).`)
  return n
}

export const CURRENCIES = ['GBP', 'USD', 'EUR'] as const

/** Case-insensitive "does this row match the free-text query" test. */
export function matches(q: string | undefined, ...fields: unknown[]): boolean {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(needle))
}

export interface Page<T> {
  rows: T[]
  returned: number
  total: number
  offset: number
  has_more: boolean
}

export function paginate<T>(rows: T[], limit = 50, offset = 0): Page<T> {
  const start = Math.max(0, Math.floor(offset) || 0)
  const size = Math.max(1, Math.min(500, Math.floor(limit) || 50))
  const slice = rows.slice(start, start + size)
  return {
    rows: slice,
    returned: slice.length,
    total: rows.length,
    offset: start,
    has_more: start + slice.length < rows.length,
  }
}

/**
 * Find one entity by id in a State collection, or throw a message the model can
 * act on. The "did you mean" list is what stops a model retrying the same wrong
 * id three times.
 */
export function findById<T extends { id: string }>(rows: T[] | undefined, id: string, what: string): T {
  const hit = (rows || []).find((r) => r && r.id === id)
  if (hit) return hit
  const sample = (rows || []).slice(0, 5).map((r) => r.id)
  throw new McpUserError(
    `No ${what} with id "${id}".`,
    sample.length ? `Ids in this workspace look like: ${sample.join(', ')}. List them first.` : `There are no ${what} rows yet.`,
  )
}

/**
 * Record a deletion the way the SPA does: drop the row AND write the tombstone
 * that makes the delete win the merge on every other device. Removing the row
 * without the tombstone would let the next browser push resurrect it.
 */
export function tombstone(state: State, collection: string, id: string): void {
  state.deletions = state.deletions || {}
  state.deletions[`${collection}:${id}`] = nowIso()
}

/** Strip the plaintext portal password from a team member before it leaves the
 * server. It is never returned by any tool, on any path. */
export function safeMember<T extends Record<string, any>>(m: T): Omit<T, 'password'> & { hasPassword: boolean } {
  const { password, ...rest } = m
  return { ...(rest as Omit<T, 'password'>), hasPassword: Boolean(password) }
}

/** Business record minus the base64 logo, which is ~40 KB of noise to a model. */
export function safeBusiness(b: any): any {
  if (!b || typeof b !== 'object') return b
  const { logoDataUrl, ...rest } = b
  return { ...rest, hasLogo: Boolean(logoDataUrl) }
}
