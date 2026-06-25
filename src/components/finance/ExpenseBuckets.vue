<script setup lang="ts">
// Expense / team / refund buckets — ports legacy renderFhBuckets + all its
// inline editing, drill-down, team-picker, add-item form, and add-bucket modal.
import { ref, reactive, computed, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { expensesForMonth } from '@/lib/calc'
import { fhAllBuckets } from '@/lib/buckets'
import type { BucketDef } from '@/lib/buckets'
import { money, moneyIn, gbpAmount, fxRateFor } from '@/lib/money'
import { uid, isoDate, monthOf, fmtMonth, fmtDate } from '@/lib/format'
import type { Currency } from '@/types'
import FhInlineForm from './FhInlineForm.vue'
import FhModal from './FhModal.vue'
import { fhToast } from './fhToast'

const props = defineProps<{ monthId: string }>()
const emit = defineEmits<{ (e: 'open-invoice', invoiceId: string): void }>()

const store = useDashboard()
const { state } = storeToRefs(store)

// ---- Session-only expand/collapse state (not persisted) ----
const expandedCats = reactive(new Set<string>())
const expandedVendors = reactive(new Set<string>())
// Which buckets currently have their inline "+ Add item" form open.
const inlineFormOpen = reactive(new Set<string>())

interface ItemRow {
  id: string
  date: string
  vendor: string
  amount: number
  currency?: string
  _payoutId?: string
  _refundId?: string
  _invoiceId?: string | null
  _invoiceNumber?: string | null
}
interface VendorRow {
  vendor: string
  total: number
  count: number
  expenses: ItemRow[]
  _isLegacy?: boolean
}
interface BucketView {
  def: BucketDef
  items: VendorRow[]
  total: number
  pctOfRev: number
  isOpen: boolean
}

const buckets = computed(() => fhAllBuckets())

const revTotal = computed(() => {
  const entries = (state.value.revenueEntries || []).filter((e) => e.month === props.monthId)
  if (entries.length) return entries.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return state.value.months[props.monthId]?.revenue || 0
})

const bucketViews = computed<BucketView[]>(() => {
  const monthId = props.monthId
  const monthExpenses = expensesForMonth(monthId)
  const monthData: any = state.value.months[monthId] || {}
  const byCategory: Record<string, any[]> = {}
  monthExpenses.forEach((e) => {
    ;(byCategory[e.category] = byCategory[e.category] || []).push(e)
  })

  return buckets.value.map((b) => {
    let items: VendorRow[] = []
    let total = 0
    if (b.kind === 'team') {
      const payouts = (state.value.teamPayouts || []).filter((p) => p.month === monthId)
      if (payouts.length) {
        const byMember: Record<string, VendorRow & { _payouts: any[] }> = {}
        payouts.forEach((p) => {
          const m = state.value.team.find((t) => t.id === p.memberId)
          const name = (m?.name || 'Unknown') + (p.type === 'commission' ? ' · commission' : ' · salary')
          const entry = byMember[name] || (byMember[name] = { vendor: name, total: 0, count: 0, expenses: [], _payouts: [] })
          entry.total += Number(p.amount) || 0
          entry.count++
          entry._payouts.push(p)
          entry.expenses.push({
            id: p.id, date: p.date, vendor: name, amount: p.amount,
            _payoutId: p.id, _invoiceId: p.invoiceId || null, _invoiceNumber: p.invoiceNumber || null,
          })
        })
        items = Object.values(byMember).sort((a, b2) => b2.total - a.total)
        total = items.reduce((s, v) => s + v.total, 0)
      } else {
        const sal = monthData.salariesTotal || 0
        const com = monthData.commissionsTotal || 0
        if (sal > 0) items.push({ vendor: 'Salaries (team total)', total: sal, count: 1, expenses: [] })
        if (com > 0) items.push({ vendor: 'Commissions (team total)', total: com, count: 1, expenses: [] })
        total = sal + com
      }
    } else if (b.kind === 'refund') {
      const monthRefunds = (state.value.refunds || []).filter((r) => r.month === monthId)
      const grouped: Record<string, VendorRow> = {}
      monthRefunds.forEach((r) => {
        const key = r.recipient || '—'
        const g = grouped[key] || (grouped[key] = { vendor: key, total: 0, count: 0, expenses: [] })
        g.total += Number(r.amount) || 0
        g.count++
        g.expenses.push({ id: r.id, date: r.date || `${monthId}-01`, vendor: key, amount: r.amount, currency: (r as any).currency, _refundId: r.id })
      })
      items = Object.values(grouped).sort((a, b2) => b2.total - a.total)
      total = items.reduce((s, v) => s + v.total, 0)
    } else {
      const cat = b.categoryMap || b.name
      const expenseList = byCategory[cat] || []
      const vendors: Record<string, VendorRow> = {}
      expenseList.forEach((e) => {
        const v = vendors[e.vendor] || (vendors[e.vendor] = { vendor: e.vendor, total: 0, count: 0, expenses: [] })
        v.total += gbpAmount(e)
        v.count++
        v.expenses.push(e)
      })
      items = Object.values(vendors).sort((a, b2) => b2.total - a.total)
      total = items.reduce((s, v) => s + v.total, 0)
      if (!items.length && b.fallbackMonthField) {
        const legacyAmt = Number(monthData[b.fallbackMonthField]) || 0
        if (legacyAmt > 0) {
          total = legacyAmt
          items.push({ vendor: 'Carryover (from monthly total)', total: legacyAmt, count: 1, expenses: [], _isLegacy: true })
        }
      }
    }
    const pctOfRev = revTotal.value > 0 ? (total / revTotal.value) * 100 : 0
    return { def: b, items, total, pctOfRev, isOpen: expandedCats.has(b.id) }
  })
})

// ---- Helpers for the template ----
function itemCount(bv: BucketView) {
  return bv.items.reduce((s, v) => s + v.count, 0)
}
function lastDate(v: VendorRow): string {
  if (!v.expenses.length) return '—'
  const sorted = v.expenses.slice().sort((a, b) => b.date.localeCompare(a.date))
  return fmtDate(sorted[0].date)
}
function sortedItems(v: VendorRow): ItemRow[] {
  return v.expenses.slice().sort((a, b) => b.date.localeCompare(a.date))
}
function vendorKey(bv: BucketView, v: VendorRow) {
  return bv.def.id + '|' + v.vendor
}
function isVendorExpanded(bv: BucketView, v: VendorRow) {
  return expandedVendors.has(vendorKey(bv, v))
}
function fxTitle(e: ItemRow): string | undefined {
  const cur = e.currency || 'GBP'
  if (cur === 'GBP') return undefined
  return `${moneyIn(e.amount, cur)} → ${money(gbpAmount({ amount: e.amount, currency: cur as Currency }))} (auto-converted via 1£ = ${fxRateFor(cur)} ${cur})`
}

// ---- Toggles ----
function toggleBucket(bv: BucketView) {
  if (expandedCats.has(bv.def.id)) expandedCats.delete(bv.def.id)
  else expandedCats.add(bv.def.id)
}
function toggleVendor(bv: BucketView, v: VendorRow) {
  const key = vendorKey(bv, v)
  if (expandedVendors.has(key)) expandedVendors.delete(key)
  else expandedVendors.add(key)
}

// ---- Recalc team totals from payouts ----
function fhRecalcTeamTotals(monthId: string) {
  const payouts = (state.value.teamPayouts || []).filter((p) => p.month === monthId)
  if (!payouts.length) return
  const sal = payouts.filter((p) => p.type === 'salary').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const com = payouts.filter((p) => p.type === 'commission').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  if (state.value.months[monthId]) {
    state.value.months[monthId].salariesTotal = sal
    state.value.months[monthId].commissionsTotal = com
  }
}

function ensureMonth(month: string) {
  if (!state.value.months[month]) {
    state.value.months[month] = {
      revenue: 0, merchantFees: 0, salariesTotal: 0, commissionsTotal: 0,
      referralPayoutsTotal: 0, refundsTotal: 0, founderComp: 0, taxPct: 15,
      newClients: 0, activeClients: 0, churnedClients: 0,
    }
  }
}

// ---- Inline-edit on item rows ----
function updateItem(e: ItemRow, field: 'amount' | 'date' | 'vendor' | 'currency', value: string) {
  const id = e.id
  const isPayout = !!e._payoutId
  const isRefund = (state.value.refunds || []).some((r) => r.id === id)
  if (isPayout) {
    const p = state.value.teamPayouts.find((x) => x.id === id)
    if (!p) return
    if (field === 'amount') p.amount = parseFloat(value) || 0
    else if (field === 'date') p.date = value
    fhRecalcTeamTotals(props.monthId)
  } else if (isRefund) {
    const r = state.value.refunds.find((x) => x.id === id)
    if (!r) return
    if (field === 'amount') r.amount = parseFloat(value) || 0
    else if (field === 'date') r.date = value
    else if (field === 'vendor') r.recipient = value
    else if (field === 'currency') (r as any).currency = value
  } else {
    const ex = state.value.expenses.find((x) => x.id === id)
    if (!ex) return
    if (field === 'amount') ex.amount = parseFloat(value) || 0
    else if (field === 'date') {
      ex.date = value
      ex.month = monthOf(value)
    } else if (field === 'vendor') ex.vendor = value
    else if (field === 'currency') ex.currency = value as Currency
  }
}

function delItem(e: ItemRow) {
  const id = e.id
  const isPayout = (state.value.teamPayouts || []).some((p) => p.id === id)
  const isRefund = (state.value.refunds || []).some((r) => r.id === id)
  if (isPayout) {
    state.value.teamPayouts = state.value.teamPayouts.filter((p) => p.id !== id)
    fhRecalcTeamTotals(props.monthId)
  } else if (isRefund) {
    state.value.refunds = state.value.refunds.filter((r) => r.id !== id)
  } else {
    state.value.expenses = state.value.expenses.filter((x) => x.id !== id)
  }
}

// ---- + Add another charge for same vendor ----
function addCharge(bv: BucketView, v: VendorRow) {
  const last = v.expenses[0]?.amount || 0
  const bucket = bv.def
  const category = bucket.categoryMap || bucket.name
  const date = isoDate(new Date())
  const month = monthOf(date)
  ensureMonth(month)
  if (bucket.kind === 'refund') {
    state.value.refunds = state.value.refunds || []
    state.value.refunds.push({ id: uid(), date, month, recipient: v.vendor, amount: last } as any)
  } else {
    state.value.expenses.push({ id: uid(), date, vendor: v.vendor, category, amount: last, month } as any)
  }
  nextTick(() => {
    const all = document.querySelectorAll(
      `[data-bucket-id="${bucket.id}"] .fh-vendor-row[data-vendor="${v.vendor}"] .it.editable .it-amount`,
    )
    if (all.length) {
      const el = all[0] as HTMLInputElement
      el.focus()
      el.select()
    }
  })
}

// ---- 📋 Task shortcut ----
function addTask(e: ItemRow) {
  const isPayout = !!e._payoutId
  const vendor = e.vendor
  const amount = Number(e.amount) || 0
  const date = e.date
  const linkedVendor = state.value.vendors.find((v) => v.name.toLowerCase() === vendor.toLowerCase())
  state.value.tasks = state.value.tasks || []
  state.value.tasks.push({
    id: uid(),
    title: `Review ${vendor} — ${money(amount)}${date ? ` on ${fmtDate(date)}` : ''}`,
    status: 'todo',
    linkedVendorId: linkedVendor?.id || null,
    action: isPayout ? 'review-payout' : 'review',
    notes: `Auto-added from Finance hub${isPayout ? ' (team payout)' : ''}.`,
    createdAt: isoDate(new Date()),
  })
  fhToast(`Task added: Review ${vendor} ${money(amount)}`)
}

function openInvoice(e: ItemRow) {
  if (e._invoiceId) emit('open-invoice', e._invoiceId)
}

// ---- Team picker (chips) ----
function pickerChips(monthId: string) {
  const active = (state.value.team || []).filter((t) => t.active)
  const monthPayouts = (state.value.teamPayouts || []).filter((p) => p.month === monthId)
  const alreadyAdded = new Set(monthPayouts.map((p) => p.memberId))
  return active
    .filter((t) => !alreadyAdded.has(t.id))
    .map((t) => ({
      id: t.id,
      sym: t.payType === 'commission' ? '💰' : '🏷',
      name: t.name,
      amt: Number(t.amount) || 0,
    }))
}
function addPayoutFor(memberId: string) {
  const m = (state.value.team || []).find((t) => t.id === memberId)
  if (!m) return
  ensureMonth(props.monthId)
  state.value.teamPayouts.push({
    id: uid(), memberId,
    month: props.monthId, date: isoDate(new Date()),
    amount: Number(m.amount) || 0,
    type: m.payType === 'commission' ? 'commission' : 'salary',
    notes: '',
  })
  fhRecalcTeamTotals(props.monthId)
}

// ---- Inline + Add item form toggle ----
function toggleInlineForm(bv: BucketView) {
  if (inlineFormOpen.has(bv.def.id)) inlineFormOpen.delete(bv.def.id)
  else inlineFormOpen.add(bv.def.id)
}

// ---- Add bucket modal ----
const showBucketModal = ref(false)
const bkName = ref('')
const bkIcon = ref('')
const bkColor = ref('#9aa0a6')
function openBucketModal() {
  bkName.value = ''
  bkIcon.value = ''
  bkColor.value = '#9aa0a6'
  showBucketModal.value = true
}
function saveBucket() {
  const name = bkName.value.trim()
  if (!name) {
    alert('Name required')
    return
  }
  const icon = bkIcon.value.trim() || '•'
  const color = bkColor.value || '#9aa0a6'
  state.value.customBuckets.push({ id: 'cb-' + uid(), name, icon, color, kind: 'expense', categoryMap: name })
  showBucketModal.value = false
}

defineExpose({ openBucketModal })
</script>

<template>
  <div>
    <div
      v-for="bv in bucketViews"
      :key="bv.def.id"
      class="fh-bucket"
      :class="{ open: bv.isOpen }"
      :data-bucket-id="bv.def.id"
      :style="{ '--bucket-color': bv.def.color }"
    >
      <div class="fh-bucket-head" @click="toggleBucket(bv)">
        <div class="name"><span class="icon">{{ bv.def.icon || '•' }}</span>{{ bv.def.name }}</div>
        <div class="meta">
          {{ bv.items.length }} {{ bv.def.kind === 'team' ? 'line' : 'vendor' }}{{ bv.items.length === 1 ? '' : 's' }}<template v-if="bv.def.kind !== 'team'"> · {{ itemCount(bv) }} item{{ itemCount(bv) === 1 ? '' : 's' }}</template>
        </div>
        <div class="total">{{ money(bv.total) }}</div>
        <span class="pct-of-rev" title="Share of this month's revenue">{{ bv.pctOfRev.toFixed(1) }}% of rev</span>
        <span class="caret">›</span>
      </div>
      <div class="fh-bucket-body">
        <div class="fh-bucket-bar"><div class="fill" :style="{ width: Math.min(100, bv.pctOfRev * 3).toFixed(1) + '%' }"></div></div>

        <div v-if="bv.items.length" class="fh-vendor-rows">
          <div
            v-for="v in bv.items"
            :key="v.vendor"
            class="fh-vendor-row"
            :class="{ expanded: isVendorExpanded(bv, v) }"
            :data-vendor="v.vendor"
          >
            <div class="v-name">{{ v.vendor }}</div>
            <div class="v-count">{{ v.count }}× · {{ lastDate(v) }}</div>
            <div class="v-total">{{ money(v.total) }}</div>
            <div class="v-pct">{{ (bv.total > 0 ? (v.total / bv.total) * 100 : 0).toFixed(1) }}% of bucket</div>
            <button v-if="v.expenses.length" class="v-items" data-act="toggle-items" title="Show items" @click.stop="toggleVendor(bv, v)">›</button>
            <span v-else></span>

            <div v-if="v.expenses.length" class="v-items-list">
              <div
                v-for="e in sortedItems(v)"
                :key="e.id"
                class="it editable"
                :data-expense-id="e.id"
                :data-payout="e._payoutId ? '1' : undefined"
              >
                <input type="date" class="it-date" :value="e.date" @input="updateItem(e, 'date', ($event.target as HTMLInputElement).value)" />
                <!-- Vendor name commits on blur/change (not per keystroke):
                     rows are grouped by vendor name, so live edits would resort
                     the list and steal focus mid-typing. Legacy re-rendered the
                     vendor field on blur for the same reason. -->
                <input type="text" class="it-vendor" :value="e.vendor" @change="updateItem(e, 'vendor', ($event.target as HTMLInputElement).value)" />
                <input type="number" step="0.01" min="0" class="it-amount" :value="e.amount" @input="updateItem(e, 'amount', ($event.target as HTMLInputElement).value)" />
                <select class="it-currency" :title="fxTitle(e) || 'Currency this charge was paid in'" :value="e.currency || 'GBP'" @change="updateItem(e, 'currency', ($event.target as HTMLSelectElement).value)">
                  <option value="GBP">£</option>
                  <option value="USD">$</option>
                  <option value="EUR">€</option>
                </select>
                <button
                  v-if="e._invoiceNumber"
                  type="button"
                  class="it-invoice-link"
                  :title="`Open invoice #${e._invoiceNumber}`"
                  @click.stop="openInvoice(e)"
                >📄 #{{ e._invoiceNumber }}</button>
                <button class="it-task" title="Create a task linked to this item" @click.stop="addTask(e)">📋</button>
                <button class="it-del" title="Delete" @click.stop="delItem(e)">×</button>
              </div>
              <button
                v-if="bv.def.kind !== 'team'"
                class="it-add-charge"
                :data-bucket-id="bv.def.id"
                :data-vendor="v.vendor"
                @click.stop="addCharge(bv, v)"
              >+ Add another {{ bv.def.kind === 'refund' ? 'refund' : 'charge' }} {{ bv.def.kind === 'refund' ? 'to' : 'for' }} {{ v.vendor }}</button>
            </div>
          </div>
        </div>
        <div v-else class="fh-bucket-empty">No items yet for {{ bv.def.name }} in {{ fmtMonth(monthId) }}.</div>

        <!-- Team picker -->
        <div v-if="bv.def.kind === 'team'" class="fh-team-picker">
          <span class="lbl">Quick add</span>
          <template v-if="pickerChips(monthId).length">
            <button
              v-for="ch in pickerChips(monthId)"
              :key="ch.id"
              type="button"
              class="chip"
              @click.stop="addPayoutFor(ch.id)"
            >{{ ch.sym }} {{ ch.name }}<span v-if="ch.amt > 0" class="amt">{{ money(ch.amt) }}</span></button>
          </template>
          <span v-else style="color: var(--text-tertiary); font-size: 12px; font-style: italic">All active team members already logged this month.</span>
        </div>

        <!-- Add item (expense / refund buckets) -->
        <template v-else>
          <button class="fh-bucket-add" @click.stop="toggleInlineForm(bv)">
            {{ bv.def.kind === 'refund' ? '+ Add refund' : `+ Add item to ${bv.def.name}` }}
          </button>
          <div class="fh-inline-form-host">
            <FhInlineForm
              v-if="inlineFormOpen.has(bv.def.id)"
              :month-id="monthId"
              :bucket="bv.def"
              @close="inlineFormOpen.delete(bv.def.id)"
              @saved="inlineFormOpen.delete(bv.def.id)"
            />
          </div>
        </template>
      </div>
    </div>

    <FhModal :open="showBucketModal" title="Add a custom bucket" @close="showBucketModal = false">
      <label>Bucket name</label>
      <input v-model="bkName" type="text" placeholder="e.g. Office, Travel, Tools…" />
      <div class="grid-2">
        <div>
          <label>Icon (emoji)</label>
          <input v-model="bkIcon" type="text" placeholder="🗂" />
        </div>
        <div>
          <label>Colour</label>
          <input v-model="bkColor" type="color" />
        </div>
      </div>
      <div class="fh-modal-foot">
        <button type="button" class="cancel" @click="showBucketModal = false">Cancel</button>
        <button type="button" class="primary" @click="saveBucket">+ Add bucket</button>
      </div>
    </FhModal>
  </div>
</template>
