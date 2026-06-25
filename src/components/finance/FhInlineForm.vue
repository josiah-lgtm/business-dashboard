<script setup lang="ts">
// Inline "+ Add item" form that lives inside a bucket body (no modal).
// Ports legacy renderInlineExpenseForm: vendor autocomplete, amount+currency,
// date, notes — and on save pushes the expense/refund + upserts the vendor.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { uid, isoDate, monthOf } from '@/lib/format'
import { gbpAmount } from '@/lib/money'
import type { BucketDef } from '@/lib/buckets'
import type { Currency } from '@/types'
import FhVendorSearch from './FhVendorSearch.vue'

const props = defineProps<{ monthId: string; bucket: BucketDef }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const store = useDashboard()
const { state } = storeToRefs(store)

const cat = computed(() => props.bucket.categoryMap || props.bucket.name)
const isRefund = computed(() => props.bucket.kind === 'refund')
const isFounder = computed(() => props.bucket.id === 'founder')
const founder = computed(() => (isFounder.value ? (state.value.team || []).find((t) => t.isFounder) : null))

const vendorLabel = computed(() =>
  isRefund.value ? 'Recipient (client)' : isFounder.value ? 'Founder (vendor)' : 'Vendor',
)
const vendorPlaceholder = computed(() =>
  isRefund.value
    ? 'Client name…'
    : isFounder.value
      ? founder.value
        ? `Auto: ${founder.value.name}`
        : 'Set a founder in Team roster first…'
      : 'Search vendors or type a new one…',
)

const vendor = ref(isFounder.value && founder.value ? founder.value.name : '')
const amount = ref<number | null>(null)
const currency = ref<Currency>((state.value.meta.currency as Currency) || 'GBP')
const date = ref(isoDate(new Date()))
const notes = ref('')

function ensureMonth(month: string) {
  if (!state.value.months[month]) {
    state.value.months[month] = {
      revenue: 0, merchantFees: 0, salariesTotal: 0, commissionsTotal: 0,
      referralPayoutsTotal: 0, refundsTotal: 0, founderComp: 0, taxPct: 15,
      newClients: 0, activeClients: 0, churnedClients: 0,
    }
  }
}

function onPick(v: { name: string; typicalAmount: number }) {
  if (v.typicalAmount && !amount.value) amount.value = v.typicalAmount
}

function save() {
  const v = vendor.value.trim()
  const amt = Number(amount.value)
  if (!v || !isFinite(amt) || amt <= 0 || !date.value) {
    alert(isRefund.value ? 'Recipient, amount, and date are required' : 'Vendor, amount, and date are required')
    return
  }
  const month = monthOf(date.value)
  ensureMonth(month)
  if (isRefund.value) {
    state.value.refunds = state.value.refunds || []
    state.value.refunds.push({ id: uid(), date: date.value, month, recipient: v, amount: amt, currency: currency.value, notes: notes.value.trim() } as any)
  } else {
    const c = cat.value
    state.value.expenses.push({ id: uid(), date: date.value, vendor: v, category: c, amount: amt, currency: currency.value, month, notes: notes.value.trim() } as any)
    const existing = state.value.vendors.find((x) => x.name.toLowerCase() === v.toLowerCase() && x.category === c)
    if (existing) {
      const all = state.value.expenses.filter((x) => x.vendor === existing.name && x.category === existing.category)
      existing.typicalAmount = Math.round((all.reduce((s, x) => s + gbpAmount(x), 0) / all.length) * 100) / 100
      if (all.length >= 2) existing.recurring = true
    } else {
      state.value.vendors.push({ id: uid(), name: v, category: c, typicalAmount: gbpAmount({ amount: amt, currency: currency.value }), recurring: false })
    }
  }
  emit('saved')
}
</script>

<template>
  <div class="fh-inline-form">
    <div>
      <label>{{ vendorLabel }}</label>
      <FhVendorSearch v-model="vendor" :category="cat" :placeholder="vendorPlaceholder" @pick="onPick" />
    </div>
    <div>
      <label>Amount</label>
      <div style="display: flex; gap: 6px; align-items: center">
        <input v-model.number="amount" type="number" step="0.01" min="0" placeholder="0.00" style="flex: 1" />
        <select v-model="currency" title="Entry currency — auto-converted to GBP for totals" style="width: 74px; padding: 6px 8px">
          <option value="GBP">£ GBP</option>
          <option value="USD">$ USD</option>
          <option value="EUR">€ EUR</option>
        </select>
      </div>
    </div>
    <div>
      <label>Date</label>
      <input v-model="date" type="date" />
    </div>
    <div class="actions">
      <button type="button" class="cancel" @click="emit('close')">Cancel</button>
      <button type="button" class="save" @click="save">+ Add</button>
    </div>
    <div class="full">
      <label>Notes (optional)</label>
      <textarea v-model="notes" rows="2" :placeholder="isRefund ? 'Why refunded?' : 'Anything else worth tracking'"></textarea>
    </div>
  </div>
</template>
