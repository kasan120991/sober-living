<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="sidebar-menu-badge"
    data-sidebar="menu-badge"
    :class="cn(
      // VENDORED CHANGE: centred, rather than offset by button size. shadcn's
      // fixed tops (peer-data-[size=default]/menu-button:top-1.5 and friends)
      // assume its own 36/32px buttons; ours are h-9 but `max-md:h-11` and
      // `pointer-coarse:h-11` under the 44px tap floor in CLAUDE.md's UI rules,
      // so a fixed top-1.5 sat the badge a third of the way down the row on
      // exactly the device that floor exists for. This is the second-order cost
      // of that deviation. Centring is height-agnostic, so it cannot rot the
      // next time a height moves.
      'text-sidebar-foreground peer-hover/menu-button:text-sidebar-accent-foreground peer-data-active/menu-button:text-sidebar-accent-foreground pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-5 min-w-5 rounded-xl px-1 text-xs font-medium flex items-center justify-center tabular-nums select-none group-data-[collapsible=icon]:hidden',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
