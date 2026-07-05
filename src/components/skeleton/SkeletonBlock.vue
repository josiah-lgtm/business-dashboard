<script setup lang="ts">
// The sole skeleton primitive: a rounded shimmer rectangle. Everything else
// composes these. Sizing comes from props; the shimmer + reduced-motion handling
// live in the global .skl rule in app.css so it stays in sync with the design
// tokens.
withDefaults(
  defineProps<{
    /** CSS width, e.g. "220px" or "60%" */
    w?: string
    /** CSS height, e.g. "12px" */
    h?: string
    /** border radius override */
    radius?: string
    /** softer, inset fill — for large chart/table placeholders */
    soft?: boolean
  }>(),
  { w: '100%', h: '12px', radius: '6px', soft: false },
)
</script>

<template>
  <div class="skl" :class="{ 'skl-soft': soft }" :style="{ width: w, height: h, borderRadius: radius }"></div>
</template>
