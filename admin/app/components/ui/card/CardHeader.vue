<script setup lang="ts">
// RETUNED: a flex row at px-4 pt-3 pb-2, not upstream's px-6 grid. Every
// panel header in this app is an eyebrow, an optional count and an optional
// trailing link — one line, never the two-row grid upstream builds for a
// title over a description.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="card-header"
    :class="cn('flex items-center gap-2 px-4 pt-3 pb-2 group/card-header', props.class)"
  >
    <slot />
  </div>
</template>
