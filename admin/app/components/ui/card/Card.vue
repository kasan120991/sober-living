<script setup lang="ts">
// RETUNED FROM UPSTREAM, and more heavily than field or table — read this
// before running `shadcn-vue diff card`, which will be close to meaningless.
//
// Upstream Card is `rounded-4xl py-6 gap-6 shadow-md ring-1`. This app's 21
// panel surfaces are flat `rounded-md border` at p-4. Adopting upstream as-is
// was piloted on the dashboard's stat strip and rejected: 32px radii with a
// ring, sitting directly above 6px panels, read as a different design language
// on the same page — and converting all 21 to match would have been a redesign
// rather than a refactor.
//
// What this component is FOR here is the thing that was actually wrong: those
// 21 panels carried FIVE different paddings (p-3, p-3.5, p-4, p-5, px-4 py-3).
// p-4 is the default now and outliers say so out loud.
//
// PADDING LIVES ON THE CARD, not on CardContent as upstream has it, so a plain
// panel is a bare <Card> with no wrapper element. A panel with a header and
// full-bleed rows — the dashboard's five — passes `class="p-0"` and lets
// CardHeader/CardContent supply their own.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  size?: 'default' | 'sm'
  /**
   * A panel is often a real landmark — the dashboard's five are <section>, and
   * rendering them as divs would take them out of the document structure.
   * Upstream renders a div unconditionally.
   *
   * Takes a COMPONENT as well as a tag name, which is how a whole card becomes
   * one link: `<Card :as="NuxtLink" to="/census">`. `to` is not a declared prop
   * here, so it falls through to the root. This is upstream's `asChild` in the
   * shape Vue actually offers.
   */
  as?: string | object
}>(), {
  size: 'default',
  as: 'div',
})
</script>

<template>
  <component
    :is="as"
    data-slot="card"
    :data-size="size"
    :class="cn('bg-card text-card-foreground rounded-md border p-4 text-sm group/card flex flex-col', props.class)"
  >
    <slot />
  </component>
</template>
