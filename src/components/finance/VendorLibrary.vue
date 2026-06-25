<script setup lang="ts">
// Vendor library — ports legacy renderVendors. Filters (category / recurring /
// search), inline-editable rows, occurrence + last-seen columns, add + delete.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { CATEGORY_ORDER } from '@/lib/buckets'
import { uid, fmtDate } from '@/lib/format'
import type { Vendor } from '@/types'

const store = useDashboard()
const { state } = storeToRefs(store)

const filterCat = ref('')
const filterRecurring = ref('')
const filterSearch = ref('')

const occ = computed(() => {
  const o: Record<string, number> = {}
  state.value.expenses.forEach((e) => {
    const k = e.vendor + '__' + e.category
    o[k] = (o[k] || 0) + 1
  })
  return o
})
const lastSeen = computed(() => {
  const ls: Record<string, string> = {}
  state.value.expenses.forEach((e) => {
    const k = e.vendor + '__' + e.category
    if (!ls[k] || e.date > ls[k]) ls[k] = e.date
  })
  return ls
})

const rows = computed(() => {
  let r = state.value.vendors.slice()
  if (filterCat.value) r = r.filter((v) => v.category === filterCat.value)
  if (filterRecurring.value !== '') r = r.filter((v) => v.recurring === (filterRecurring.value === '1'))
  const search = filterSearch.value.trim().toLowerCase()
  if (search) r = r.filter((v) => v.name.toLowerCase().includes(search))
  r.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return r
})

function keyOf(v: Vendor) {
  return v.name + '__' + v.category
}
function setField(v: Vendor, field: 'name' | 'category', value: string) {
  v[field] = value
}
function setTypical(v: Vendor, value: string) {
  v.typicalAmount = parseFloat(value) || 0
}
function setRecurring(v: Vendor, checked: boolean) {
  v.recurring = checked
}
function delVendor(v: Vendor) {
  if (!confirm(`Delete vendor "${v.name}"?`)) return
  state.value.vendors = state.value.vendors.filter((x) => x.id !== v.id)
}
function addVendor() {
  const name = prompt('Vendor name:')
  if (!name || !name.trim()) return
  state.value.vendors.push({
    id: uid(),
    name: name.trim(),
    category: filterCat.value || 'Base Software',
    typicalAmount: 0,
    recurring: false,
  })
}

defineExpose({ addVendor })
</script>

<template>
  <div>
    <div class="filters">
      <div>
        <label>Category</label>
        <select v-model="filterCat">
          <option value="">All</option>
          <option>Base Software</option>
          <option>LinkedIn Channel</option>
          <option>Email Channel</option>
          <option>SMS</option>
          <option>One off</option>
          <option>Founder comp</option>
          <option>Referral payouts</option>
          <option>Merchant fees</option>
        </select>
      </div>
      <div>
        <label>Show</label>
        <select v-model="filterRecurring">
          <option value="">All</option>
          <option value="1">Recurring only</option>
          <option value="0">Non-recurring only</option>
        </select>
      </div>
      <div class="grow">
        <label>Search</label>
        <input v-model="filterSearch" type="text" placeholder="type to filter" />
      </div>
      <div>
        <label>&nbsp;</label>
        <button class="small" @click="addVendor">+ Add vendor</button>
      </div>
    </div>

    <div v-if="!rows.length" class="empty">
      <h3>No vendors</h3>
      <p>Add one above, or add an expense and it'll appear here.</p>
    </div>
    <table v-else>
      <thead>
        <tr>
          <th>Vendor</th>
          <th>Category</th>
          <th class="num">Typical £</th>
          <th class="num">Occurrences</th>
          <th>Last seen</th>
          <th>Recurring</th>
          <th class="actions"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in rows" :key="v.id" :data-id="v.id">
          <td><input type="text" :value="v.name" style="padding: 4px 6px; font-size: 13px" @change="setField(v, 'name', ($event.target as HTMLInputElement).value)" /></td>
          <td>
            <select :value="v.category" style="padding: 4px 6px; font-size: 13px" @change="setField(v, 'category', ($event.target as HTMLSelectElement).value)">
              <option v-for="c in CATEGORY_ORDER" :key="c" :value="c">{{ c }}</option>
            </select>
          </td>
          <td class="num"><input type="number" step="0.01" min="0" :value="v.typicalAmount" style="padding: 4px 6px; font-size: 13px; width: 90px; text-align: right" @change="setTypical(v, ($event.target as HTMLInputElement).value)" /></td>
          <td class="num">{{ occ[keyOf(v)] || 0 }}</td>
          <td>{{ fmtDate(lastSeen[keyOf(v)]) }}</td>
          <td><input type="checkbox" :checked="v.recurring" style="width: auto" @change="setRecurring(v, ($event.target as HTMLInputElement).checked)" /></td>
          <td class="actions"><button class="small ghost" @click="delVendor(v)">Delete</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
