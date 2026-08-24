<script setup lang="ts">
// RETUNED FROM UPSTREAM: `h-12 px-3` rather than `p-3`, because CLAUDE.md's UI
// rules say rows are 48px with px-3 cells, and `p-3` on a text-sm line gives 44.
// `whitespace-nowrap` is dropped too: upstream sets it, but only 44 of the 66
// cells here carried it and 22 deliberately did not — so it stays per call site
// rather than becoming a default that would stop those 22 wrapping.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <td
    data-slot="table-cell"
    :class="cn('h-12 px-3 align-middle [&:has([role=checkbox])]:pr-0', props.class)"
  >
    <slot />
  </td>
</template>
