<script setup lang="ts">
// Vendor autocomplete — mirrors the legacy inline-form / add-item-modal
// autocomplete. Shows recurring vendors of the bucket category when empty,
// name-matched vendors when typing, plus an "+ Create …" affordance.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { money } from '@/lib/money'

const props = defineProps<{
  modelValue: string
  category: string
  placeholder?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  // emitted when a vendor is picked from the list; carries the typical amount
  (e: 'pick', v: { name: string; typicalAmount: number }): void
}>()

const store = useDashboard()
const { state } = storeToRefs(store)
const open = ref(false)

const pool = computed(() => {
  const q = (props.modelValue || '').trim().toLowerCase()
  if (q) {
    return state.value.vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 10)
  }
  return state.value.vendors
    .filter((v) => v.category === props.category && v.recurring)
    .slice(0, 8)
})

const showAddNew = computed(() => !!(props.modelValue || '').trim())

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  open.value = pool.value.length > 0 || showAddNew.value
}
function onFocus() {
  open.value = pool.value.length > 0 || showAddNew.value
}
function pick(v: { name: string; typicalAmount: number }) {
  emit('update:modelValue', v.name)
  emit('pick', { name: v.name, typicalAmount: v.typicalAmount })
  open.value = false
}
function closeSoon() {
  // Delay so a click on a suggestion registers before we hide the list.
  setTimeout(() => {
    open.value = false
  }, 150)
}
</script>

<template>
  <div class="fh-vendor-search" :class="{ open }">
    <input
      type="text"
      class="vendor-inp"
      :value="modelValue"
      :placeholder="placeholder || 'Search vendors or type a new one…'"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="closeSoon"
    />
    <div class="fh-suggest">
      <div v-for="v in pool" :key="v.id" class="item" @mousedown.prevent="pick(v)">
        <span>{{ v.name }} <span class="cat">{{ v.category }}</span></span>
        <span class="price">{{ v.typicalAmount ? '~' + money(v.typicalAmount) : '' }}</span>
      </div>
      <div v-if="showAddNew" class="add-new" @mousedown.prevent="open = false">
        + Create "{{ modelValue.trim() }}" as a new {{ category }} vendor
      </div>
    </div>
  </div>
</template>
