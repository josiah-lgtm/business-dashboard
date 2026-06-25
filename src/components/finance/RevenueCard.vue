<script setup lang="ts">
// Revenue card — ports legacy renderFhRevenueCard + fhRevenueForMonth +
// fhOpenAddRevenueModal. Headline KPI tiles + inline-editable revenue entries,
// incl. the synthetic "Carryover" row materialised from months[m].revenue.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { calcMonth } from '@/lib/calc'
import { money } from '@/lib/money'
import { uid, isoDate, monthOf, fmtMonth } from '@/lib/format'
import type { RevenueEntry } from '@/types'
import FhModal from './FhModal.vue'

const props = defineProps<{ monthId: string }>()

const store = useDashboard()
const { state } = storeToRefs(store)

// fhRevenueForMonth — real entries when present, otherwise a synthetic legacy row.
const rev = computed(() => {
  const m = props.monthId
  const entries = (state.value.revenueEntries || []).filter((e) => e.month === m)
  if (entries.length) {
    const total = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    return {
      total,
      entries: entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      fromEntries: true,
    }
  }
  const legacyAmount = state.value.months[m]?.revenue || 0
  if (legacyAmount > 0) {
    return {
      total: legacyAmount,
      entries: [{ id: '__legacy__', month: m, date: m + '-01', amount: legacyAmount, source: 'Carryover', notes: '', _legacy: true } as RevenueEntry],
      fromEntries: false,
    }
  }
  return { total: 0, entries: [] as RevenueEntry[], fromEntries: false }
})

const c = computed(() => calcMonth(props.monthId) || ({} as any))
const grossExpenses = computed(() => (c.value.marketingCosts || 0) + (c.value.deliveryCosts || 0) + (c.value.overheadCosts || 0))
const profit = computed(() => (rev.value.total || 0) - grossExpenses.value)
const profitClass = computed(() => (profit.value >= 0 ? 'good' : 'bad'))
const expensePctOfRev = computed(() => (rev.value.total > 0 ? ((grossExpenses.value / rev.value.total) * 100).toFixed(1) + '%' : '—'))
const marginPct = computed(() => (rev.value.total > 0 ? ((profit.value / rev.value.total) * 100).toFixed(1) + '%' : '—'))

function syncMonthRevenue(month: string) {
  const sum = (state.value.revenueEntries || [])
    .filter((e) => e.month === month)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  if (state.value.months[month]) state.value.months[month].revenue = sum
}

// Materialise the synthetic Carryover row into state.revenueEntries on first
// edit, returning the now-real id so the edit targets the right record.
function materialiseLegacy(entry: RevenueEntry): string {
  if (!entry._legacy) return entry.id
  const m = props.monthId
  const legacyAmount = state.value.months[m]?.revenue || 0
  const newId = uid()
  state.value.revenueEntries = state.value.revenueEntries || []
  state.value.revenueEntries.push({
    id: newId,
    month: m,
    date: entry.date || m + '-01',
    amount: Number(entry.amount) || legacyAmount,
    source: entry.source || 'Carryover',
    notes: '',
  })
  return newId
}

function updateField(entry: RevenueEntry, field: 'amount' | 'date' | 'source', value: string) {
  const id = materialiseLegacy(entry)
  const real = state.value.revenueEntries.find((x) => x.id === id)
  if (!real) return
  if (field === 'amount') real.amount = parseFloat(value) || 0
  else if (field === 'date') {
    real.date = value
    real.month = monthOf(value)
  } else if (field === 'source') real.source = value
  syncMonthRevenue(props.monthId)
}

function delEntry(entry: RevenueEntry) {
  if (entry._legacy) {
    if (state.value.months[props.monthId]) state.value.months[props.monthId].revenue = 0
  } else {
    state.value.revenueEntries = state.value.revenueEntries.filter((x) => x.id !== entry.id)
    syncMonthRevenue(props.monthId)
  }
}

// ---- Add revenue entry modal ----
const showModal = ref(false)
const mDate = ref(isoDate(new Date()))
const mAmount = ref<number | null>(null)
const mSource = ref('')
const mNotes = ref('')

function openModal() {
  mDate.value = isoDate(new Date())
  mAmount.value = null
  mSource.value = ''
  mNotes.value = ''
  showModal.value = true
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

function saveModal() {
  const amt = Number(mAmount.value)
  if (!mDate.value || !isFinite(amt) || amt <= 0) {
    alert('Date + amount are required')
    return
  }
  const month = monthOf(mDate.value)
  ensureMonth(month)
  // On the FIRST entry for a month that already has a single-number legacy
  // revenue figure, preserve it as a Carryover entry so nothing is lost.
  const priorEntries = state.value.revenueEntries.filter((e) => e.month === month)
  const legacyAmount = state.value.months[month]?.revenue || 0
  if (priorEntries.length === 0 && legacyAmount > 0) {
    state.value.revenueEntries.push({
      id: uid(), month, date: month + '-01', amount: legacyAmount,
      source: 'Carryover', notes: 'Imported from previous single-number monthly revenue',
    })
  }
  state.value.revenueEntries.push({ id: uid(), month, date: mDate.value, amount: amt, source: mSource.value.trim(), notes: mNotes.value.trim() })
  const monthEntries = state.value.revenueEntries.filter((e) => e.month === month)
  state.value.months[month].revenue = monthEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  showModal.value = false
}
</script>

<template>
  <div class="fh-headline">
    <div class="fh-h-title">{{ fmtMonth(monthId) }} · Financial summary</div>
    <div class="fh-h-stats">
      <div class="fh-stat is-revenue">
        <div class="fh-s-lbl">Revenue</div>
        <div class="fh-s-amount">{{ money(rev.total) }}</div>
        <div class="fh-s-sub">{{ rev.fromEntries ? `${rev.entries.length} ${rev.entries.length === 1 ? 'entry' : 'entries'}` : 'monthly total' }}</div>
      </div>
      <div class="fh-stat is-expenses">
        <div class="fh-s-lbl">Expenses</div>
        <div class="fh-s-amount">{{ money(grossExpenses) }}</div>
        <div class="fh-s-sub">{{ expensePctOfRev }} of revenue</div>
      </div>
      <div class="fh-stat is-profit" :class="profitClass">
        <div class="fh-s-lbl">Net profit</div>
        <div class="fh-s-amount">{{ money(profit) }}</div>
        <div class="fh-s-sub">{{ marginPct }} margin</div>
      </div>
    </div>
    <div class="fh-entries-section">
      <div class="lbl">Revenue entries this month</div>
      <div v-if="rev.entries.length" class="fh-entries">
        <!-- Index key (not e.id) so the synthetic carryover row keeps its DOM
             nodes when it materialises into a real entry mid-edit — preserving
             input focus, matching the legacy in-place dataset rewrite. -->
        <div v-for="(e, i) in rev.entries" :key="i" class="entry editable" :class="{ 'is-legacy': e._legacy }">
          <input
            type="date"
            class="re-date"
            :value="e.date || ''"
            title="Date"
            @input="updateField(e, 'date', ($event.target as HTMLInputElement).value)"
          />
          <input
            type="text"
            class="re-source"
            :value="e.source || ''"
            placeholder="Source / client"
            title="Source"
            @input="updateField(e, 'source', ($event.target as HTMLInputElement).value)"
          />
          <div class="re-amt-wrap">
            <span class="re-amt-sym">£</span>
            <input
              type="number"
              step="0.01"
              min="0"
              class="re-amount"
              :value="e.amount || 0"
              title="Amount"
              @input="updateField(e, 'amount', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <button class="del" title="Delete entry" @click="delEntry(e)">×</button>
        </div>
      </div>
      <div v-else style="text-align: center; color: var(--text-tertiary); font-size: 12.5px; margin-bottom: 12px; font-style: italic">
        {{ rev.fromEntries ? 'No entries yet' : 'No weekly entries yet — using the single monthly figure' }}
      </div>
      <button class="add-entry" @click="openModal">+ Add revenue entry</button>
    </div>
  </div>

  <FhModal :open="showModal" title="Add revenue entry" @close="showModal = false">
    <label>Date</label>
    <input v-model="mDate" type="date" />
    <div class="grid-2">
      <div>
        <label>Amount (£)</label>
        <input v-model.number="mAmount" type="number" step="0.01" min="0" placeholder="0.00" />
      </div>
      <div>
        <label>Source / client</label>
        <input v-model="mSource" type="text" placeholder="e.g. Client A, Affiliate, etc." />
      </div>
    </div>
    <label>Notes (optional)</label>
    <textarea v-model="mNotes" rows="2" placeholder="Anything else worth remembering"></textarea>
    <div class="fh-modal-foot">
      <button type="button" class="cancel" @click="showModal = false">Cancel</button>
      <button type="button" class="primary" @click="saveModal">+ Add entry</button>
    </div>
  </FhModal>
</template>
