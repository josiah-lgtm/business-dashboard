// ============================================================
// Persistence: load -> merge -> persist, all inside ONE advisory-locked
// transaction so concurrent POSTs to the same key can't lose each other's
// writes (the guarantee the old single-blob KV never had).
//
// POST flow: lock the workspace, reconstruct current State from rows, run the
// SAME merge the client uses (preferRemote: true — the POST is the newest
// writer), and if anything changed, write the merged union back (upsert live
// rows, soft-delete tombstoned rows) + snapshot for recovery.
// ============================================================
import { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { mergeStates } from './merge.js'
import {
  ID_COLLECTIONS,
  type CollectionName,
  type DbState,
  emptyDbState,
  decompose,
  reconstruct,
  isEmptyDb,
  stripPasswords,
  COLUMN_PROJECTORS,
  monthColumns,
  budgetColumns,
} from './serialize.js'
import type { State } from './types.js'

// state collection name -> Prisma model delegate name
const DELEGATE: Record<CollectionName, string> = {
  expenses: 'expense',
  vendors: 'vendor',
  refunds: 'refund',
  team: 'teamMember',
  tasks: 'task',
  invoices: 'invoice',
  teamInvoices: 'teamInvoice',
  revenueEntries: 'revenueEntry',
  customBuckets: 'customBucket',
  teamPayouts: 'teamPayout',
}

const SNAPSHOT_KEEP = 100

// optional Json column -> SQL NULL; required Json -> JSON null
const dbNull = (v: any) => (v === undefined || v === null ? Prisma.DbNull : v)
const jsonNull = (v: any) => (v === undefined || v === null ? Prisma.JsonNull : v)
const toIso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

type Client = any // Prisma client or interactive-tx client; bracket delegate access

interface LoadResult {
  db: DbState
  dataUpdatedAt: Date | null
  updatedBy: string | null
}

async function loadDbState(c: Client, key: string): Promise<LoadResult> {
  const db = emptyDbState()
  const ws = await c.workspace.findUnique({ where: { key } })
  if (ws) {
    db.workspace = {
      business: ws.business ?? null,
      targets: ws.targets ?? null,
      fxRates: ws.fxRates ?? null,
      fxRate: ws.fxRate ?? 0,
      invoiceCounter: ws.invoiceCounter ?? 1,
      slackWebhookUrl: ws.slackWebhookUrl ?? '',
    }
  }
  for (const coll of ID_COLLECTIONS) {
    const rows = await c[DELEGATE[coll]].findMany({
      where: { workspaceId: key, deletedAt: null },
      orderBy: { id: 'asc' },
    })
    ;(db as any)[coll] = rows.map((r: any) => r.raw)
  }
  const months = await c.monthFigure.findMany({ where: { workspaceId: key, deletedAt: null } })
  for (const m of months) db.months[m.monthId] = m.raw
  const budgets = await c.budget.findMany({ where: { workspaceId: key, deletedAt: null } })
  for (const b of budgets) db.budgets[b.budgetKey] = b.raw
  const counters = await c.teamInvoiceCounter.findMany({ where: { workspaceId: key } })
  for (const t of counters) db.teamInvoiceCounters[t.counterKey] = t.value
  const tim = await c.teamInvoiceMonth.findMany({ where: { workspaceId: key } })
  for (const t of tim) db.teamInvoiceMonths[t.monthKey] = t.value
  const tombs = await c.tombstone.findMany({ where: { workspaceId: key } })
  for (const t of tombs) db.deletions[t.key] = t.deletedAt
  return { db, dataUpdatedAt: ws?.dataUpdatedAt ?? null, updatedBy: ws?.updatedBy ?? null }
}

async function persistMerged(c: Client, key: string, merged: State, updatedBy: string | null, now: Date) {
  const db = decompose(merged)
  const ws = db.workspace!

  const wsData = {
    business: dbNull(ws.business),
    targets: dbNull(ws.targets),
    fxRates: dbNull(ws.fxRates),
    fxRate: ws.fxRate,
    invoiceCounter: ws.invoiceCounter,
    slackWebhookUrl: ws.slackWebhookUrl,
    dataUpdatedAt: now,
    updatedBy,
  }
  await c.workspace.upsert({ where: { key }, create: { key, ...wsData }, update: wsData })

  // id-keyed collections: upsert each live entity (raw + projected columns)
  for (const coll of ID_COLLECTIONS) {
    const delegate = DELEGATE[coll]
    for (const entity of (db as any)[coll] as any[]) {
      const cols = COLUMN_PROJECTORS[coll](entity)
      const data: any = { ...cols, raw: entity, deletedAt: null }
      await c[delegate].upsert({
        where: { workspaceId_id: { workspaceId: key, id: entity.id } },
        create: { workspaceId: key, id: entity.id, ...data },
        update: data,
      })
    }
  }

  // record maps
  for (const [monthId, m] of Object.entries(db.months)) {
    const data: any = { ...monthColumns(m), raw: m, deletedAt: null }
    await c.monthFigure.upsert({
      where: { workspaceId_monthId: { workspaceId: key, monthId } },
      create: { workspaceId: key, monthId, ...data },
      update: data,
    })
  }
  for (const [budgetKey, b] of Object.entries(db.budgets)) {
    const { savedAt, data: bdata } = budgetColumns(b)
    const data: any = { savedAt, data: jsonNull(bdata), raw: b, deletedAt: null }
    await c.budget.upsert({
      where: { workspaceId_budgetKey: { workspaceId: key, budgetKey } },
      create: { workspaceId: key, budgetKey, ...data },
      update: data,
    })
  }
  for (const [counterKey, value] of Object.entries(db.teamInvoiceCounters)) {
    const v = Number(value) || 0
    await c.teamInvoiceCounter.upsert({
      where: { workspaceId_counterKey: { workspaceId: key, counterKey } },
      create: { workspaceId: key, counterKey, value: v },
      update: { value: v },
    })
  }
  for (const [monthKey, value] of Object.entries(db.teamInvoiceMonths)) {
    await c.teamInvoiceMonth.upsert({
      where: { workspaceId_monthKey: { workspaceId: key, monthKey } },
      create: { workspaceId: key, monthKey, value: jsonNull(value) },
      update: { value: jsonNull(value) },
    })
  }

  // tombstones: record the deletion map, then soft-delete matching rows (delete-wins)
  for (const [tkey, iso] of Object.entries(db.deletions)) {
    await c.tombstone.upsert({
      where: { workspaceId_key: { workspaceId: key, key: tkey } },
      create: { workspaceId: key, key: tkey, deletedAt: iso },
      update: { deletedAt: iso },
    })
    const sep = tkey.indexOf(':')
    if (sep < 0) continue
    const coll = tkey.slice(0, sep)
    const id = tkey.slice(sep + 1)
    if (coll === 'months') {
      await c.monthFigure.updateMany({
        where: { workspaceId: key, monthId: id, deletedAt: null },
        data: { deletedAt: now },
      })
    } else if ((DELEGATE as any)[coll]) {
      await c[(DELEGATE as any)[coll]].updateMany({
        where: { workspaceId: key, id, deletedAt: null },
        data: { deletedAt: now },
      })
    }
  }

  // recovery snapshot (passwords stripped)
  await c.snapshot.create({
    data: { workspaceId: key, updatedBy, reason: 'post', value: stripPasswords(merged) as any },
  })
}

async function pruneSnapshots(key: string) {
  try {
    const old = await prisma.snapshot.findMany({
      where: { workspaceId: key },
      orderBy: { takenAt: 'desc' },
      skip: SNAPSHOT_KEEP,
      select: { id: true },
    })
    if (old.length) await prisma.snapshot.deleteMany({ where: { id: { in: old.map((o) => o.id) } } })
  } catch {
    /* best effort */
  }
}

export async function handleGet(key: string): Promise<{ value: State | null; updated_at: string | null; updated_by: string | null }> {
  const { db, dataUpdatedAt, updatedBy } = await loadDbState(prisma, key)
  if (isEmptyDb(db)) return { value: null, updated_at: null, updated_by: null }
  return { value: reconstruct(db), updated_at: toIso(dataUpdatedAt ?? new Date()), updated_by: updatedBy ?? null }
}

export async function handlePost(
  key: string,
  incoming: State,
  updatedBy: string | null,
): Promise<{ updated_at: string; changed: boolean }> {
  const now = new Date()
  const result = await prisma.$transaction(
    async (tx) => {
      // $executeRaw (not $queryRaw): the lock returns a `void` column that
      // $queryRaw would try to deserialize and fail on. executeRaw just runs it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
      const { db, dataUpdatedAt } = await loadDbState(tx, key)
      const current = reconstruct(db)
      const { merged, changed } = mergeStates(current, incoming, { preferRemote: true })
      if (!changed) return { at: dataUpdatedAt ?? now, changed: false }
      await persistMerged(tx, key, merged, updatedBy, now)
      return { at: now, changed: true }
    },
    { timeout: 30_000, maxWait: 15_000 },
  )
  if (result.changed) await pruneSnapshots(key)
  return { updated_at: toIso(result.at), changed: result.changed }
}
