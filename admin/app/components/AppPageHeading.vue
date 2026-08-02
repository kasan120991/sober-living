<script setup>
// An in-body title block: heading, a line of context, and the page's primary
// action beside it.
//
// This deliberately repeats the breadcrumb's title. Since the header matched
// sidebar-08 that title is set at 14px regular — the same size as its own
// ancestors — which is right for a trail and too quiet to open a page with. The
// heading here is what tells you where you landed; the breadcrumb is what tells
// you how to get back.
//
// The description is a sentence about *this* facility right now, not a caption
// explaining what the screen is. "Everyone currently in the program" tells a
// staff member nothing they did not know from the nav.
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="font-heading text-[22px] leading-tight font-semibold tracking-tight">
        {{ title }}
      </h2>
      <p v-if="description || $slots.description" class="text-muted-foreground mt-0.5 text-[13.5px]">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
