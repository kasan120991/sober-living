<script setup lang="ts">
import type { SeparatorProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { Separator } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<
  SeparatorProps & { class?: HTMLAttributes['class'] }
>(), {
  orientation: 'horizontal',
  decorative: true,
})

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <Separator
    data-slot="separator"
    v-bind="delegatedProps"
    :class="
      cn(
        // Vendored change: `my-auto` on the vertical case. `self-stretch`
        // overrides a flex parent's items-center, so the moment you give a
        // vertical separator an explicit height — the h-4 rule in a page
        // header, say — it has nothing left to stretch and drops to the top of
        // the bar. Auto margins outrank align-self, so this centres it; when it
        // IS stretching there is no free space and the margins do nothing.
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=vertical]:my-auto',
        props.class,
      )
    "
  />
</template>
