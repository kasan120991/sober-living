<script setup lang="ts">
// RETUNED: the uppercase micro-caps eyebrow this app uses for panel titles,
// not upstream's text-base heading. Same treatment as TableHead.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  /**
   * Panel titles are real headings — the dashboard's are <h2> and a screen
   * reader navigates by them. Upstream renders a div unconditionally.
   */
  as?: string
}>(), { as: 'div' })
</script>

<template>
  <component
    :is="as"
    data-slot="card-title"
    :class="cn('text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase', props.class)"
  >
    <slot />
  </component>
</template>
