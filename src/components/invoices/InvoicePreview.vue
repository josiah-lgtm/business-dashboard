<script setup lang="ts">
// Printable invoice preview. Mirrors the legacy top-level #invoice-print
// element: teleported to <body>, hides the app behind it, and uses the
// existing @media print rules (which show .invoice-print and hide .panel etc).
// Both outbound + contractor (team) previews render here via v-html. The
// Print / Close buttons are delegated through a click handler on the HTML.
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { renderOutboundPreview, renderTiPreview } from './preview-render'

const props = defineProps<{
  kind: 'outbound' | 'team'
  invoiceId: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useDashboard()
const { state } = storeToRefs(store)

const isContractor = computed(() => props.kind === 'team')

const html = computed(() => {
  if (props.kind === 'outbound') {
    const inv = state.value.invoices.find((x) => x.id === props.invoiceId)
    if (!inv) return ''
    return renderOutboundPreview(inv, state.value.business)
  }
  const inv = (state.value.teamInvoices || []).find((i) => i.id === props.invoiceId)
  if (!inv) return ''
  const m = state.value.team.find((t) => t.id === inv.memberId)
  if (!m) return ''
  return renderTiPreview(inv, m, state.value.business)
})

// The Print / Close buttons live inside the v-html string (matching legacy
// markup). Delegate their clicks here.
function onClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null
  if (!btn) return
  const act = btn.dataset.act
  if (act === 'print') window.print()
  else if (act === 'close') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop: hides the app behind the printable sheet on screen. The
         @media print rules already hide .topbar/.sidebar/.panel and show
         .invoice-print, so printing yields only the invoice. -->
    <div class="inv-print-backdrop" @click.self="emit('close')">
      <div class="invoice-print" :class="{ 'contractor-invoice-mode': isContractor }" style="display: block" @click="onClick" v-html="html"></div>
    </div>
  </Teleport>
</template>

<style scoped>
.inv-print-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  overflow-y: auto;
  z-index: 300;
  padding: 24px 0 48px;
}
@media print {
  .inv-print-backdrop {
    position: static;
    background: none;
    overflow: visible;
    padding: 0;
  }
}
</style>
