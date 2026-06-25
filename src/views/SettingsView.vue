<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { isoDate, isoMonth, monthOf } from '@/lib/format'
import {
  makeInitialState,
  DEFAULT_BUSINESS,
  DEFAULT_TARGETS,
} from '@/lib/seed'
import {
  cloudCfg,
  cloudPull,
  cloudPushNow,
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
// Replace the whole reactive state in place so the autosave watcher persists it.
function replaceState(newState: State) {
  const s = state.value as any
  for (const k of Object.keys(s)) {
    if (!(k in (newState as any))) delete s[k]
  }
  Object.assign(s, newState)
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

const importFile = ref<HTMLInputElement | null>(null)
function pickImport() {
  importFile.value?.click()
}
function onImportChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files && input.files[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data: any = JSON.parse(String(e.target?.result || ''))
      if (!data.months || !data.expenses) {
        alert('Invalid file — missing months/expenses')
        return
      }
      if (!confirm('Replace all current data with import?')) return
      data.targets = { ...DEFAULT_TARGETS, ...(data.targets || {}) }
      data.meta = { activeView: 'overview', currency: 'GBP', fxRate: 1.27, ...(data.meta || {}) }
      replaceState(data as State)
      refreshStatus()
    } catch (err: any) {
      alert('Import failed: ' + err.message)
    }
  }
  reader.readAsText(file)
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
        By default the dashboard saves to <b>this browser only</b>. Enable cloud sync so the data follows you and your
        team across logins, browsers, and countries. The workspace key is your team's "room number" — anyone with the
        same key sees the same data. Share it privately.
      </p>
      <div class="setting-row" style="margin-bottom: 8px">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer">
          <input type="checkbox" :checked="cfg.enabled" @change="onEnabledChange" />
          <span><b>Enable cloud sync</b> to <code>tracker.agencyadvanta.com</code></span>
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
        <button @click="pickImport">Import JSON</button>
        <input ref="importFile" type="file" accept="application/json" style="display: none" @change="onImportChange" />
        <button @click="exportExpensesCsv">Export expenses CSV</button>
        <button class="ghost" @click="resetBackfill">Reset to backfill (Jan–Mar 2026)</button>
        <button class="danger" @click="wipeAll">Wipe all data</button>
      </div>
      <div class="help">
        Backfill includes 174 expense items, the vendor library, team roster, and refunds parsed from your CSVs.
      </div>
    </div>
  </section>
</template>
