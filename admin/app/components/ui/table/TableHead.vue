<script setup lang="ts">
// RETUNED FROM UPSTREAM: the uppercase micro-caps header is this app's own, and
// was identical across all nine hand-rolled tables this component replaced.
// Upstream is `text-foreground h-12 … font-medium` — normal case at text-sm.
// Kept so the migration changed the markup and not the look.
// `shadcn-vue diff table` will flag this and TableCell; that is why.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <th
    data-slot="table-head"
    :class="cn('bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-wider whitespace-nowrap uppercase align-middle [&:has([role=checkbox])]:pr-0', props.class)"
  >
    <slot />
  </th>
</template>
