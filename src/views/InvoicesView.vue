<script setup lang="ts">
// Invoices view — Outbound (client invoices we send) + Inbound (team / vendor
// invoices to us). Ports the panel HTML (legacy 2942-3135) and the top-tab +
// admin/member toggle wiring. Outbound + inbound subtrees live in child
// components; the printable preview teleports to <body>.
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import OutboundList from '@/components/invoices/OutboundList.vue'
import InvoicePreview from '@/components/invoices/InvoicePreview.vue'
import TeamInvoicesAdmin from '@/components/invoices/team/TeamInvoicesAdmin.vue'
import MemberPortal from '@/components/invoices/team/MemberPortal.vue'
import TiInvoiceEditor from '@/components/invoices/team/TiInvoiceEditor.vue'

const store = useDashboard()
const { state } = storeToRefs(store)

// ---- Top tabs (Outbound / Inbound) ----
const tab = computed<'outbound' | 'inbound'>({
  get: () => (state.value.meta.invoicesTab === 'inbound' ? 'inbound' : 'outbound'),
  set: (v) => {
    state.value.meta = state.value.meta || ({} as any)
    state.value.meta.invoicesTab = v === 'inbound' ? 'inbound' : 'outbound'
  },
})

// ---- Inbound admin / member sub-toggle ----
const tiTab = computed<'admin' | 'member'>({
  get: () => state.value._tiTab || 'admin',
  set: (v) => {
    state.value._tiTab = v
  },
})

// ---- Outbound list (for + New invoice button delegation) ----
const outboundRef = ref<InstanceType<typeof OutboundList> | null>(null)
function newOutboundInvoice() {
  outboundRef.value?.openNew()
}

// ---- Team-invoice editor modal ----
const tiEditor = ref<{ open: boolean; memberId: string; invoiceId: string | null; key: number }>({
  open: false,
  memberId: '',
  invoiceId: null,
  key: 0,
})
function openTiEditor(memberId: string, invoiceId: string | null) {
  tiEditor.value = { open: true, memberId, invoiceId, key: tiEditor.value.key + 1 }
}
function closeTiEditor() {
  tiEditor.value.open = false
}

// ---- Printable preview (outbound + contractor) ----
const preview = ref<{ open: boolean; kind: 'outbound' | 'team'; id: string }>({ open: false, kind: 'outbound', id: '' })
function showOutboundPreview(id: string) {
  preview.value = { open: true, kind: 'outbound', id }
}
function showTiPreview(id: string) {
  preview.value = { open: true, kind: 'team', id }
}
function closePreview() {
  preview.value.open = false
}

// ---- Toast (matches legacy fhToast) ----
const toast = ref<{ msg: string; show: boolean }>({ msg: '', show: false })
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(msg: string) {
  toast.value = { msg, show: true }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value.show = false
  }, 2400)
}
</script>

<template>
  <section class="panel active" data-view="invoices">
    <div class="panel-header">
      <div>
        <h2>Invoices</h2>
        <div class="sub">Outbound (your client invoices) &amp; inbound (team / vendor invoices) — all in one place.</div>
      </div>
      <div class="actions">
        <div class="ti-view-toggle" style="margin-right: 8px">
          <button class="ti-toggle-btn" :class="{ active: tab === 'outbound' }" @click="tab = 'outbound'">Outbound</button>
          <button class="ti-toggle-btn" :class="{ active: tab === 'inbound' }" @click="tab = 'inbound'">Inbound</button>
        </div>
        <button v-if="tab === 'outbound'" class="primary" @click="newOutboundInvoice">+ New invoice</button>
      </div>
    </div>

    <!-- ===== OUTBOUND ===== -->
    <div v-show="tab === 'outbound'">
      <OutboundList ref="outboundRef" @preview="showOutboundPreview" />
    </div>

    <!-- ===== INBOUND ===== -->
    <div v-show="tab === 'inbound'">
      <div class="card" style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap">
        <div>
          <div style="font-weight: 600; font-size: 14px; color: var(--text)">Inbound from team &amp; vendors</div>
          <div class="help" style="margin-top: 4px">
            Admin manages everyone's profile; team members can switch into <b>Member view</b> to file their own. Each invoice generates a PDF with your AA branding.
          </div>
        </div>
        <div class="ti-view-toggle">
          <button class="ti-toggle-btn" :class="{ active: tiTab === 'admin' }" @click="tiTab = 'admin'">Admin view</button>
          <button class="ti-toggle-btn" :class="{ active: tiTab === 'member' }" @click="tiTab = 'member'">Member view</button>
        </div>
      </div>

      <TeamInvoicesAdmin
        v-if="tiTab === 'admin'"
        @open-editor="openTiEditor"
        @preview="showTiPreview"
        @toast="showToast"
      />
      <MemberPortal
        v-else
        @open-editor="openTiEditor"
        @preview="showTiPreview"
      />
    </div>

    <!-- Team-invoice editor modal -->
    <TiInvoiceEditor
      v-if="tiEditor.open"
      :key="tiEditor.key"
      :member-id="tiEditor.memberId"
      :invoice-id="tiEditor.invoiceId"
      @close="closeTiEditor"
    />

    <!-- Printable preview -->
    <InvoicePreview v-if="preview.open" :kind="preview.kind" :invoice-id="preview.id" @close="closePreview" />

    <!-- Toast -->
    <Teleport to="body">
      <div class="fh-toast" :class="{ show: toast.show }">{{ toast.msg }}</div>
    </Teleport>
  </section>
</template>
