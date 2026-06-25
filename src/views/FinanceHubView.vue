<script setup lang="ts">
// Finance hub — ports legacy data-view="expenses" (renderExpenses /
// renderFinanceHub). Month selector + revenue card + expense/team/refund
// buckets + footer actions + collapsible team roster + vendor library.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useDashboard } from '@/stores/dashboard'
import { sortedMonthIds, fmtMonth, monthOf } from '@/lib/format'
import RevenueCard from '@/components/finance/RevenueCard.vue'
import ExpenseBuckets from '@/components/finance/ExpenseBuckets.vue'
import TeamRoster from '@/components/finance/TeamRoster.vue'
import VendorLibrary from '@/components/finance/VendorLibrary.vue'

const store = useDashboard()
const { state } = storeToRefs(store)
const router = useRouter()

// Newest-first month list, matching the legacy fh-month select order.
const monthIds = computed(() => sortedMonthIds().slice().reverse())
const monthId = computed(() => state.value.meta.activeMonth)

function onMonthChange(e: Event) {
  store.setActiveMonth((e.target as HTMLSelectElement).value)
}

// Refs into child components so the footer buttons can drive them
// (mirrors the legacy id-targeted buttons).
const bucketsRef = ref<InstanceType<typeof ExpenseBuckets> | null>(null)
const teamRef = ref<InstanceType<typeof TeamRoster> | null>(null)
const vendorLibRef = ref<InstanceType<typeof VendorLibrary> | null>(null)
const showVendorLib = ref(false)

const vendorCount = computed(() => state.value.vendors.length)
const teamCount = computed(() => state.value.team.length)

function addBucket() {
  bucketsRef.value?.openBucketModal()
}
function toggleVendorLib() {
  showVendorLib.value = !showVendorLib.value
}

function exportCsv() {
  const filterMonth = monthId.value || ''
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

// Open a payout's linked invoice → jump to the Invoices view, Inbound tab.
function openInvoice(_invoiceId: string) {
  state.value.meta.invoicesTab = 'inbound'
  router.push('/invoices')
}
</script>

<template>
  <section class="panel active" data-view="expenses">
    <div class="panel-header">
      <div>
        <h2>Finance hub</h2>
        <div class="sub">
          Revenue, team payouts, refunds, and expense buckets for the active month — one unified view. Each bucket shows total + share of revenue.
        </div>
      </div>
      <div class="actions">
        <select class="small" :value="monthId" @change="onMonthChange">
          <option v-for="id in monthIds" :key="id" :value="id">{{ fmtMonth(id) }}</option>
        </select>
      </div>
    </div>

    <!-- Revenue card -->
    <RevenueCard :month-id="monthId" />

    <!-- Bucket cards -->
    <ExpenseBuckets ref="bucketsRef" :month-id="monthId" @open-invoice="openInvoice" />

    <!-- Add bucket + vendor library + export -->
    <div class="fh-footer-actions">
      <button class="ghost" @click="addBucket">+ Add bucket</button>
      <button class="ghost" @click="toggleVendorLib">Vendor library (<span>{{ vendorCount }}</span>)</button>
      <button class="ghost" @click="exportCsv">Export CSV</button>
    </div>

    <!-- Team roster -->
    <details class="card" style="padding: 0">
      <summary style="padding: 16px 18px; color: var(--text); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px">
        Team roster + per-person pay (<span>{{ teamCount }}</span>)
      </summary>
      <div style="padding: 0 18px 18px">
        <div style="margin-bottom: 10px">
          <button class="small" @click="teamRef?.addPerson()">+ Add person</button>
        </div>
        <TeamRoster ref="teamRef" />
      </div>
    </details>

    <!-- Vendor library (toggled by footer button) -->
    <details v-show="showVendorLib" class="card" open style="padding: 0">
      <summary style="padding: 16px 18px; color: var(--text); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px">
        Vendor library
      </summary>
      <div style="padding: 0 18px 18px">
        <VendorLibrary ref="vendorLibRef" />
      </div>
    </details>
  </section>
</template>
