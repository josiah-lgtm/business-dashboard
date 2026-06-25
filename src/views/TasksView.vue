<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { TASK_STATUSES } from '@/lib/seed'
import { uid, isoDate, fmtDate, catClass } from '@/lib/format'
import type { Task } from '@/types'

const store = useDashboard()
const { state } = storeToRefs(store)

// ---- Kanban board (grouped by status) ----
const columns = computed(() =>
  TASK_STATUSES.map((s) => ({
    id: s.id,
    label: s.label,
    items: state.value.tasks.filter((t) => t.status === s.id),
  })),
)

function vendorFor(t: Task) {
  return t.linkedVendorId ? state.value.vendors.find((v) => v.id === t.linkedVendorId) || null : null
}

function changeStatus(t: Task, e: Event) {
  t.status = (e.target as HTMLSelectElement).value as Task['status']
}

function delTask(id: string) {
  if (!confirm('Delete this task?')) return
  state.value.tasks = state.value.tasks.filter((x) => x.id !== id)
}

// ---- Add-task form ----
const showForm = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)

const fTitle = ref('')
const fStatus = ref<Task['status']>('todo')
const fAction = ref('')
const fNotes = ref('')
const fVendorId = ref('')

const ACTIONS = [
  'Cancel subscription',
  'Renegotiate price',
  'Switch to annual billing',
  'Switch billing card',
  'Review necessity',
  'Pause for 1 month',
  'Audit usage',
  'Other',
]

function openForm() {
  showForm.value = true
  nextTick(() => titleInput.value?.focus())
}

function resetForm() {
  fTitle.value = ''
  fStatus.value = 'todo'
  fAction.value = ''
  fNotes.value = ''
  fVendorId.value = ''
  vendorQuery.value = ''
  acOpen.value = false
}

function cancelForm() {
  showForm.value = false
  resetForm()
}

function submitForm() {
  const title = fTitle.value.trim()
  if (!title) return
  state.value.tasks.push({
    id: uid(),
    title,
    status: fStatus.value,
    linkedVendorId: fVendorId.value || null,
    action: fAction.value,
    notes: fNotes.value.trim(),
    createdAt: isoDate(new Date()),
  })
  resetForm()
  showForm.value = false
}

// ---- Vendor autocomplete (matches legacy setupVendorAutocomplete) ----
const vendorQuery = ref('')
const acOpen = ref(false)
const activeIdx = ref(-1)

const candidates = computed(() => {
  const q = vendorQuery.value.trim().toLowerCase()
  if (!q) {
    return state.value.vendors
      .filter((v) => v.recurring)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12)
  }
  return state.value.vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 12)
})
const showAcHeader = computed(() => !vendorQuery.value.trim())

function onVendorInput() {
  activeIdx.value = -1
  if (!vendorQuery.value.trim()) fVendorId.value = '' // clearing input clears link
  acOpen.value = candidates.value.length > 0
}
function onVendorFocus() {
  acOpen.value = candidates.value.length > 0
}
function onVendorBlur() {
  setTimeout(() => (acOpen.value = false), 150)
}
function pickVendor(i: number) {
  const v = candidates.value[i]
  if (!v) return
  vendorQuery.value = v.name
  fVendorId.value = v.id
  acOpen.value = false
}
function onVendorKeydown(e: KeyboardEvent) {
  if (!candidates.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(activeIdx.value + 1, candidates.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(activeIdx.value - 1, 0)
  } else if (e.key === 'Enter' && activeIdx.value >= 0) {
    e.preventDefault()
    pickVendor(activeIdx.value)
  } else if (e.key === 'Escape') {
    acOpen.value = false
  }
}
</script>

<template>
  <section class="panel active" data-view="tasks">
    <div class="panel-header">
      <div>
        <h2>Tasks</h2>
        <div class="sub">Kanban for expense actions — cancel, renegotiate, switch billing, etc.</div>
      </div>
      <div class="actions">
        <button class="primary" @click="openForm">+ New task</button>
      </div>
    </div>

    <div v-show="showForm" class="card">
      <h3>New task</h3>
      <form class="grid grid-auto" style="align-items: flex-end" @submit.prevent="submitForm">
        <div class="grow" style="flex: 2; min-width: 200px">
          <label>Title</label>
          <input ref="titleInput" v-model="fTitle" type="text" required placeholder="e.g. Cancel Findymail subscription" />
        </div>
        <div>
          <label>Status</label>
          <select v-model="fStatus">
            <option v-for="s in TASK_STATUSES" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="autocomplete">
          <label>Link vendor (optional — type to search)</label>
          <input
            v-model="vendorQuery"
            type="text"
            placeholder="Start typing…"
            autocomplete="off"
            @input="onVendorInput"
            @focus="onVendorFocus"
            @blur="onVendorBlur"
            @keydown="onVendorKeydown"
          />
          <div class="autocomplete-list" :class="{ open: acOpen }">
            <div v-if="showAcHeader" class="ac-header">Recurring vendors</div>
            <div
              v-for="(v, i) in candidates"
              :key="v.id"
              class="item"
              :class="{ active: i === activeIdx }"
              @mousedown.prevent="pickVendor(i)"
            >
              <span>{{ v.name }} <span class="meta">{{ v.category }}</span></span>
            </div>
          </div>
        </div>
        <div>
          <label>Action</label>
          <select v-model="fAction">
            <option value="">— pick —</option>
            <option v-for="a in ACTIONS" :key="a" :value="a">{{ a }}</option>
          </select>
        </div>
        <div style="grid-column: 1 / -1">
          <label>Notes</label>
          <textarea v-model="fNotes" rows="2" placeholder="optional context"></textarea>
        </div>
        <div style="grid-column: 1 / -1; display: flex; gap: 8px">
          <button type="submit" class="primary">Add task</button>
          <button type="button" @click="cancelForm">Cancel</button>
        </div>
      </form>
    </div>

    <div class="kanban">
      <div v-for="col in columns" :key="col.id" class="kanban-column" :data-status="col.id">
        <h4>{{ col.label }} <span class="count">{{ col.items.length }}</span></h4>
        <div v-if="col.items.length === 0" style="color: var(--text-tertiary); font-size: 12px; font-style: italic; padding: 8px 4px">No tasks</div>
        <div v-for="t in col.items" :key="t.id" class="task-card" :data-status="t.status">
          <div class="title">{{ t.title }}</div>
          <div class="meta">
            <span v-if="t.action" class="pill warn">{{ t.action }}</span>
            <span v-if="vendorFor(t)" class="pill" :class="catClass(vendorFor(t)!.category)">{{ vendorFor(t)!.name }}</span>
            <span>{{ fmtDate(t.createdAt) }}</span>
          </div>
          <div v-if="t.notes" class="notes">{{ t.notes }}</div>
          <div class="actions-row">
            <select class="status-sel" :value="t.status" @change="changeStatus(t, $event)">
              <option v-for="s in TASK_STATUSES" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
            <button class="small ghost" @click="delTask(t.id)">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
