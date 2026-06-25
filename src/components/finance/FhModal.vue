<script setup lang="ts">
// Generic Finance-hub modal shell — matches the legacy .fh-modal markup.
// Visibility is driven by the `open` prop; emits `close` on overlay-x / cancel.
defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div v-if="open" class="fh-modal-overlay" style="display: flex" @click.self="emit('close')">
    <div class="fh-modal">
      <div class="fh-modal-head">
        <h3>{{ title }}</h3>
        <button class="fh-modal-x" @click="emit('close')">×</button>
      </div>
      <div class="fh-modal-body">
        <slot></slot>
      </div>
    </div>
  </div>
</template>
