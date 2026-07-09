<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { NAV_ITEMS } from '@/router'
import { sortedMonthIds, fmtMonth } from '@/lib/format'
import { fxRateFor, CURRENCY_SYMBOLS, fxUpdatedAt } from '@/lib/money'
import { cloudStatus, cloudRelativeTime } from '@/lib/cloud'
import { cloudFirstLoadPending } from '@/lib/hydration'
import { startProgress, doneProgress } from '@/lib/progress'
import TopProgressBar from '@/components/TopProgressBar.vue'
import ViewSkeleton from '@/components/skeleton/ViewSkeleton.vue'

const store = useDashboard()
const { state, saveStatus, saveDirty } = storeToRefs(store)
const route = useRoute()

// Drive the top progress bar off cloud-sync activity (the one genuinely-async op).
watch(
  () => cloudStatus.value.cls === 'syncing',
  (syncing) => (syncing ? startProgress() : doneProgress()),
  { immediate: true },
)

const monthIds = computed(() => sortedMonthIds())
const currency = computed(() => state.value.meta.currency || 'GBP')
const fxWrapVisible = computed(() => currency.value !== 'GBP')
const fxSymbol = computed(() => CURRENCY_SYMBOLS[currency.value] || '$')
const fxValue = computed(() => fxRateFor(currency.value))
// Rates auto-update server-side; the top bar just shows the live value.
const fxTitle = computed(() => {
  const ts = fxUpdatedAt()
  return ts
    ? `Exchange rate updates automatically — last updated ${cloudRelativeTime(new Date(ts).toISOString())}`
    : 'Exchange rate updates automatically a few times a day'
})

const logoSrc = computed(() => state.value.business?.logoDataUrl || '/logo.png')

const counts = computed(() => ({
  expenses: state.value.expenses.length,
  tasks: state.value.tasks.length,
  invoices: state.value.invoices.length + (state.value.teamInvoices?.length || 0),
}))

function onMonthChange(e: Event) {
  store.setActiveMonth((e.target as HTMLSelectElement).value)
}
function onCurrencyChange(e: Event) {
  store.setCurrency((e.target as HTMLSelectElement).value as any)
}
function onAddMonth() {
  store.addMonth()
}
</script>

<template>
  <div class="app">
    <!-- Cloud-sync / loading progress bar -->
    <TopProgressBar />
    <!-- Top bar -->
    <div class="topbar">
      <div class="brand">
        <img :src="logoSrc" alt="" decoding="async" fetchpriority="high" />
        <h1>Agency Advanta</h1>
      </div>
      <div class="control">
        <label style="margin: 0">Month</label>
        <select :value="state.meta.activeMonth" @change="onMonthChange">
          <option v-for="id in monthIds" :key="id" :value="id">{{ fmtMonth(id) }}</option>
        </select>
      </div>
      <div class="control">
        <label style="margin: 0">View</label>
        <select :value="currency" @change="onCurrencyChange">
          <option value="GBP">£ GBP</option>
          <option value="USD">$ USD</option>
          <option value="EUR">€ EUR</option>
        </select>
      </div>
      <div class="control" v-show="fxWrapVisible" :title="fxTitle">
        <label style="margin: 0">1£=</label>
        <span style="font-variant-numeric: tabular-nums; font-weight: 600">{{ fxSymbol }}{{ fxValue.toFixed(2) }}</span>
        <span style="font-size: 11px; color: var(--text-tertiary)">auto</span>
      </div>
      <span class="save-status" :class="{ dirty: saveDirty }">{{ saveStatus }}</span>
      <span
        v-show="cloudStatus.visible"
        class="cloud-status"
        :class="cloudStatus.cls"
        title="Cloud sync status — Settings → Cloud sync"
        >{{ cloudStatus.text }}</span
      >
      <div class="spacer"></div>
      <button class="small" @click="onAddMonth">+ New Month</button>
    </div>

    <!-- Sidebar nav -->
    <nav class="sidebar">
      <RouterLink
        v-for="item in NAV_ITEMS"
        :key="item.name"
        class="nav-item"
        :class="{ active: route.name === item.name }"
        :to="item.path"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.count" class="num">{{ counts[item.count] }}</span>
      </RouterLink>
    </nav>

    <!-- Main content -->
    <main class="main">
      <!-- Fresh, empty team build: show a skeleton until the first cloud pull
           lands, instead of flashing the "No data" empty states. -->
      <ViewSkeleton v-if="cloudFirstLoadPending" />
      <RouterView v-else v-slot="{ Component }">
        <transition name="view" mode="out-in">
          <component :is="Component" :key="route.name" />
        </transition>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
/* The sidebar nav items are <a> (RouterLink) — keep them styled like the
   legacy <div> nav items. */
.sidebar .nav-item {
  text-decoration: none;
  cursor: pointer;
}
</style>
