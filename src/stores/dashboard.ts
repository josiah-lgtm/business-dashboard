import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import type { State } from '@/types'
import { STORAGE_KEY, DEFAULT_TARGETS, DEFAULT_BUSINESS, makeInitialState, BACKFILL } from '@/lib/seed'
import { uid, isoMonth, sortedMonthIds } from '@/lib/format'
import { bindState } from '@/lib/store-access'
import { cloudPushSoon, cloudFlushNow, registerCloudHooks } from '@/lib/cloud'

// ============================================================
// loadState — ported verbatim from the legacy app. Every migration here
// MUST be preserved so existing localStorage / cloud data keeps loading.
// ============================================================
function loadState(): State | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s: any = JSON.parse(raw)
    s.targets = { ...DEFAULT_TARGETS, ...(s.targets || {}) }
    s.meta = { activeView: 'overview', currency: 'GBP', fxRate: 1.27, invoiceCounter: 1, ...(s.meta || {}) }
    // EUR/USD FX rates introduced after the original single fxRate.
    if (!s.meta.fxRates || typeof s.meta.fxRates !== 'object') {
      s.meta.fxRates = { USD: Number(s.meta.fxRate) || 1.27, EUR: 1.17 }
    } else {
      if (!s.meta.fxRates.USD) s.meta.fxRates.USD = Number(s.meta.fxRate) || 1.27
      if (!s.meta.fxRates.EUR) s.meta.fxRates.EUR = 1.17
    }
    s.meta.fxRate = s.meta.fxRates.USD
    // Migrations for v2.1 (tasks, invoices, business, team.monthlySalary)
    if (!s.tasks) s.tasks = []
    if (!s.invoices) s.invoices = []
    if (!s.budgets) s.budgets = {}
    if (!s.business) s.business = structuredClone(DEFAULT_BUSINESS)
    else {
      s.business = { ...structuredClone(DEFAULT_BUSINESS), ...s.business }
      s.business.banks = { ...DEFAULT_BUSINESS.banks, ...(s.business.banks || {}) }
    }
    s.team.forEach((t: any) => {
      if (t.monthlySalary == null) t.monthlySalary = 0
      if (t.commissionAmount == null) t.commissionAmount = 0
      delete t.commissionPct // old field, replaced with cash amount
      if (t.email == null) t.email = ''
      if (t.address == null) t.address = ''
      if (t.country == null) t.country = 'GB'
      if (!t.bank) t.bank = {}
      if (t.password == null) t.password = ''
    })
    if (!s.teamInvoices) s.teamInvoices = []
    if (!s.teamInvoiceCounters) s.teamInvoiceCounters = {}
    if (!s.teamInvoiceMonths) s.teamInvoiceMonths = {}
    if (s.teamInvoiceActiveMemberId === undefined) s.teamInvoiceActiveMemberId = null
    if (s.slackWebhookUrl == null) s.slackWebhookUrl = ''
    if (!Array.isArray(s.revenueEntries)) s.revenueEntries = []
    if (!Array.isArray(s.customBuckets)) s.customBuckets = []
    if (!Array.isArray(s.teamPayouts)) s.teamPayouts = []
    // Unify each team member's pay into one amount + a payType.
    ;(s.team || []).forEach((t: any) => {
      if (t.payType == null) {
        if ((t.monthlySalary || 0) > 0) {
          t.payType = 'salary'
          t.amount = t.monthlySalary
        } else if ((t.commissionAmount || 0) > 0) {
          t.payType = 'commission'
          t.amount = t.commissionAmount
        } else {
          t.payType = 'salary'
          t.amount = 0
        }
      }
      if (t.amount == null) t.amount = t.payType === 'commission' ? t.commissionAmount || 0 : t.monthlySalary || 0
    })
    // One-time cleanup: an earlier parser bug pulled Apr team-pay rows into refunds.
    if (s.refunds && s.refunds.length) {
      const knownTeamPayRecipients = new Set(['Anthony', 'Zahi', 'Tony', 'Severus', 'Harun'])
      const teamNames = new Set((s.team || []).map((t: any) => (t.name || '').trim()))
      s.refunds = s.refunds.filter((r: any) => {
        const n = (r.recipient || '').trim()
        if (/^Total Commi[sn]ion:?$/i.test(n)) return false
        if (/\((SETTER|SALES|CSM|OPS|SETTER MAN|SETTER MANAGER|SALES MANAGER|SALES REP|CLOSER|JUNIOR)\b/i.test(n)) return false
        if (knownTeamPayRecipients.has(n)) return false
        if (teamNames.has(n)) return false
        return true
      })
    }
    // Founder comp fields per month
    Object.values(s.months || {}).forEach((m: any) => {
      if (m.founderComp == null) m.founderComp = 0
    })
    if (s.targets.founderTaxPct == null) s.targets.founderTaxPct = 20

    // Auto-merge any new months from BACKFILL that the user doesn't already have.
    if (typeof BACKFILL !== 'undefined' && BACKFILL.months) {
      Object.entries(BACKFILL.months).forEach(([id, m]: [string, any]) => {
        if (s.months[id]) return
        s.months[id] = {
          revenue: m.revenue || 0,
          merchantFees: m.merchantFees || 0,
          salariesTotal: m.salariesTotal || 0,
          commissionsTotal: m.commissionsTotal || 0,
          referralPayoutsTotal: m.referralPayoutsTotal || 0,
          refundsTotal: m.refundsTotal || 0,
          founderComp: 0,
          taxPct: m.taxPct ?? 15,
          newClients: 0,
          activeClients: 0,
          churnedClients: 0,
        }
        BACKFILL.expenses.filter((e: any) => e.month === id).forEach((e: any) => {
          s.expenses.push({ id: uid(), ...e })
        })
        ;(BACKFILL.refunds || []).filter((r: any) => r.month === id).forEach((r: any) => {
          s.refunds.push({ id: uid(), ...r })
        })
      })
      const existingKeys = new Set(s.vendors.map((v: any) => v.name + '__' + v.category))
      ;(BACKFILL.vendors || []).forEach((v: any) => {
        const key = v.name + '__' + v.category
        if (!existingKeys.has(key)) {
          s.vendors.push({ id: uid(), ...v })
          existingKeys.add(key)
        }
      })
    }
    return s as State
  } catch (e) {
    console.error('loadState failed:', e)
    return null
  }
}

export const useDashboard = defineStore('dashboard', () => {
  const state = reactive<State>(loadState() || makeInitialState())
  bindState(state as State)

  // ---- Persistence (replaces the legacy mutate→saveState→renderX plumbing) ----
  const saveStatus = ref<string>('Saved')
  const saveDirty = ref<boolean>(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  let applyingRemote = false

  function persistNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      dirty = false
      saveStatus.value = 'Saved'
      saveDirty.value = false
    } catch (e) {
      console.error('saveState failed:', e)
      saveStatus.value = 'Save error'
      saveDirty.value = true
    }
  }

  function flushSaveStateNow() {
    if (!dirty) return
    if (saveTimer) clearTimeout(saveTimer)
    persistNow()
  }

  watch(
    state,
    () => {
      dirty = true
      saveStatus.value = 'Saving…'
      saveDirty.value = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(persistNow, 250)
      if (applyingRemote) {
        applyingRemote = false // consumed: this change came from a remote pull / cloud meta write
      } else {
        cloudPushSoon()
      }
    },
    { deep: true },
  )

  // Mutate without triggering a cloud push-back (used for remote-apply + cloud meta writes).
  function mutateSilently(fn: () => void) {
    applyingRemote = true
    fn()
    Promise.resolve().then(() => {
      applyingRemote = false
    })
  }

  // ---- Cloud hooks ----
  function applyRemoteState(remote: State, updatedAt: string) {
    mutateSilently(() => {
      const cloud = state.cloudSync
      for (const k of Object.keys(state)) {
        if (!(k in remote)) delete (state as any)[k]
      }
      Object.assign(state, remote)
      state.cloudSync = cloud
      state.meta = state.meta || ({} as any)
      state.meta.cloudUpdatedAt = updatedAt
    })
    persistNow()
    bindState(state as State)
  }
  function setCloudMeta(updatedAt: string) {
    mutateSilently(() => {
      state.meta = state.meta || ({} as any)
      state.meta.cloudUpdatedAt = updatedAt
    })
    persistNow()
  }
  registerCloudHooks({ applyRemote: applyRemoteState, setCloudMeta })

  // Unload flush handlers (parity with legacy beforeunload/pagehide/visibilitychange).
  window.addEventListener('beforeunload', () => {
    flushSaveStateNow()
    cloudFlushNow()
  })
  window.addEventListener('pagehide', () => {
    flushSaveStateNow()
    cloudFlushNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSaveStateNow()
      cloudFlushNow()
    }
  })

  // ---- Shell actions ----
  function setActiveMonth(id: string) {
    state.meta.activeMonth = id
  }
  function setCurrency(cur: State['meta']['currency']) {
    state.meta.currency = cur
  }
  function setFxRate(value: number) {
    const cur = state.meta.currency || 'GBP'
    if (cur === 'GBP') return
    state.meta.fxRates = state.meta.fxRates || { USD: 1.27, EUR: 1.17 }
    state.meta.fxRates[cur] = value || state.meta.fxRates[cur]
    if (cur === 'USD') state.meta.fxRate = state.meta.fxRates.USD
  }
  function addMonth(): string | null {
    const ids = sortedMonthIds()
    const last = ids[ids.length - 1]
    let suggested: string
    if (last) {
      const [y, m] = last.split('-').map(Number)
      const d = new Date(y, m, 1) // next month
      suggested = isoMonth(d)
    } else {
      suggested = isoMonth(new Date())
    }
    const input = window.prompt('New month (YYYY-MM):', suggested)
    if (!input) return null
    const id = input.trim()
    if (!/^\d{4}-\d{2}$/.test(id)) {
      window.alert('Use format YYYY-MM, e.g. 2026-06')
      return null
    }
    if (state.months[id]) {
      state.meta.activeMonth = id
      return id
    }
    state.months[id] = {
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
    state.meta.activeMonth = id
    return id
  }

  function deleteMonth(id: string) {
    delete state.months[id]
    state.expenses = state.expenses.filter((e) => (e.month || (e.date ? e.date.slice(0, 7) : '')) !== id)
    state.refunds = state.refunds.filter((r) => r.month !== id)
    const remaining = sortedMonthIds()
    if (state.meta.activeMonth === id) {
      state.meta.activeMonth = remaining[remaining.length - 1] || isoMonth(new Date())
    }
  }

  return {
    state,
    saveStatus,
    saveDirty,
    persistNow,
    flushSaveStateNow,
    setActiveMonth,
    setCurrency,
    setFxRate,
    addMonth,
    deleteMonth,
  }
})
