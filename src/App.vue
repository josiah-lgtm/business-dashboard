<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { NAV_ITEMS } from '@/router'
import { sortedMonthIds, fmtMonth } from '@/lib/format'
import { fxRateFor, CURRENCY_SYMBOLS } from '@/lib/money'
import { cloudStatus } from '@/lib/cloud'

const store = useDashboard()
const { state, saveStatus, saveDirty } = storeToRefs(store)
const route = useRoute()

const monthIds = computed(() => sortedMonthIds())
const currency = computed(() => state.value.meta.currency || 'GBP')
const fxWrapVisible = computed(() => currency.value !== 'GBP')
const fxSymbol = computed(() => CURRENCY_SYMBOLS[currency.value] || '$')
const fxValue = computed(() => fxRateFor(currency.value))

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
function onFxInput(e: Event) {
  store.setFxRate(parseFloat((e.target as HTMLInputElement).value))
}
function onAddMonth() {
  store.addMonth()
}
</script>

<template>
  <div class="app">
    <!-- Top bar -->
    <div class="topbar">
      <div class="brand">
        <img :src="logoSrc" alt="" />
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
      <div class="control" v-show="fxWrapVisible">
        <label style="margin: 0">1£=</label>
        <input type="number" step="0.01" min="0.1" :value="fxValue" @input="onFxInput" />
        <span style="font-size: 12px; color: var(--text-tertiary)">{{ fxSymbol }}</span>
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
      <RouterView />
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
