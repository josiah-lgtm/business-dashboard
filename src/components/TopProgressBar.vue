<script setup lang="ts">
// Slim accent bar pinned under the topbar; reflects cloud-sync activity.
import { progress } from '@/lib/progress'
</script>

<template>
  <div class="top-progress" :class="{ active: progress.active }" role="presentation">
    <div class="top-progress-fill" :style="{ width: progress.width + '%' }"></div>
  </div>
</template>
