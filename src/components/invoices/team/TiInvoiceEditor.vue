<script setup lang="ts">
// Team-invoice editor modal. Ports openTiInvoiceEditor:
//  - materialise a draft into store.state.teamInvoices on open (new) / edit existing
//  - per-keystroke autosave (store autosaves to localStorage + cloud)
//  - hours × rate → amount auto-fill
//  - Save (confirm + close) / Save & submit (status=pending + Slack post)
//  - junk-rollback on cancel/close when a brand-new draft has no real content
import { reactive, ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { uid, isoDate, isoMonth } from '@/lib/format'
import type { TeamInvoice } from '@/types'
import { tiNextInvoiceNumber, tiPostToSlack } from './ti-helpers'

const props = defineProps<{ memberId: string; invoiceId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useDashboard()
const { state } = storeToRefs(store)

const member = state.value.team.find((t) => t.id === props.memberId)!
const startedNew = !props.invoiceId

const today = isoDate(new Date())
const existing = props.invoiceId ? (state.value.teamInvoices || []).find((i) => i.id === props.invoiceId) || null : null
const period0 = existing?.period || isoMonth(new Date())
const dueDefault = (() => {
  const d = new Date(today)
  d.setDate(d.getDate() + 2)
  return isoDate(d)
})()
const periodMonthName = (() => {
  const [y, m] = period0.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long' })
})()
const memberPayType = (member && member.payType) || 'commission'
const defaultCat = memberPayType === 'salary' ? 'Retainer service' : 'Commission services'

// The working invoice object. For an existing invoice we edit the live store
// object in place; for a new one we build a fresh draft then materialise it.
let invObj: TeamInvoice
if (existing) {
  invObj = existing
  if (invObj.dueDate === undefined) invObj.dueDate = dueDefault
  if (invObj.itemCategory === undefined) invObj.itemCategory = defaultCat
  if (invObj.taxPct === undefined) invObj.taxPct = 0
  if (!invObj.services && periodMonthName) invObj.services = periodMonthName
} else {
  invObj = {
    id: uid(),
    memberId: props.memberId,
    number: tiNextInvoiceNumber(state.value, props.memberId),
    date: today,
    dueDate: dueDefault,
    period: period0,
    itemCategory: defaultCat,
    services: periodMonthName,
    hours: 0,
    rate: 0,
    amount: 0,
    taxPct: 0,
    currency: 'EUR',
    notes: '',
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
}

// Editable form mirror — bound to inputs, synced back into invObj on change.
const form = reactive({
  number: invObj.number,
  date: invObj.date,
  dueDate: invObj.dueDate || dueDefault,
  period: invObj.period || period0,
  status: invObj.status || 'draft',
  itemCategory: /retainer|salary/i.test(invObj.itemCategory || '') ? 'Retainer service' : 'Commission services',
  services: invObj.services || '',
  hours: invObj.hours || 0,
  rate: invObj.rate || 0,
  amount: invObj.amount || 0,
  taxPct: invObj.taxPct || 0,
  currency: invObj.currency || 'EUR',
  notes: invObj.notes || '',
})

const statusText = ref('')
let savedTimer: ReturnType<typeof setTimeout> | undefined

if (!state.value.teamInvoices) state.value.teamInvoices = []

function ensurePersisted() {
  const arr = state.value.teamInvoices
  const idx = arr.findIndex((i) => i.id === invObj.id)
  if (idx >= 0) {
    arr[idx] = invObj
  } else {
    arr.push(invObj)
  }
  // Re-bind to the reactive proxy so subsequent property writes (collect)
  // trigger the store's deep-watch autosave.
  const live = arr.find((i) => i.id === invObj.id)
  if (live) invObj = live
}

function collect() {
  invObj.number = form.number
  invObj.date = form.date
  invObj.dueDate = form.dueDate
  invObj.period = form.period
  invObj.status = form.status as TeamInvoice['status']
  invObj.itemCategory = form.itemCategory
  invObj.services = form.services
  invObj.hours = Number(form.hours) || 0
  invObj.rate = Number(form.rate) || 0
  invObj.amount = Number(form.amount) || 0
  invObj.taxPct = Number(form.taxPct) || 0
  invObj.currency = form.currency
  invObj.notes = form.notes
  invObj.updatedAt = new Date().toISOString()
}

function syncAmt() {
  const h = Number(form.hours) || 0
  const r = Number(form.rate) || 0
  if (h && r) form.amount = Number((h * r).toFixed(2))
}

function autoSave() {
  collect()
  ensurePersisted()
  statusText.value = 'Saving…'
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    statusText.value = 'Saved ✓'
  }, 350)
}

function close() {
  // Junk-rollback: a brand-new draft with no real content is removed.
  if (startedNew) {
    const arr = state.value.teamInvoices || []
    const idx = arr.findIndex((i) => i.id === invObj.id)
    if (idx >= 0) {
      const hasContent =
        (Number(invObj.amount) || 0) > 0 ||
        (invObj.services && invObj.services.trim() && invObj.services !== periodMonthName) ||
        (invObj.notes && invObj.notes.trim())
      if (!hasContent) {
        arr.splice(idx, 1)
      }
    }
  }
  emit('close')
}

function save(alsoSubmit: boolean) {
  collect()
  if (alsoSubmit) {
    form.status = 'pending'
    invObj.status = 'pending'
  }
  ensurePersisted()
  if (alsoSubmit && state.value.slackWebhookUrl) {
    statusText.value = 'Saved · posting to Slack…'
    tiPostToSlack(state.value, invObj).then((ok) => {
      statusText.value = ok ? 'Saved & posted to Slack ✓' : 'Saved, but Slack post failed (check webhook URL)'
      if (ok) setTimeout(close, 900)
    })
  } else {
    statusText.value = alsoSubmit ? 'Saved & submitted ✓' : 'Saved ✓'
    setTimeout(close, 600)
  }
}

onMounted(() => {
  // Materialise immediately so a refresh mid-edit doesn't lose the draft,
  // matching the legacy autosave-on-open behaviour.
  ensurePersisted()
})
</script>

<template>
  <div class="modal-overlay open" @click.self="close">
    <div class="modal" style="max-width: 640px">
      <div class="modal-head">
        <h2>{{ existing ? 'Edit' : 'New' }} invoice · {{ member.name }}</h2>
        <button class="x" @click="close">×</button>
      </div>
      <div class="modal-body">
        <div class="grid grid-auto" style="gap: 12px">
          <div><label>Invoice #</label><input type="text" v-model="form.number" @input="autoSave" @change="autoSave" /></div>
          <div><label>Date</label><input type="date" v-model="form.date" @input="autoSave" @change="autoSave" /></div>
          <div><label>Due date</label><input type="date" v-model="form.dueDate" @input="autoSave" @change="autoSave" /></div>
          <div><label>Period (which month)</label><input type="month" v-model="form.period" @input="autoSave" @change="autoSave" /></div>
          <div>
            <label>Status</label>
            <select v-model="form.status" @change="autoSave">
              <option value="draft">Draft</option>
              <option value="pending">Pending review</option>
              <option value="accepted">Accepted</option>
              <option value="paid">Paid</option>
              <option value="submitted">Submitted (legacy)</option>
            </select>
          </div>
        </div>
        <div class="grid grid-auto" style="gap: 12px; margin-top: 12px">
          <div>
            <label>Service type</label>
            <select v-model="form.itemCategory" @change="autoSave" title="Retainer = fixed monthly fee (salary). Services = % of cash (commission).">
              <option value="Retainer service">🏷 Retainer service (salary)</option>
              <option value="Commission services">💰 Commission services</option>
            </select>
          </div>
          <div style="grid-column: span 2">
            <label>Description</label>
            <input type="text" v-model="form.services" @input="autoSave" @change="autoSave" placeholder="e.g. March" />
          </div>
        </div>
        <div class="grid grid-auto" style="gap: 12px; margin-top: 12px">
          <div><label>Hours (optional)</label><input type="number" step="0.5" min="0" v-model.number="form.hours" @input="syncAmt(); autoSave()" @change="autoSave" /></div>
          <div><label>Rate (optional)</label><input type="number" step="0.01" min="0" v-model.number="form.rate" @input="syncAmt(); autoSave()" @change="autoSave" /></div>
          <div><label>Amount</label><input type="number" step="0.01" min="0" v-model.number="form.amount" @input="autoSave" @change="autoSave" /></div>
          <div><label>Tax %</label><input type="number" step="0.1" min="0" v-model.number="form.taxPct" @input="autoSave" @change="autoSave" /></div>
          <div>
            <label>Currency</label>
            <select v-model="form.currency" @change="autoSave">
              <option>EUR</option>
              <option>GBP</option>
              <option>USD</option>
              <option>PHP</option>
            </select>
          </div>
        </div>
        <div style="margin-top: 12px">
          <label>Notes (optional)</label>
          <textarea rows="2" v-model="form.notes" @input="autoSave" @change="autoSave" placeholder="Bank info shown on PDF, payment terms, anything else"></textarea>
        </div>
      </div>
      <div class="modal-foot">
        <span class="status">{{ statusText }}</span>
        <button class="ghost" @click="close">Cancel</button>
        <button class="primary" @click="save(false)">Save</button>
        <button class="primary" @click="save(true)" title="Save + status=pending + post to Slack for admin review">Save &amp; submit for review →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The legacy .modal* classes had no global CSS, so define them here (modelled
   on the global .fh-modal-* shell for visual consistency). */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px;
  z-index: 200;
  overflow-y: auto;
}
.modal {
  background: var(--surface, #1c1c1e);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: 100%;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid var(--separator);
}
.modal-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.modal-head .x {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.modal-head .x:hover {
  color: var(--text);
}
.modal-body {
  padding: 18px 22px 22px;
}
.modal-body label {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.modal-body input,
.modal-body select,
.modal-body textarea {
  width: 100%;
}
.modal-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--separator);
}
.modal-foot .status {
  flex: 1;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
