<script setup lang="ts">
// Outbound (client) invoice editor. Ports showInvoiceForm + autoSaveOutboundInvoice
// + renderInvoiceItemsForm + recomputeInvoiceTotals + saveInvoice + the Cancel
// junk-rollback. Per-keystroke autosave materialises a new invoice on first edit
// (bumping store.state.meta.invoiceCounter); Cancel rolls back an empty draft.
import { reactive, ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { uid, isoDate } from '@/lib/format'
import type { Invoice, InvoiceItem, Currency } from '@/types'

const props = defineProps<{ editId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useDashboard()
const { state } = storeToRefs(store)

const startedNew = !props.editId
// The id of the invoice currently bound to this form. For an existing edit it
// is the editId; for a new one it stays null until first keystroke materialises.
const boundId = ref<string | null>(props.editId)

function newDefaults() {
  const today = isoDate(new Date())
  const yyyy = today.slice(0, 4)
  const num = state.value.meta.invoiceCounter || 1
  return { number: `INV-${yyyy}-${String(num).padStart(3, '0')}`, date: today }
}

const existing = props.editId ? state.value.invoices.find((x) => x.id === props.editId) || null : null

const form = reactive({
  number: '',
  date: '',
  currency: 'GBP' as Currency,
  status: 'paid' as Invoice['status'],
  clientName: '',
  clientEmail: '',
  clientAddress: '',
  taxPct: 0,
  notes: '',
})
const items = reactive<InvoiceItem[]>([])

if (existing) {
  form.number = existing.number
  form.date = existing.date
  form.currency = existing.currency
  form.status = existing.status
  form.clientName = existing.client.name || ''
  form.clientEmail = existing.client.email || ''
  form.clientAddress = existing.client.address || ''
  form.taxPct = existing.taxPct || 0
  form.notes = existing.notes || ''
  existing.items.forEach((i) => items.push({ ...i }))
} else {
  const def = newDefaults()
  form.number = def.number
  form.date = def.date
  form.currency = 'GBP'
  form.status = 'paid'
  form.notes = 'Thank you for your business.'
  items.push({ description: '', qty: 1, rate: 0 })
}

const sym = computed(() => (form.currency === 'USD' ? '$' : form.currency === 'EUR' ? '€' : '£'))
const fmt = (v: number) => sym.value + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const subtotal = computed(() => items.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0))
const tax = computed(() => (subtotal.value * (Number(form.taxPct) || 0)) / 100)
const total = computed(() => subtotal.value + tax.value)

function autoSave() {
  let inv: Invoice | undefined
  if (boundId.value) {
    inv = state.value.invoices.find((x) => x.id === boundId.value)
    if (!inv) return
  } else {
    // First keystroke on a new invoice → materialise + remember the id.
    const fresh = { id: uid(), items: [], client: {} } as unknown as Invoice
    state.value.invoices.push(fresh)
    state.value.meta.invoiceCounter = (state.value.meta.invoiceCounter || 1) + 1
    boundId.value = fresh.id
    // Re-fetch the reactive proxy so later property writes trigger autosave.
    inv = state.value.invoices.find((x) => x.id === fresh.id)
    if (!inv) return
  }
  inv.number = form.number.trim()
  inv.date = form.date
  inv.currency = form.currency
  inv.status = form.status
  inv.client = { name: form.clientName.trim(), email: form.clientEmail.trim(), address: form.clientAddress.trim() }
  inv.items = items.filter((i) => (i.description || '').trim() || i.qty || i.rate).map((i) => ({ ...i }))
  inv.taxPct = Number(form.taxPct) || 0
  inv.notes = form.notes.trim()
  inv.subtotal = inv.items.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0)
  inv.tax = (inv.subtotal * inv.taxPct) / 100
  inv.total = inv.subtotal + inv.tax
  inv.updatedAt = new Date().toISOString()
}

function addRow() {
  items.push({ description: '', qty: 1, rate: 0 })
  autoSave()
}
function removeRow(idx: number) {
  items.splice(idx, 1)
  if (!items.length) items.push({ description: '', qty: 1, rate: 0 })
  autoSave()
}

function save() {
  const itemsClean = items.filter((i) => i.description || i.qty || i.rate)
  const sub = itemsClean.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0)
  const taxPct = Number(form.taxPct) || 0
  const t = (sub * taxPct) / 100
  const payload: Partial<Invoice> = {
    number: form.number.trim(),
    date: form.date,
    currency: form.currency,
    status: form.status,
    client: { name: form.clientName.trim(), email: form.clientEmail.trim(), address: form.clientAddress.trim() },
    items: itemsClean.map((i) => ({ ...i })),
    taxPct,
    subtotal: sub,
    tax: t,
    total: sub + t,
    notes: form.notes.trim(),
  }
  if (boundId.value) {
    const ex = state.value.invoices.find((x) => x.id === boundId.value)
    if (ex) Object.assign(ex, payload)
  } else {
    const inv = { id: uid(), ...payload } as Invoice
    state.value.invoices.push(inv)
    state.value.meta.invoiceCounter = (state.value.meta.invoiceCounter || 1) + 1
  }
  emit('close')
}

function cancel() {
  // Roll back an empty autosave-materialised row started this session.
  if (startedNew && boundId.value) {
    const id = boundId.value
    const inv = state.value.invoices.find((x) => x.id === id)
    const hasContent =
      inv &&
      ((inv.client && (inv.client.name || inv.client.email || inv.client.address)) ||
        (inv.items && inv.items.length > 0) ||
        (inv.notes && inv.notes.trim() !== 'Thank you for your business.'))
    if (!hasContent) {
      state.value.invoices = state.value.invoices.filter((x) => x.id !== id)
    }
  }
  emit('close')
}

onMounted(() => {
  // Match the legacy form which renders item rows immediately; we do not
  // pre-materialise a new invoice until the first real keystroke.
  if (existing) autoSave()
})
</script>

<template>
  <div class="card">
    <h3>{{ existing ? 'Edit invoice' : 'New invoice' }}</h3>
    <form @submit.prevent="save">
      <div class="grid grid-auto" style="margin-bottom: 14px">
        <div>
          <label>Invoice number</label>
          <input type="text" v-model="form.number" required @input="autoSave" @change="autoSave" />
        </div>
        <div>
          <label>Date</label>
          <input type="date" v-model="form.date" required @input="autoSave" @change="autoSave" />
        </div>
        <div>
          <label>Currency</label>
          <select v-model="form.currency" @change="autoSave">
            <option>GBP</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </div>
        <div>
          <label>Status</label>
          <select v-model="form.status" @change="autoSave">
            <option value="paid">PAID</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
          </select>
        </div>
      </div>
      <div class="grid grid-2" style="margin-bottom: 14px">
        <div>
          <label>Client name</label>
          <input type="text" v-model="form.clientName" required @input="autoSave" @change="autoSave" />
        </div>
        <div>
          <label>Client email</label>
          <input type="email" v-model="form.clientEmail" @input="autoSave" @change="autoSave" />
        </div>
        <div style="grid-column: 1 / -1">
          <label>Client address</label>
          <textarea v-model="form.clientAddress" rows="2" @input="autoSave" @change="autoSave"></textarea>
        </div>
      </div>
      <div style="margin-bottom: 14px">
        <label style="display: flex; align-items: center; justify-content: space-between">
          <span>Line items</span>
          <button type="button" class="small ghost" @click="addRow">+ Add row</button>
        </label>
        <table class="inv-items-table">
          <thead>
            <tr>
              <th style="width: 55%">Description</th>
              <th class="num" style="width: 80px">Qty</th>
              <th class="num" style="width: 120px">Rate</th>
              <th class="num">Total</th>
              <th class="actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in items" :key="idx">
              <td><input type="text" v-model="item.description" placeholder="Service description" @input="autoSave" /></td>
              <td class="num"><input type="number" step="0.01" min="0" v-model.number="item.qty" style="width: 60px; text-align: right" @input="autoSave" /></td>
              <td class="num"><input type="number" step="0.01" min="0" v-model.number="item.rate" style="width: 100px; text-align: right" @input="autoSave" /></td>
              <td class="num">{{ fmt((item.qty || 0) * (item.rate || 0)) }}</td>
              <td class="actions"><button type="button" class="small ghost" @click="removeRow(idx)">×</button></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align: right; color: var(--muted)">Subtotal</td>
              <td class="num">{{ fmt(subtotal) }}</td>
              <td></td>
            </tr>
            <tr>
              <td colspan="2"></td>
              <td style="text-align: right; color: var(--muted)">Tax</td>
              <td>
                <input type="number" step="0.1" min="0" v-model.number="form.taxPct" style="width: 60px; padding: 4px 6px; font-size: 12px; text-align: right" @input="autoSave" /> %
              </td>
              <td class="num">{{ fmt(tax) }}</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align: right; font-weight: 700; font-size: 15px">Total</td>
              <td class="num" style="font-weight: 700; font-size: 15px">{{ fmt(total) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="margin-bottom: 14px">
        <label>Notes / payment terms</label>
        <textarea v-model="form.notes" rows="2" placeholder="e.g. Thanks for your business. Payment terms: net 7." @input="autoSave" @change="autoSave"></textarea>
      </div>
      <div style="display: flex; gap: 8px">
        <button type="submit" class="primary">Save invoice</button>
        <button type="button" @click="cancel">Cancel</button>
      </div>
    </form>
  </div>
</template>
