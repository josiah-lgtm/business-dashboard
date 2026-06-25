<script setup lang="ts">
// Inbound Team-Invoices MEMBER view. Ports renderTiMemberView + tiTryLogin /
// tiLogout / tiCurrentMember. Plain-text email + password match against
// store.state.team (local-only, as in legacy). Session id lives in
// store.state.teamInvoiceActiveMemberId.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { money } from '@/lib/money'
import { fmtTiMonth } from '@/lib/countries'
import BankFields from './BankFields.vue'
import { tiInitials } from './ti-helpers'

const emit = defineEmits<{
  (e: 'open-editor', memberId: string, invoiceId: string | null): void
  (e: 'preview', invoiceId: string): void
}>()

const store = useDashboard()
const { state } = storeToRefs(store)

const active = computed(() => {
  const id = state.value.teamInvoiceActiveMemberId
  if (!id) return null
  const m = (state.value.team || []).find((t) => t.id === id)
  if (!m) {
    state.value.teamInvoiceActiveMemberId = null
    return null
  }
  return m
})

const loginEmail = ref('')
const loginPassword = ref('')
const loginError = ref('')

function tryLogin() {
  const email = loginEmail.value.trim().toLowerCase()
  const pw = loginPassword.value
  if (!email || !pw) {
    loginError.value = 'Enter your email and password.'
    return
  }
  const m = (state.value.team || []).find((t) => (t.email || '').trim().toLowerCase() === email && (t.password || '') === pw)
  if (!m) {
    loginError.value = 'No member matches that email + password. Ask your admin to share or reset your credentials.'
    return
  }
  loginError.value = ''
  state.value.teamInvoiceActiveMemberId = m.id
  loginEmail.value = ''
  loginPassword.value = ''
}

function logout() {
  state.value.teamInvoiceActiveMemberId = null
}

const history = computed(() => {
  if (!active.value) return []
  return (state.value.teamInvoices || [])
    .filter((i) => i.memberId === active.value!.id)
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
})
</script>

<template>
  <div>
    <!-- Login form -->
    <div v-if="!active" class="card">
      <h3>Sign in</h3>
      <p class="help" style="margin-top: 0">Use the email + password your admin set up for you.</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; align-items: end; max-width: 560px">
        <div>
          <label>Email</label>
          <input v-model="loginEmail" type="email" placeholder="you@example.com" @keydown.enter="tryLogin" />
        </div>
        <div>
          <label>Password</label>
          <input v-model="loginPassword" type="password" @keydown.enter="tryLogin" />
        </div>
        <button class="primary" @click="tryLogin">Sign in</button>
      </div>
      <div v-if="loginError" class="help" style="color: var(--bad); margin-top: 8px">{{ loginError }}</div>
    </div>

    <template v-else>
      <!-- Greeting -->
      <div class="card">
        <div style="display: flex; align-items: center; gap: 12px">
          <div class="ti-avatar" style="width: 42px; height: 42px; font-size: 16px">{{ tiInitials(active.name) }}</div>
          <div style="flex: 1">
            <div style="font-weight: 600; font-size: 15px">{{ active.name }}</div>
            <div style="color: var(--text-tertiary); font-size: 12px">{{ active.email || '(no email set)' }}</div>
          </div>
          <button class="ghost small" @click="logout">Sign out</button>
        </div>
      </div>

      <!-- Profile editor -->
      <div class="card">
        <h3>Your profile</h3>
        <BankFields :member="active" />
      </div>

      <!-- File an invoice -->
      <div class="card">
        <h3>File an invoice</h3>
        <p class="help" style="margin-top: 0">File this month's invoice — your bank details + AA address are pre-filled on the PDF.</p>
        <button class="primary" @click="emit('open-editor', active.id, null)">+ New invoice</button>
      </div>

      <!-- History -->
      <div class="card">
        <h3>Your past invoices</h3>
        <div>
          <div v-if="!history.length" class="help">No invoices yet — click + New invoice above to file your first.</div>
          <div v-for="i in history" :key="i.id" class="ti-invoice-row">
            <div class="num">{{ i.number }}</div>
            <div class="from">{{ fmtTiMonth(i.period || '') }}</div>
            <div class="meta" style="color: var(--text-tertiary); font-size: 12px">{{ (i.services || '').slice(0, 50) }}</div>
            <div class="amt">{{ money(Number(i.amount) || 0) }}</div>
            <span class="pill" :class="i.status || 'draft'">{{ (i.status || 'draft').toUpperCase() }}</span>
            <div class="row-actions">
              <button class="small" @click="emit('preview', i.id)">View / PDF</button>
              <button class="small ghost" @click="emit('open-editor', i.memberId, i.id)">Edit</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
