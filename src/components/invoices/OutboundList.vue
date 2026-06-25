<script setup lang="ts">
// Outbound (client) invoices: the editor (when open) + the saved-invoices
// table. Ports renderInvoices + the new/edit/view/delete wiring. "+ New
// invoice" is owned by the parent panel header; it calls open(null) via the
// exposed ref.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { fmtDate } from '@/lib/format'
import InvoiceEditor from './InvoiceEditor.vue'

const emit = defineEmits<{ (e: 'preview', id: string): void }>()

const store = useDashboard()
const { state } = storeToRefs(store)

const editorOpen = ref(false)
const editingId = ref<string | null>(null)
// Re-mount the editor on each open so its internal form state resets cleanly.
const editorKey = ref(0)

function openNew() {
  editingId.value = null
  editorKey.value++
  editorOpen.value = true
}
function openEdit(id: string) {
  editingId.value = id
  editorKey.value++
  editorOpen.value = true
}
function closeEditor() {
  editorOpen.value = false
}
defineExpose({ openNew })

const symbolFor = (c: string) => (c === 'USD' ? '$' : c === 'EUR' ? '€' : '£')

const sorted = computed(() =>
  state.value.invoices.slice().sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
)

function delInvoice(id: string) {
  if (!confirm('Delete this invoice?')) return
  state.value.invoices = state.value.invoices.filter((x) => x.id !== id)
}
</script>

<template>
  <div>
    <InvoiceEditor v-if="editorOpen" :key="editorKey" :edit-id="editingId" @close="closeEditor" />

    <div class="card">
      <h3>Saved invoices</h3>
      <div>
        <div v-if="!state.invoices.length" class="empty">
          <h3>No invoices yet</h3>
          <p>Click <b>+ New invoice</b> to create one. Your business + bank details auto-populate from Settings.</p>
        </div>
        <table v-else>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Client</th>
              <th>Currency</th>
              <th class="num">Total</th>
              <th>Status</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in sorted" :key="inv.id">
              <td><b>{{ inv.number }}</b></td>
              <td>{{ fmtDate(inv.date) }}</td>
              <td>{{ inv.client.name }}</td>
              <td>{{ inv.currency }}</td>
              <td class="num">{{ symbolFor(inv.currency) }}{{ inv.total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td>
                <span class="pill" :class="inv.status === 'paid' ? 'good' : inv.status === 'sent' ? 'warn' : 'bad'">{{ inv.status.toUpperCase() }}</span>
              </td>
              <td class="actions" style="white-space: nowrap; width: auto">
                <button class="small" @click="emit('preview', inv.id)">View / Print</button>
                <button class="small ghost" @click="openEdit(inv.id)">Edit</button>
                <button class="small ghost" @click="delInvoice(inv.id)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
