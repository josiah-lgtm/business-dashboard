<script setup lang="ts">
// Inbound Team-Invoices ADMIN view. Ports renderTiPendingList, renderTiMembers,
// renderTiLoginsTable, renderTiMonths + their wiring. Members + months are
// reactive computeds; all writes mutate store.state directly.
import { ref, reactive, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { uid } from '@/lib/format'
import { money } from '@/lib/money'
import { tiCountry, fmtTiMonth } from '@/lib/countries'
import BankFields from './BankFields.vue'
import {
  tiInitials,
  tiInvoiceHasPayout,
  tiAddInvoiceToTeamExpense,
  fhRecalcTeamTotals,
} from './ti-helpers'

const emit = defineEmits<{
  (e: 'open-editor', memberId: string, invoiceId: string | null): void
  (e: 'preview', invoiceId: string): void
  (e: 'toast', msg: string): void
}>()

const store = useDashboard()
const { state } = storeToRefs(store)

// ---- Slack ----
const slackTestText = ref('Send test ping')
const slackTestDisabled = ref(false)
async function slackTest() {
  if (!state.value.slackWebhookUrl) {
    alert('Add a webhook URL first')
    return
  }
  slackTestDisabled.value = true
  slackTestText.value = 'Sending…'
  try {
    const r = await fetch(state.value.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '🧪 Test ping from Agency Advanta dashboard — Team Invoices wired up.' }),
    })
    slackTestText.value = r.ok ? 'Sent ✓' : 'Failed'
  } catch {
    slackTestText.value = 'Failed (check URL)'
  } finally {
    setTimeout(() => {
      slackTestDisabled.value = false
      slackTestText.value = 'Send test ping'
    }, 1800)
  }
}

// ---- Pending review ----
const pending = computed(() =>
  (state.value.teamInvoices || [])
    .filter((i) => (i.status || 'draft') === 'pending')
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
)
// amount overrides keyed by invoice id (falls back to the invoice's amount)
const overrides = reactive<Record<string, number>>({})
function overrideFor(iid: string, amount: number): number {
  return overrides[iid] !== undefined ? overrides[iid] : amount
}
function sym(c?: string) {
  return c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'PHP' ? '₱' : '£'
}
function memberName(id: string) {
  return state.value.team.find((t) => t.id === id)?.name
}

function acceptInvoice(iid: string) {
  const inv = (state.value.teamInvoices || []).find((i) => i.id === iid)
  if (!inv) return
  const m = state.value.team.find((t) => t.id === inv.memberId)
  const finalAmount = Number(overrides[iid]) || Number(inv.amount) || 0
  const cat = (inv.itemCategory || 'Commission').toLowerCase()
  const payoutType = cat.includes('retainer') || cat.includes('salary') ? 'salary' : 'commission'
  if (!confirm(`Accept ${m?.name || 'invoice'} for ${money(finalAmount)}?\n\nThis creates a ${payoutType} payout for ${fmtTiMonth(inv.period || '')} linked to invoice #${inv.number}.`)) return
  inv.amount = finalAmount
  inv.status = 'accepted'
  inv.acceptedAt = new Date().toISOString()
  tiAddInvoiceToTeamExpense(state.value, iid, finalAmount)
}

function declineInvoice(iid: string) {
  const inv = (state.value.teamInvoices || []).find((i) => i.id === iid)
  if (!inv) return
  if (!confirm('Decline this invoice? It will be moved back to draft so the member can edit and resubmit.')) return
  inv.status = 'draft'
  inv.declinedAt = new Date().toISOString()
  const before = (state.value.teamPayouts || []).length
  state.value.teamPayouts = (state.value.teamPayouts || []).filter((p) => p.invoiceId !== inv.id)
  if (state.value.teamPayouts.length !== before && inv.period) fhRecalcTeamTotals(state.value, inv.period)
}

// ---- Members ----
// Stable display order: only re-sort when the SET of member ids changes
// (add / delete), not on every name keystroke — otherwise editing a name in a
// card would reorder cards mid-edit and steal focus (legacy never re-rendered
// the member list while typing, only on country change).
const memberOrder = ref<string[]>([])
function recomputeOrder() {
  memberOrder.value = (state.value.team || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => m.id)
}
recomputeOrder()
watch(
  () =>
    (state.value.team || [])
      .map((t) => t.id)
      .sort()
      .join('|'),
  () => recomputeOrder(),
)

const openMembers = reactive<Record<string, boolean>>({})
const members = computed(() =>
  memberOrder.value
    .map((id) => (state.value.team || []).find((t) => t.id === id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => {
      const c = tiCountry(m.country)
      const mine = (state.value.teamInvoices || []).filter((i) => i.memberId === m.id)
      const pendingCount = mine.filter((i) => (i.status || 'draft') === 'pending').length
      const total = mine
        .filter((i) => i.status === 'accepted' || i.status === 'paid')
        .reduce((s, i) => s + (Number(i.amount) || 0), 0)
      return { m, code: c.code, invCount: mine.length, pendingCount, total }
    }),
)

function toggleMember(id: string) {
  openMembers[id] = !openMembers[id]
}
function addMember() {
  const name = prompt('Name (team member or vendor):')
  if (!name) return
  state.value.team.push({
    id: uid(),
    name: name.trim(),
    role: '',
    payType: 'salary',
    amount: 0,
    monthlySalary: 0,
    commissionAmount: 0,
    active: true,
    email: '',
    address: '',
    country: 'GB',
    bank: {},
    password: '',
  })
}
function deleteMember(id: string) {
  const m = state.value.team.find((t) => t.id === id)
  if (!m) return
  const invCount = (state.value.teamInvoices || []).filter((i) => i.memberId === id).length
  if (!confirm(`Delete ${m.name}? They have ${invCount} invoice(s) — those will also be removed.`)) return
  state.value.team = state.value.team.filter((t) => t.id !== id)
  state.value.teamInvoices = (state.value.teamInvoices || []).filter((i) => i.memberId !== id)
}

// ---- Logins ----
const loginsSorted = computed(() =>
  memberOrder.value.map((id) => (state.value.team || []).find((t) => t.id === id)).filter((m): m is NonNullable<typeof m> => !!m),
)
const copiedId = ref<string | null>(null)
function copyCreds(id: string) {
  const m = state.value.team.find((t) => t.id === id)
  if (!m) return
  const txt = `${m.name}\nEmail: ${m.email || '(not set)'}\nPassword: ${m.password || '(not set)'}`
  navigator.clipboard?.writeText(txt)
  copiedId.value = id
  setTimeout(() => {
    if (copiedId.value === id) copiedId.value = null
  }, 1200)
}

// ---- Months ----
const monthFolders = computed(() => {
  const invs = state.value.teamInvoices || []
  if (!invs.length) return []
  const byMonth: Record<string, typeof invs> = {}
  invs.forEach((i) => {
    const k = i.period || (i.date || '').slice(0, 7) || 'unknown'
    ;(byMonth[k] = byMonth[k] || []).push(i)
  })
  const months = Object.keys(byMonth).sort().reverse()
  state.value.teamInvoiceMonths = state.value.teamInvoiceMonths || {}
  return months.map((mid) => {
    const list = byMonth[mid].slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    const total = list.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const open = state.value.teamInvoiceMonths[mid] !== false
    return {
      mid,
      open,
      total,
      list: list.map((i) => ({ inv: i, inTeam: tiInvoiceHasPayout(state.value, i.id), member: state.value.team.find((t) => t.id === i.memberId) })),
    }
  })
})

function toggleMonth(mid: string) {
  state.value.teamInvoiceMonths = state.value.teamInvoiceMonths || {}
  const open = state.value.teamInvoiceMonths[mid] !== false
  state.value.teamInvoiceMonths[mid] = !open
}

function teamExpense(iid: string) {
  const inv = (state.value.teamInvoices || []).find((i) => i.id === iid)
  if (!inv) return
  const wasLinked = tiInvoiceHasPayout(state.value, iid)
  const payout = tiAddInvoiceToTeamExpense(state.value, iid)
  if (!payout) return
  emit('toast', wasLinked ? `Refreshed Team expense for #${inv.number}` : `Added #${inv.number} to Team expenses (${payout.type})`)
}

function delTiInvoice(iid: string) {
  if (!confirm('Delete this invoice?')) return
  const inv = (state.value.teamInvoices || []).find((i) => i.id === iid)
  state.value.teamInvoices = (state.value.teamInvoices || []).filter((i) => i.id !== iid)
  if (inv) {
    const before = (state.value.teamPayouts || []).length
    state.value.teamPayouts = (state.value.teamPayouts || []).filter((p) => p.invoiceId !== iid)
    if (state.value.teamPayouts.length !== before && inv.period) fhRecalcTeamTotals(state.value, inv.period)
  }
}
</script>

<template>
  <!-- Slack settings -->
  <div class="card">
    <h3>Slack notification</h3>
    <div style="display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end">
      <div>
        <label>Incoming webhook URL</label>
        <input v-model="state.slackWebhookUrl" type="url" placeholder="https://hooks.slack.com/services/..." />
        <div class="help">When a team member submits an invoice, a notification posts to this Slack channel. Generate the URL at api.slack.com/messaging/webhooks.</div>
      </div>
      <button class="ghost" :disabled="slackTestDisabled" @click="slackTest">{{ slackTestText }}</button>
    </div>
  </div>

  <!-- Pending review -->
  <div v-if="pending.length" class="card">
    <h3 style="color: var(--warn)">⚡ Pending review</h3>
    <p class="help" style="margin-top: 0">Invoices submitted by the team waiting for your approval. Accept (with optional amount override) auto-adds the amount to that month's salaries or commissions.</p>
    <div>
      <div v-for="i in pending" :key="i.id" class="ti-pending-item">
        <div class="ti-avatar">{{ tiInitials(memberName(i.memberId)) }}</div>
        <div>
          <div class="who">{{ memberName(i.memberId) || 'Unknown' }} <span style="color: var(--text-tertiary); font-weight: 400">· {{ i.number }}</span></div>
          <div class="what">{{ i.itemCategory || 'Commission' }} · {{ i.services || '' }} · for {{ fmtTiMonth(i.period || '') }}</div>
        </div>
        <div style="text-align: right; font-size: 11px; color: var(--text-tertiary)">
          Requested<br /><b style="color: var(--text); font-size: 14px; font-variant-numeric: tabular-nums">{{ sym(i.currency) }}{{ (Number(i.amount) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</b>
        </div>
        <input
          class="amt-override"
          type="number"
          step="0.01"
          min="0"
          :value="overrideFor(i.id, Number(i.amount) || 0)"
          @input="overrides[i.id] = parseFloat(($event.target as HTMLInputElement).value) || 0"
          title="Override the amount before accepting"
        />
        <div class="actions">
          <button class="small" @click="emit('preview', i.id)">View</button>
          <button class="small accept" @click="acceptInvoice(i.id)">Accept</button>
          <button class="small decline" @click="declineInvoice(i.id)">Decline</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Team members + profiles -->
  <div class="card">
    <h3>Team &amp; vendor</h3>
    <p class="help" style="margin-top: 0">Each member's profile + bank details. Click a card to expand and edit.</p>
    <div>
      <div v-if="!members.length" class="help">No team members yet — click + Add team member or vendor below.</div>
      <div v-for="row in members" :key="row.m.id" class="ti-member-card" :class="{ open: openMembers[row.m.id] }">
        <div class="ti-member-head" @click="toggleMember(row.m.id)">
          <div class="ti-avatar">{{ tiInitials(row.m.name) }}</div>
          <div>
            <div class="name">{{ row.m.name }}</div>
            <div class="meta">
              {{ row.m.role || 'no role' }}{{ row.m.email ? ' · ' + row.m.email : '' }} · {{ row.invCount }} invoice{{ row.invCount === 1 ? '' : 's' }} · {{ money(row.total) }} accepted
            </div>
          </div>
          <span v-if="row.pendingCount" class="ti-stat-pill pending">⚡ {{ row.pendingCount }} pending</span>
          <span class="country-pill">{{ row.code }}</span>
          <span class="toggle">›</span>
        </div>
        <div class="ti-member-body">
          <BankFields :member="row.m" />
          <div style="margin-top: 12px; display: flex; gap: 8px">
            <button class="small primary" @click="emit('open-editor', row.m.id, null)">+ New invoice for {{ row.m.name.split(' ')[0] }}</button>
            <button class="small ghost danger" @click="deleteMember(row.m.id)">Delete member</button>
          </div>
        </div>
      </div>
    </div>
    <div style="margin-top: 12px; display: flex; gap: 8px">
      <button class="small primary" @click="addMember">+ Add team member or vendor</button>
    </div>
  </div>

  <!-- Member logins -->
  <div class="card">
    <h3>Member logins</h3>
    <p class="help" style="margin-top: 0">
      Email + password for each member to log in via <b>Member view</b>. <b>Passwords are stored in the browser only</b> — share each member's credentials with them privately so they can sign in on their own device.
    </p>
    <div>
      <div v-if="!loginsSorted.length" class="help">Add a team member above to set up their login.</div>
      <table v-else class="ti-logins-table">
        <thead>
          <tr><th>Member</th><th>Email</th><th>Password</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="m in loginsSorted" :key="m.id">
            <td>
              <div class="name-cell"><div class="ti-avatar">{{ tiInitials(m.name) }}</div>{{ m.name }}</div>
            </td>
            <td><input type="email" v-model="m.email" placeholder="member@example.com" /></td>
            <td><input type="text" v-model="m.password" placeholder="set a password" /></td>
            <td><button class="copy-btn small" @click="copyCreds(m.id)">{{ copiedId === m.id ? 'Copied ✓' : 'Copy creds' }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Invoices by month -->
  <div class="card">
    <h3>Invoices by month</h3>
    <div>
      <div v-if="!monthFolders.length" class="help">No invoices yet. Add a team member above, then click <b>+ New invoice</b> on their card to file one.</div>
      <div v-for="folder in monthFolders" :key="folder.mid" class="ti-month-folder" :class="{ open: folder.open }">
        <div class="ti-month-head" @click="toggleMonth(folder.mid)">
          <div class="lbl">{{ fmtTiMonth(folder.mid) }}</div>
          <div class="summary">{{ folder.list.length }} invoice{{ folder.list.length === 1 ? '' : 's' }} · {{ money(folder.total) }}</div>
          <span class="toggle">›</span>
        </div>
        <div class="ti-month-body">
          <div v-for="row in folder.list" :key="row.inv.id" class="ti-invoice-row">
            <div class="num">{{ row.inv.number }}</div>
            <div class="from">{{ row.member ? row.member.name : 'Unknown' }}</div>
            <div class="meta" style="color: var(--text-tertiary); font-size: 12px">{{ (row.inv.services || '').slice(0, 60) }}</div>
            <div class="amt">{{ money(Number(row.inv.amount) || 0) }}</div>
            <span class="pill" :class="row.inv.status || 'draft'">{{ (row.inv.status || 'draft').toUpperCase() }}</span>
            <div class="row-actions">
              <button
                v-if="row.inTeam"
                class="small ghost in-team"
                title="Click to refresh the linked payout (e.g. after editing the amount)"
                @click="teamExpense(row.inv.id)"
              >
                ✓ In Team
              </button>
              <button v-else class="small" title="Create a Team & Payouts entry linked to this invoice" @click="teamExpense(row.inv.id)">+ Team expense</button>
              <button class="small" @click="emit('preview', row.inv.id)">View / PDF</button>
              <button class="small ghost" @click="emit('open-editor', row.inv.memberId, row.inv.id)">Edit</button>
              <button class="small ghost" @click="delTiInvoice(row.inv.id)">×</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
