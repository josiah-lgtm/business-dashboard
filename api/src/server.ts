// ============================================================
// Fastify backend for business-dashboard.
//
// Sync (drop-in replacement for the old team-tracker KV contract):
//   GET  /external/kv/:key  -> { value, updated_at, updated_by }
//   POST /external/kv/:key  body { value, updated_by? } -> { ok, updated_at }
// In production the `web` nginx container reverse-proxies /api/* here and injects
// the Authorization header, so the browser calls same-origin /api/external/kv
// (no CORS) and the token never ships in the bundle. CORS below only matters for
// the direct/dev path (Vite on :5173 hitting the api directly).
//
// Reporting (the payoff of the relational schema): read-only, key-scoped,
// password never selected.
// ============================================================
import { timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { prisma } from './db.js'
import { handleGet, handlePost } from './store.js'
import { publish, subscribe } from './events.js'
import type { State } from './types.js'

const PORT = Number(process.env.PORT) || 3000
const API_TOKEN = process.env.API_TOKEN || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const MAX_VALUE_BYTES = 1_000_000
const KEY_RE = /^[A-Za-z0-9._:-]{4,80}$/

const app = Fastify({
  // Generous limit: the value blob (<=1MB) plus the JSON envelope.
  bodyLimit: 2_000_000,
  logger: { level: process.env.LOG_LEVEL || 'info' },
  // Don't auto-log request URLs — they contain the secret workspace key.
  disableRequestLogging: true,
})

await app.register(cors, {
  origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
})

// ---- auth (bearer); nginx injects it in prod, dev/direct must supply it) -----
function tokenOk(header?: string): boolean {
  if (!API_TOKEN) return true // not configured -> open (warned at boot)
  if (!header) return false
  const m = /^Bearer\s+(.+)$/i.exec(header)
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(API_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'OPTIONS') return
  if (req.url === '/health' || req.url.startsWith('/health?')) return
  if (!tokenOk(req.headers['authorization'] as string | undefined)) {
    reply.code(401).send({ error: 'unauthorized' })
  }
})

function badKey(key: string): boolean {
  return !KEY_RE.test(key)
}

// ---- health ------------------------------------------------------------------
app.get('/health', async () => {
  await prisma.$queryRaw`SELECT 1`
  return { ok: true }
})

// ---- sync --------------------------------------------------------------------
app.get<{ Params: { key: string } }>('/external/kv/:key', async (req, reply) => {
  const { key } = req.params
  if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
  const out = await handleGet(key)
  return reply.send(out)
})

app.post<{ Params: { key: string }; Body: { value?: unknown; updated_by?: unknown } }>(
  '/external/kv/:key',
  async (req, reply) => {
    const { key } = req.params
    if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
    const body = req.body || {}
    if (body.value === undefined || body.value === null || typeof body.value !== 'object') {
      return reply.code(400).send({ error: 'value required' })
    }
    const approxBytes = JSON.stringify(body.value).length
    if (approxBytes > MAX_VALUE_BYTES) {
      return reply.code(413).send({ error: `value too large (${approxBytes} > ${MAX_VALUE_BYTES})` })
    }
    const updatedBy = typeof body.updated_by === 'string' ? body.updated_by.slice(0, 80) : null
    const { updated_at, changed } = await handlePost(key, body.value as State, updatedBy)
    // Only nudge live subscribers when the merge actually changed stored data.
    if (changed) publish(key, { updated_at, updated_by: updatedBy })
    return reply.send({ ok: true, updated_at })
  },
)

// ---- live updates (SSE) ------------------------------------------------------
// A browser opens EventSource(/external/kv/:key/events); we hold the connection
// open and push an `update` event whenever a POST changes that workspace, so the
// client pulls immediately instead of waiting for its 30s poll. Auth is enforced
// by the onRequest bearer hook (nginx injects the token in prod). Heartbeats keep
// the connection alive through proxies; the browser auto-reconnects on drop.
app.get<{ Params: { key: string } }>('/external/kv/:key/events', async (req, reply) => {
  const { key } = req.params
  if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })

  reply.hijack() // take over the raw socket; Fastify won't send a normal reply
  const res = reply.raw
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // ask nginx not to buffer this response
  })
  res.write('retry: 5000\n\n') // client reconnect backoff (ms)
  res.write(': connected\n\n')

  const unsubscribe = subscribe(key, (chunk) => res.write(chunk))
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* closed — cleanup runs via the close handler */
    }
  }, 25_000)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    clearInterval(heartbeat)
    unsubscribe()
  }
  req.raw.on('close', cleanup)
  req.raw.on('error', cleanup)
})

// ---- reporting (read-only, key-scoped, password never selected) --------------
const EXPENSE_COLS = { id: true, date: true, vendor: true, category: true, amount: true, currency: true, month: true }
const INVOICE_COLS = {
  id: true, number: true, date: true, status: true, currency: true,
  subtotal: true, taxPct: true, tax: true, total: true, client: true,
}
const TEAM_COLS = {
  id: true, name: true, role: true, payType: true, amount: true,
  monthlySalary: true, commissionAmount: true, active: true, isFounder: true,
  email: true, country: true,
}

app.get<{ Params: { key: string }; Querystring: { month?: string; category?: string } }>(
  '/reports/:key/expenses',
  async (req, reply) => {
    const { key } = req.params
    if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
    const { month, category } = req.query
    const rows = await prisma.expense.findMany({
      where: { workspaceId: key, deletedAt: null, ...(month ? { month } : {}), ...(category ? { category } : {}) },
      select: EXPENSE_COLS,
      orderBy: [{ month: 'desc' }, { date: 'desc' }],
    })
    return reply.send({ count: rows.length, rows })
  },
)

app.get<{ Params: { key: string }; Querystring: { status?: string } }>(
  '/reports/:key/invoices',
  async (req, reply) => {
    const { key } = req.params
    if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
    const { status } = req.query
    const rows = await prisma.invoice.findMany({
      where: { workspaceId: key, deletedAt: null, ...(status ? { status } : {}) },
      select: INVOICE_COLS,
      orderBy: { date: 'desc' },
    })
    return reply.send({ count: rows.length, rows })
  },
)

app.get<{ Params: { key: string } }>('/reports/:key/team', async (req, reply) => {
  const { key } = req.params
  if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
  const rows = await prisma.teamMember.findMany({
    where: { workspaceId: key, deletedAt: null },
    select: TEAM_COLS,
    orderBy: { name: 'asc' },
  })
  return reply.send({ count: rows.length, rows })
})

app.get<{ Params: { key: string } }>('/reports/:key/months', async (req, reply) => {
  const { key } = req.params
  if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
  const rows = await prisma.monthFigure.findMany({
    where: { workspaceId: key, deletedAt: null },
    orderBy: { monthId: 'desc' },
  })
  return reply.send({ count: rows.length, rows: rows.map(({ raw, ...r }) => r) })
})

// Simple P&L per month: month figures + summed expenses for that month.
app.get<{ Params: { key: string }; Querystring: { month?: string } }>(
  '/reports/:key/pnl',
  async (req, reply) => {
    const { key } = req.params
    if (badKey(key)) return reply.code(400).send({ error: 'invalid key' })
    const { month } = req.query
    const months = await prisma.monthFigure.findMany({
      where: { workspaceId: key, deletedAt: null, ...(month ? { monthId: month } : {}) },
      orderBy: { monthId: 'desc' },
    })
    const expenseByMonth = await prisma.expense.groupBy({
      by: ['month'],
      where: { workspaceId: key, deletedAt: null, ...(month ? { month } : {}) },
      _sum: { amount: true },
    })
    const expMap = new Map(expenseByMonth.map((e) => [e.month, e._sum.amount || 0]))
    const rows = months.map((m) => {
      const expenses = expMap.get(m.monthId) || 0
      const net = m.revenue - m.merchantFees - m.salariesTotal - m.commissionsTotal - m.refundsTotal - expenses
      return {
        month: m.monthId,
        revenue: m.revenue,
        merchantFees: m.merchantFees,
        salariesTotal: m.salariesTotal,
        commissionsTotal: m.commissionsTotal,
        refundsTotal: m.refundsTotal,
        otherExpenses: expenses,
        net,
      }
    })
    return reply.send({ count: rows.length, rows })
  },
)

// ---- boot --------------------------------------------------------------------
if (!API_TOKEN) {
  app.log.warn('API_TOKEN is not set — the API is OPEN (no write auth). Set API_TOKEN in production.')
}

try {
  await app.listen({ host: '0.0.0.0', port: PORT })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
