<script setup lang="ts">
// RETUNED: only used by panels that pass p-0 to Card — see the note there.
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="card-content"
    :class="cn('px-4 pb-3', props.class)"
  >
    <slot />
  </div>
</template>
