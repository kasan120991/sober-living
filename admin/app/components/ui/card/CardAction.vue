<script setup lang="ts">
// RETUNED: `ms-auto` in a flex header rather than upstream's grid placement,
// because CardHeader is a flex row here.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="card-action"
    :class="cn('ms-auto flex shrink-0 items-center', props.class)"
  >
    <slot />
  </div>
</template>
