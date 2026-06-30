<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { isoDate, isoMonth, monthOf } from '@/lib/format'
import {
  makeInitialState,
  DEFAULT_BUSINESS,
  DEFAULT_TARGETS,
} from '@/lib/seed'
import { mergeStates } from '@/lib/merge'
import {
  cloudCfg,
  cloudPull,
  cloudPushNow,
  cloudIsEnabled,
  cloudGenerateKey,
  cloudStartPolling,
  cloudRelativeTime,
  setCloudStatus,
  CLOUD_DEFAULTS,
} from '@/lib/cloud'
import type { State } from '@/types'

const store = useDashboard()
const { state } = storeToRefs(store)

// ---------- Business details ----------
const businessFields: [string, string][] = [
  ['name', 'Legal company name'],
  ['tradingAs', 'Trading as (brand name shown on invoice)'],
  ['address', 'Address'],
  ['companyNumber', 'Company number'],
  ['taxId', 'Tax ID / VAT'],
  ['sin', 'SIN'],
  ['email', 'Email (optional)'],
  ['website', 'Website (optional)'],
]

// ---------- Bank account fields ----------
const bankCurrencies = ['GBP', 'USD', 'EUR'] as const
const bankFields: [string, string][] = [
  ['holder', 'Account holder'],
  ['bank', 'Bank'],
  ['iban', 'IBAN'],
  ['bic', 'BIC / SWIFT'],
  ['intermediaryBic', 'Intermediary BIC'],
  ['sortCode', 'Sort code'],
  ['accountNumber', 'Account number'],
  ['address', 'Bank address'],
]

// ---------- Targets ----------
const targetFields: [keyof State['targets'], string][] = [
  ['gmPct', 'Gross margin target (%)'],
  ['nmPct', 'Net margin target (%)'],
  ['taxPct', 'Default corporate tax % (set-aside)'],
  ['founderTaxPct', 'Founder personal tax % (on draws/comp)'],
  ['cashMonths', 'Cash reserve target (× overhead)'],
  ['refundPctMax', 'Max refund rate alert (%)'],
  ['overheadPctMax', 'Max overhead/rev alert (%)'],
]

function onTargetInput(key: keyof State['targets'], ev: Event) {
  const v = parseFloat((ev.target as HTMLInputElement).value)
  state.value.targets[key] = (isNaN(v) ? 0 : v) as never
}

// ---------- Logo ----------
const logoFile = ref<HTMLInputElement | null>(null)
function pickLogo() {
  logoFile.value?.click()
}
function onLogoChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files && input.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    alert('Logo must be under 2MB')
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = (e) => {
    state.value.business.logoDataUrl = String(e.target?.result || '')
  }
  reader.readAsDataURL(file)
  input.value = ''
}
function resetLogo() {
  state.value.business.logoDataUrl = ''
}

// ---------- Cloud sync ----------
// cloudCfg() returns the reactive store.state.cloudSync object (created if absent).
const cfg = cloudCfg()
const csStatus = ref<{ text: string; color: string }>({ text: '', color: 'var(--text-tertiary)' })

function refreshStatus() {
  if (!cfg.enabled) {
    csStatus.value = { text: 'Off — local only', color: 'var(--text-tertiary)' }
    return
  }
  if (!cfg.key) {
    csStatus.value = { text: 'Set a workspace key first', color: 'var(--warn)' }
    return
  }
  const last = state.value.meta?.cloudUpdatedAt
  csStatus.value = {
    text: last ? `Last sync ${cloudRelativeTime(last)}` : 'Not synced yet',
    color: 'var(--text-secondary)',
  }
}
refreshStatus()

function onEnabledChange(ev: Event) {
  cfg.enabled = (ev.target as HTMLInputElement).checked
  if (cfg.enabled && !cfg.key) {
    cfg.key = cloudGenerateKey()
  }
  setCloudStatus(cfg.enabled ? 'Connecting…' : 'Off', cfg.enabled ? 'syncing' : '')
  if (cfg.enabled) {
    cloudPull().then(() => {
      refreshStatus()
      cloudStartPolling()
    })
  }
  refreshStatus()
}
function onKeyChange(ev: Event) {
  cfg.key = (ev.target as HTMLInputElement).value.trim()
  refreshStatus()
}
function onUrlChange(ev: Event) {
  cfg.url = (ev.target as HTMLInputElement).value.trim() || CLOUD_DEFAULTS.url
  refreshStatus()
}
function genKey() {
  cfg.key = cloudGenerateKey()
  refreshStatus()
}
function copyKey() {
  if (!cfg.key) return
  navigator.clipboard?.writeText(cfg.key)
  csStatus.value = { text: 'Key copied — share privately with your team', color: 'var(--good)' }
  setTimeout(refreshStatus, 2200)
}
async function pullNow() {
  csStatus.value = { text: 'Pulling…', color: 'var(--text-secondary)' }
  const r = await cloudPull()
  if (r.ok && r.applied) csStatus.value = { text: '✓ Pulled remote — your view was replaced', color: 'var(--good)' }
  else if (r.ok) csStatus.value = { text: '✓ Already up-to-date', color: 'var(--good)' }
  else csStatus.value = { text: 'Pull failed — check console', color: 'var(--bad)' }
  setTimeout(refreshStatus, 2500)
}
async function pushNow() {
  csStatus.value = { text: 'Pushing…', color: 'var(--text-secondary)' }
  await cloudPushNow()
  csStatus.value = { text: '✓ Pushed to cloud', color: 'var(--good)' }
  setTimeout(refreshStatus, 2200)
}

// ---------- Data: export / import / reset / wipe ----------
// Wholesale replace runs through the store's silent path: it rebases the
// tombstone baseline and does not push, so a local reset/wipe/replace can't
// emit mass deletions or clear the shared cloud copy.
function replaceState(newState: State) {
  store.replaceWholeState(newState)
}

function exportJson() {
  const data = JSON.stringify(state.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `business-dashboard-${isoDate(new Date())}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- Import & merge (preview-first, content-deduped) ----------
// Collections the server keys by id (mirrors api/src/serialize.ts ID_COLLECTIONS).
const IMPORT_COLLECTIONS: { key: keyof State; label: string }[] = [
  { key: 'expenses', label: 'expenses' },
  { key: 'vendors', label: 'vendors' },
  { key: 'refunds', label: 'refunds' },
  { key: 'team', label: 'team members' },
  { key: 'tasks', label: 'tasks' },
  { key: 'invoices', label: 'invoices' },
  { key: 'teamInvoices', label: 'team invoices' },
  { key: 'revenueEntries', label: 'revenue entries' },
  { key: 'customBuckets', label: 'custom buckets' },
  { key: 'teamPayouts', label: 'team payouts' },
]

// Why a CONTENT key (not just id): the historical rows were seeded into this app
// from backfill.json with random ids, and the legacy export carries the SAME
// rows with *different* random ids. An id-only union would re-add every one as a
// duplicate. So for the collections backfill also seeds (expenses/vendors/refunds/
// team), we treat a row as already-present when its date+name+amount matches —
// independent of id. Collections backfill never seeds (tasks/invoices/…) only
// exist in the export, so id-matching alone is correct for them.
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const amt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}
function contentKey(coll: string, e: any): string | null {
  if (!e) return null
  switch (coll) {
    case 'expenses':
      return `${norm(e.vendor)}|${amt(e.amount)}|${e.date || e.month || ''}`
    case 'refunds':
      return `${norm(e.recipient)}|${amt(e.amount)}|${e.date || e.month || ''}`
    case 'vendors':
      return `${norm(e.name)}|${norm(e.category)}`
    case 'team':
      return `${norm(e.name)}|${norm(e.role)}`
    default:
      return null // id-only for collections backfill doesn't seed
  }
}

interface PlanRow {
  label: string
  add: number
  dup: number
}
interface ImportPlan {
  filtered: State
  rows: PlanRow[]
  monthsAdd: number
  monthsMatch: number
  totalAdd: number
  totalDup: number
}

const importData = ref<{ fileName: string; data: State } | null>(null)
const dedupeOn = ref(true)
const importMsg = ref<{ text: string; color: string } | null>(null)
const importBusy = ref(false)

// Recomputed live against current data (and the dedupe toggle): drops incoming
// rows whose id OR content already exists, so the preview counts equal exactly
// what the confirmed merge will add.
const importPlan = computed<ImportPlan | null>(() => {
  if (!importData.value) return null
  const data: any = importData.value.data
  const filtered: any = { ...data }
  const rows: PlanRow[] = []
  let totalAdd = 0
  let totalDup = 0
  for (const c of IMPORT_COLLECTIONS) {
    const incoming: any[] = Array.isArray(data[c.key]) ? data[c.key] : []
    if (!incoming.length) continue
    const curArr: any[] = Array.isArray((state.value as any)[c.key]) ? (state.value as any)[c.key] : []
    const ids = new Set<string>(curArr.filter((x) => x && x.id != null).map((x) => String(x.id)))
    const content = new Set<string>()
    if (dedupeOn.value) for (const x of curArr) { const k = contentKey(c.key, x); if (k) content.add(k) }
    const kept: any[] = []
    let dup = 0
    for (const e of incoming) {
      const id = e && e.id != null ? String(e.id) : null
      const ck = dedupeOn.value ? contentKey(c.key, e) : null
      if ((id && ids.has(id)) || (ck && content.has(ck))) { dup++; continue }
      kept.push(e)
      if (id) ids.add(id) // collapse duplicates WITHIN the import too
      if (ck) content.add(ck)
    }
    filtered[c.key] = kept
    rows.push({ label: c.label, add: kept.length, dup })
    totalAdd += kept.length
    totalDup += dup
  }
  const incomingMonths = data.months && typeof data.months === 'object' ? Object.keys(data.months) : []
  const haveMonths = new Set(Object.keys(state.value.months || {}))
  let monthsAdd = 0
  for (const k of incomingMonths) if (!haveMonths.has(k)) monthsAdd++
  totalAdd += monthsAdd
  return { filtered: filtered as State, rows, monthsAdd, monthsMatch: incomingMonths.length - monthsAdd, totalAdd, totalDup }
})

const importFile = ref<HTMLInputElement | null>(null)
function pickImport() {
  importFile.value?.click()
}

// Parse the chosen file and stage it for preview — without touching anything yet.
function onImportChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files && input.files[0]
  input.value = ''
  importMsg.value = null
  importData.value = null
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    let data: any
    try {
      data = JSON.parse(String(e.target?.result || ''))
    } catch (err: any) {
      importMsg.value = { text: 'Not valid JSON: ' + (err?.message || err), color: 'var(--bad)' }
      return
    }
    if (!data || typeof data !== 'object' || (!data.months && !Array.isArray(data.expenses))) {
      importMsg.value = { text: 'This doesn’t look like a dashboard export (no months/expenses).', color: 'var(--bad)' }
      return
    }
    // Refuse id-less rows (raw backfill/template data): the server keys by id, so
    // those rows would be dropped on sync and any re-import would duplicate them.
    let idless = 0
    for (const c of IMPORT_COLLECTIONS) {
      const arr = (data as any)[c.key]
      if (Array.isArray(arr)) idless += arr.filter((x: any) => !x || x.id == null).length
    }
    if (idless) {
      importMsg.value = {
        text:
          `This file has ${idless} row(s) with no ID — it looks like raw backfill/template data, not a ` +
          'real export. Use a file from Settings → Export JSON (in this app or the legacy one).',
        color: 'var(--bad)',
      }
      return
    }
    importData.value = { fileName: file.name, data: data as State }
  }
  reader.readAsText(file)
}

// Confirmed merge: union the deduped rows into current data (existing entries win
// on conflict, so nothing is overwritten), then push straight to the team workspace.
async function confirmMergeImport() {
  const plan = importPlan.value
  const src = importData.value
  if (!plan || !src) return
  importBusy.value = true
  try {
    const { merged } = mergeStates(state.value as State, plan.filtered, { preferRemote: false })
    replaceState(merged)
    let synced = false
    if (cloudIsEnabled()) {
      await cloudPushNow() // replaceWholeState is silent — push so prod gets the union now
      synced = true
    }
    importMsg.value = {
      text:
        `Imported ${src.fileName}: added ${plan.totalAdd} new row(s)` +
        (plan.totalDup ? `, skipped ${plan.totalDup} already present` : '') +
        '.' +
        (synced ? ' Synced to the team workspace.' : ' Saved locally (cloud sync is off).'),
      color: 'var(--good)',
    }
  } catch (err: any) {
    importMsg.value = { text: 'Import failed: ' + (err?.message || err), color: 'var(--bad)' }
  } finally {
    importBusy.value = false
    importData.value = null
    refreshStatus()
  }
}

function confirmReplaceImport() {
  const src = importData.value
  if (!src) return
  if (
    !confirm(
      'Replace ALL your current data with this file? This overwrites your local view. ' +
        '(The shared cloud copy re-merges on the next pull unless you turn sync off first.)',
    )
  )
    return
  replaceState(src.data)
  importMsg.value = { text: `Replaced local data from ${src.fileName}.`, color: 'var(--good)' }
  importData.value = null
  refreshStatus()
}

function cancelImport() {
  importData.value = null
  importMsg.value = null
}

function exportExpensesCsv() {
  const filterMonth = state.value.meta.activeMonth || ''
  const rows = filterMonth
    ? state.value.expenses.filter((e) => (e.month || monthOf(e.date)) === filterMonth)
    : state.value.expenses
  const lines = ['date,vendor,category,amount,month']
  rows.forEach((e) => {
    lines.push([e.date, `"${e.vendor.replace(/"/g, '""')}"`, e.category, e.amount, e.month || monthOf(e.date)].join(','))
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `expenses-${filterMonth || 'all'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function resetBackfill() {
  if (!confirm('Replace ALL current data with the original backfill (Jan–Mar 2026)?')) return
  replaceState(makeInitialState())
  refreshStatus()
}

function wipeAll() {
  if (!confirm('Wipe ALL data and start with an empty dashboard?')) return
  const activeMonth = isoMonth(new Date())
  const fresh: State = {
    meta: {
      activeView: 'overview',
      activeMonth,
      currency: 'GBP',
      fxRates: { USD: 1.27, EUR: 1.17 },
      fxRate: 1.27,
      invoiceCounter: 1,
    },
    months: {},
    expenses: [],
    vendors: [],
    refunds: [],
    team: [],
    tasks: [],
    invoices: [],
    teamInvoices: [],
    teamInvoiceCounters: {},
    teamInvoiceMonths: {},
    teamInvoiceActiveMemberId: null,
    slackWebhookUrl: '',
    budgets: {},
    business: structuredClone(DEFAULT_BUSINESS),
    targets: { ...DEFAULT_TARGETS },
    revenueEntries: [],
    customBuckets: [],
    teamPayouts: [],
    deletions: {},
  }
  fresh.months[activeMonth] = {
    revenue: 0,
    merchantFees: 0,
    salariesTotal: 0,
    commissionsTotal: 0,
    referralPayoutsTotal: 0,
    refundsTotal: 0,
    founderComp: 0,
    taxPct: 15,
    newClients: 0,
    activeClients: 0,
    churnedClients: 0,
  }
  replaceState(fresh)
  refreshStatus()
}
</script>

<template>
  <section class="panel active" data-view="settings">
    <div class="panel-header">
      <div>
        <h2>Settings</h2>
        <div class="sub">Business details, targets, currency, import/export.</div>
      </div>
    </div>

    <!-- Business details -->
    <div class="card">
      <h3>Business details (used in invoices)</h3>
      <div class="grid grid-2">
        <div v-for="[k, label] in businessFields" :key="k" :style="k === 'address' ? 'grid-column:1/-1' : ''">
          <label>{{ label }}</label>
          <textarea
            v-if="k === 'address'"
            rows="2"
            :value="(state.business as any)[k] || ''"
            @input="(state.business as any)[k] = ($event.target as HTMLTextAreaElement).value"
          ></textarea>
          <input
            v-else
            type="text"
            :value="(state.business as any)[k] || ''"
            @input="(state.business as any)[k] = ($event.target as HTMLInputElement).value"
          />
        </div>
      </div>

      <div style="margin-top: 14px">
        <label>Logo</label>
        <div style="display: flex; gap: 12px; align-items: center">
          <div
            style="width: 80px; height: 80px; background: #fff; border-radius: 6px; display: flex; align-items: center; justify-content: center; padding: 6px"
          >
            <img
              :src="state.business.logoDataUrl || '/logo.png'"
              alt="Agency Advanta"
              style="max-width: 100%; max-height: 100%; object-fit: contain"
            />
          </div>
          <div>
            <button @click="pickLogo">Upload logo (PNG/SVG)</button>
            <input ref="logoFile" type="file" accept="image/*" style="display: none" @change="onLogoChange" />
            <button class="ghost small" style="margin-left: 6px" @click="resetLogo">Reset to default</button>
            <div class="help">Default is an inline AA gold monogram. Upload a square logo for best results.</div>
          </div>
        </div>
      </div>

      <h3 style="margin-top: 18px">Bank accounts</h3>
      <details v-for="(cur, i) in bankCurrencies" :key="cur" :open="i === 0">
        <summary style="color: var(--text); font-weight: 600">{{ cur }} account</summary>
        <div class="grid grid-2" style="margin-top: 8px">
          <div v-for="[k, label] in bankFields" :key="k">
            <label>{{ label }}</label>
            <input
              type="text"
              :value="(state.business.banks[cur] as any)[k] || ''"
              @input="(state.business.banks[cur] as any)[k] = ($event.target as HTMLInputElement).value"
            />
          </div>
        </div>
      </details>
    </div>

    <!-- Cloud sync -->
    <div class="card">
      <h3>☁️ Cloud sync — same data on every device</h3>
      <p class="help" style="margin-top: 0">
        The dashboard syncs to <b>this app's own server</b> (Postgres) so the data follows you and your
        team across logins, browsers, and countries. The workspace key is your team's "room number" — anyone with the
        same key sees the same data. Share it privately. Turn sync off to keep data in this browser only.
      </p>
      <div class="setting-row" style="margin-bottom: 8px">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer">
          <input type="checkbox" :checked="cfg.enabled" @change="onEnabledChange" />
          <span><b>Enable cloud sync</b> to this app's server</span>
        </label>
      </div>
      <div class="setting-row" style="margin-bottom: 8px">
        <label for="cs-key">Workspace key</label>
        <input
          id="cs-key"
          type="text"
          placeholder="bd-myworkspace-abc123"
          autocomplete="off"
          :value="cfg.key"
          @change="onKeyChange"
        />
        <button type="button" class="ghost small" @click="genKey">↻ Generate</button>
        <button type="button" class="ghost small" @click="copyKey">📋 Copy</button>
      </div>
      <div class="setting-row" style="margin-bottom: 8px">
        <label for="cs-url">Endpoint URL</label>
        <input id="cs-url" type="url" :value="cfg.url || CLOUD_DEFAULTS.url" @change="onUrlChange" />
      </div>
      <div class="setting-row" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px">
        <button type="button" class="ghost" @click="pullNow">⬇ Pull from cloud now</button>
        <button type="button" class="primary" @click="pushNow">⬆ Push to cloud now</button>
        <span class="help" style="margin-left: 6px; align-self: center" :style="{ color: csStatus.color }">{{
          csStatus.text || '—'
        }}</span>
      </div>
      <div class="help" style="margin-top: 10px">
        <b>How it works:</b> every keystroke saves locally; the local copy is mirrored to the server every ~1.5s. Other
        devices on the same key poll every 30s and replace their copy when the server is newer. Last-write-wins. Don't
        enter the same fields on two devices at the exact same time.
      </div>
    </div>

    <!-- Targets -->
    <div class="card">
      <h3>Targets &amp; thresholds</h3>
      <div class="grid grid-auto">
        <div v-for="[k, label] in targetFields" :key="k">
          <label>{{ label }}</label>
          <input type="number" step="0.1" min="0" :value="state.targets[k]" @input="onTargetInput(k, $event)" />
        </div>
      </div>
    </div>

    <!-- Data -->
    <div class="card">
      <h3>Data</h3>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button @click="exportJson">Export JSON</button>
        <button class="primary" @click="pickImport">Import &amp; merge data…</button>
        <input ref="importFile" type="file" accept="application/json,.json" style="display: none" @change="onImportChange" />
        <button @click="exportExpensesCsv">Export expenses CSV</button>
        <button class="ghost" @click="resetBackfill">Reset to backfill (Jan–Mar 2026)</button>
        <button class="danger" @click="wipeAll">Wipe all data</button>
      </div>
      <div class="help">
        <b>Import &amp; merge</b> combines another export — e.g. from the <b>legacy app</b> or a teammate —
        into your data. Existing entries are kept (nothing is overwritten) and the result syncs to the team
        workspace. You'll see a preview of exactly what gets added before anything changes.
      </div>

      <!-- Import preview / confirmation -->
      <div
        v-if="importData && importPlan"
        class="card"
        style="margin-top: 12px; border: 1px solid var(--border); background: var(--bg-subtle, transparent)"
      >
        <h4 style="margin: 0 0 6px">Preview — {{ importData.fileName }}</h4>
        <p class="help" style="margin-top: 0">
          This <b>adds</b> the rows below to your current data. Existing entries are kept as-is — nothing is
          overwritten.
        </p>
        <label
          style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 4px 0 10px; font-size: 0.92em"
        >
          <input type="checkbox" v-model="dedupeOn" :disabled="importBusy" />
          <span>Skip rows already present (same <b>date, name &amp; amount</b>) — recommended</span>
        </label>
        <ul v-if="importPlan.totalAdd" style="margin: 6px 0 10px; padding-left: 18px">
          <li v-for="r in importPlan.rows" :key="r.label" v-show="r.add || r.dup">
            <b>+{{ r.add }}</b> {{ r.label }}
            <span v-if="r.dup" class="help"> ({{ r.dup }} already present, skipped)</span>
          </li>
          <li v-if="importPlan.monthsAdd || importPlan.monthsMatch">
            <b>+{{ importPlan.monthsAdd }}</b> months
            <span v-if="importPlan.monthsMatch" class="help"> ({{ importPlan.monthsMatch }} already present)</span>
          </li>
        </ul>
        <p v-else class="help" style="color: var(--warn)">
          Nothing new to add — your data already contains everything in this file
          <span v-if="importPlan.totalDup">({{ importPlan.totalDup }} matching rows skipped)</span>.
        </p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
          <button class="primary" :disabled="importBusy || !importPlan.totalAdd" @click="confirmMergeImport">
            {{ importBusy ? 'Merging…' : `Merge ${importPlan.totalAdd} new row(s) into my data` }}
          </button>
          <button class="ghost" :disabled="importBusy" @click="cancelImport">Cancel</button>
          <button class="ghost small" :disabled="importBusy" style="margin-left: auto" @click="confirmReplaceImport">
            Replace all instead (local only)
          </button>
        </div>
      </div>

      <div v-if="importMsg" class="help" :style="{ color: importMsg.color, marginTop: '10px', fontWeight: 600 }">
        {{ importMsg.text }}
      </div>

      <div class="help" style="margin-top: 8px">
        Backfill includes 174 expense items, the vendor library, team roster, and refunds parsed from your CSVs.
      </div>
    </div>
  </section>
</template>
