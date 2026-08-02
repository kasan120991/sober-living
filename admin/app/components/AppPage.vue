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

  <div class="flex flex-1 flex-col gap-4 p-4">
    <p v-if="description" class="text-muted-foreground max-w-[65ch] text-sm">{{ description }}</p>
    <slot />
  </div>
</template>
