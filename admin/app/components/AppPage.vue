<script setup>
// Standard page frame: the shared header, then the scrolling body.
//
// The title lives in the header rather than being repeated as an in-body <h1> —
// two headings saying the same thing is the usual way dashboard pages end up
// with a wasted first screenful.
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  parents: { type: Array, default: () => [] },
})
</script>

<template>
  <AppPageHeader :title="title" :parents="parents">
    <template #actions><slot name="actions" /></template>
  </AppPageHeader>

  <!-- min-w-0 stops this flex child keeping min-width:auto. Note it is NOT
       sufficient on its own: at 375px the roster still scrolls the page
       sideways, because a <table> inside nested overflow contexts contributes
       its full width to an ancestor's scrollWidth even when the intermediate
       container clips it. overflow-x-hidden here does not fix that either —
       the overflow is being reported above this element. Known issue; the
       table itself scrolls correctly inside its own container. -->
  <div class="flex min-w-0 flex-1 flex-col gap-4 p-4">
    <p v-if="description" class="text-muted-foreground max-w-[65ch] text-sm">{{ description }}</p>
    <slot />
  </div>
</template>
