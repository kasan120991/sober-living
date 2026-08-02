<script lang="ts" setup>
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { Primitive } from 'reka-ui'
import { cn } from '@/lib/utils'

// Vendored change: `as` was added so the current crumb can BE the page's <h1>.
// shadcn ships this as a hard-coded <span role="link">, which is right for a
// docs breadcrumb sitting beneath a separate heading. Our header carries the
// title itself, so without this every page would have no <h1> at all.
const props = withDefaults(defineProps<PrimitiveProps & { class?: HTMLAttributes['class'] }>(), {
  as: 'span',
})
</script>

<template>
  <Primitive
    data-slot="breadcrumb-page"
    :as="as"
    :as-child="asChild"
    role="link"
    aria-disabled="true"
    aria-current="page"
    :class="cn('text-foreground font-normal', props.class)"
  >
    <slot />
  </Primitive>
</template>
