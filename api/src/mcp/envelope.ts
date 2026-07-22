// Result envelope: the standing money note every payload carries, and the
// dual-encoded MCP result with a hard size ceiling.
//
// Every result ships the SAME JSON twice — once as `structuredContent`, once as
// `content[0].text`. ChatGPT will not read structuredContent alone and several
// Claude surfaces prefer the text channel, so both are mandatory and they must
// agree, including on every truncation path.

/** Boilerplate on every payload. Repetitive on purpose: it is the cheapest
 * thing that stops a model inventing its own currency or margin definition. */
export const MONEY_NOTE =
  'All amounts are GBP unless a `currency` field says otherwise — GBP is the canonical storage currency and ' +
  'foreign-currency expenses are converted at meta.fxRates ("1 GBP = X foreign"). Months are `YYYY-MM`, dates `YYYY-MM-DD`. ' +
  'adjRev = revenue - refunds - merchantFees; grossProfit = adjRev - Base Software; ' +
  'netProfit = adjRev - (marketing + delivery + overhead); marketing = LinkedIn + Email + SMS + One off + commissions; ' +
  'overhead = salaries + referral payouts. Line-item totals win over the legacy month fields whenever they are non-zero. ' +
  'Percentages are numbers out of 100, not fractions. Call get_data_dictionary for the full field list.'

/** Every rate ships as a triple: models reason far better about 12/48 than 0.25. */
export function rate(numerator: number, denominator: number): {
  value: number | null
  numerator: number
  denominator: number
} {
  const n = Number.isFinite(numerator) ? numerator : 0
  const d = Number.isFinite(denominator) ? denominator : 0
  return { value: d > 0 ? n / d : null, numerator: n, denominator: d }
}

/**
 * PER-CHANNEL ceiling. The wire payload is 2x this plus the JSON-RPC frame;
 * Claude's per-result cap is ~150k characters, hence 65k here. Raising this
 * above ~72k silently reintroduces oversized results.
 */
export const MAX_RESULT_CHARS = 65_000

const FIRST_STRING_CLIP = 20_000

export interface McpResult {
  structuredContent: Record<string, unknown>
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Shrink ROW-LEVEL ARRAYS only, largest first, until the serialised form fits.
 * Aggregates (numbers, objects, rate triples) are never touched: a truncated
 * aggregate is a wrong answer, a truncated row list is a smaller answer.
 */
function truncateArrays(
  payload: Record<string, unknown>,
  budget: number = MAX_RESULT_CHARS,
): { payload: Record<string, unknown>; omitted: number } {
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(payload))

  interface Site {
    parent: any
    key: string
  }
  const sites: Site[] = []
  const visit = (node: any) => {
    if (Array.isArray(node) || !isPlainObject(node)) return
    for (const [k, v] of Object.entries(node)) {
      if (Array.isArray(v)) {
        // Only arrays of objects are "rows". Arrays of scalars are usually
        // aggregate series (labels, monthly values) and must survive intact.
        if (v.some((x) => isPlainObject(x))) sites.push({ parent: node, key: k })
        for (const item of v) visit(item)
      } else {
        visit(v)
      }
    }
  }
  visit(clone)

  let omitted = 0
  for (let guard = 0; guard < 200; guard++) {
    if (JSON.stringify(clone).length <= budget) break
    sites.sort((a, b) => (b.parent[b.key] as unknown[]).length - (a.parent[a.key] as unknown[]).length)
    const biggest = sites[0]
    if (!biggest) break
    const cur = biggest.parent[biggest.key] as unknown[]
    if (cur.length <= 1) {
      if (cur.length === 1) {
        omitted += 1
        biggest.parent[biggest.key] = []
        continue
      }
      sites.shift()
      continue
    }
    const keep = Math.floor(cur.length / 2)
    omitted += cur.length - keep
    biggest.parent[biggest.key] = cur.slice(0, keep)
  }
  return { payload: clone, omitted }
}

/** Clip long strings IN THE OBJECT (never in the serialised text — a mid-string
 * slice of JSON is unparseable and would desync the two channels). */
function clipStrings(node: unknown, maxLen: number): unknown {
  if (typeof node === 'string') {
    return node.length > maxLen
      ? `${node.slice(0, maxLen)}\n\n…[clipped: ${node.length - maxLen} more characters]`
      : node
  }
  if (Array.isArray(node)) return node.map((v) => clipStrings(v, maxLen))
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = clipStrings(v, maxLen)
    return out
  }
  return node
}

export function wrapResult(payload: unknown, opts: { bare?: boolean } = {}): McpResult {
  let obj: Record<string, unknown> = isPlainObject(payload) ? { ...payload } : { data: payload }
  const bare = opts.bare === true
  if (!bare && !('note' in obj)) obj.note = MONEY_NOTE

  let text = JSON.stringify(obj)
  if (text.length > MAX_RESULT_CHARS) {
    // Attach the truncation metadata BEFORE shrinking so it counts against the
    // same budget; adding it afterwards pushes a just-trimmed payload back over.
    if (!bare) {
      obj.truncated = true
      obj.rows_omitted = 0
      obj.suggestion =
        'Result exceeded the size ceiling; row-level arrays were shortened while every aggregate was preserved. ' +
        'Narrow the month range, add a filter, or lower `limit` to see the omitted rows.'
    }
    const { payload: shrunk, omitted } = truncateArrays(obj, MAX_RESULT_CHARS - 64)
    obj = shrunk
    if (!bare) obj.rows_omitted = omitted
    text = JSON.stringify(obj)

    if (text.length > MAX_RESULT_CHARS) {
      // Pathological: the bulk is one enormous scalar (a logo data URI, a note).
      const floor = bare ? 100 : 400
      for (let cap = FIRST_STRING_CLIP; cap >= floor; cap = Math.floor(cap / 2)) {
        const clipped = clipStrings(obj, cap) as Record<string, unknown>
        const t = JSON.stringify(clipped)
        if (t.length <= MAX_RESULT_CHARS) {
          obj = clipped
          text = t
          break
        }
        text = t
      }
      if (text.length > MAX_RESULT_CHARS) {
        obj = {
          error: 'result_too_large',
          message:
            'The result could not be reduced below the size ceiling without corrupting it, so it was dropped. ' +
            'Re-run with a narrower range, a filter, or a lower `limit`.',
        }
        text = JSON.stringify(obj)
      }
    }
  }
  return { structuredContent: obj, content: [{ type: 'text', text }] }
}

export function errorResult(message: string, hint?: string): McpResult {
  const text = hint ? `${message}\n\nHint: ${hint}` : message
  return { structuredContent: { error: message, ...(hint ? { hint } : {}) }, content: [{ type: 'text', text }], isError: true }
}
