<script setup>
// The in-body title block. Every page has one.
//
// It carries the page's <h1> — the app bar no longer states the page name, so
// this is the only place that does, and it is where a screen reader lands.
//
// `back` is the other half of that move: the breadcrumb used to be the way out
// of a detail page, and it left the bar with the title. A back link belongs
// with the thing it takes you back from, not in shell chrome shared by every
// screen.
import { ChevronLeft } from '@lucide/vue'

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  /** `{ label, to }` on a detail page; omitted on a top-level one. */
  back: { type: Object, default: null },
})
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <NuxtLink
        v-if="back"
        :to="back.to"
        class="text-muted-foreground hover:text-foreground -ms-1 mb-0.5 inline-flex items-center gap-1 text-[12.5px] transition-colors"
      >
        <ChevronLeft class="size-3.5" aria-hidden="true" />
        {{ back.label }}
      </NuxtLink>

      <h1 class="font-heading truncate text-[22px] leading-tight font-semibold tracking-tight">
        {{ title }}
      </h1>

      <p
        v-if="description || $slots.description"
        class="text-muted-foreground mt-0.5 text-[13.5px]"
      >
        <slot name="description">{{ description }}</slot>
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
