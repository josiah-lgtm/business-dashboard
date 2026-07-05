<script setup lang="ts">
// A generic, dashboard-shaped loading skeleton. Reuses the REAL layout classes
// (.panel / .panel-header / .grid-3 / .kpi / .card) so when the actual view
// swaps in there is no layout shift. Used in two places:
//   1. as the loadingComponent for lazy route chunks (shows only if the chunk
//      takes longer than the async-component delay — cached nav stays instant), and
//   2. as the first-load placeholder while an empty team build waits for its
//      first cloud pull (see cloudFirstLoadPending).
import SkeletonBlock from './SkeletonBlock.vue'
</script>

<template>
  <section class="panel active skl-view" aria-hidden="true" aria-busy="true">
    <div class="panel-header">
      <div>
        <SkeletonBlock w="220px" h="32px" radius="9px" />
        <SkeletonBlock w="300px" h="15px" style="margin-top: 12px" />
      </div>
    </div>

    <!-- KPI row -->
    <div class="grid grid-3" style="margin-bottom: 16px">
      <div class="kpi" v-for="i in 3" :key="i">
        <SkeletonBlock w="55%" h="11px" />
        <SkeletonBlock w="72%" h="26px" radius="8px" style="margin-top: 16px" />
        <SkeletonBlock w="45%" h="12px" style="margin-top: 14px" />
      </div>
    </div>

    <!-- Chart cards -->
    <div class="card">
      <SkeletonBlock w="180px" h="12px" style="margin-bottom: 20px" />
      <SkeletonBlock w="100%" h="240px" radius="8px" soft />
    </div>
    <div class="card">
      <SkeletonBlock w="150px" h="12px" style="margin-bottom: 20px" />
      <SkeletonBlock w="100%" h="200px" radius="8px" soft />
    </div>
  </section>
</template>
