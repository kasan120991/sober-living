<script setup>
// Standard page frame: the shell bar, then a title block, then the body.
//
// The heading is rendered here rather than left to each page, so every screen
// has one by construction — the app bar no longer states the page name, and a
// page that forgot its own heading would be nameless.
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  /** `{ label, to }` on a detail page. Replaces what the breadcrumb used to do. */
  back: { type: Object, default: null },
})
</script>

<template>
  <AppPageHeader />

  <!-- min-w-0 stops this flex child keeping min-width:auto.
       This used to carry a known issue: at 375px a wide table still scrolled
       the PAGE sideways. The cause was not what the note said — it blamed
       nested overflow contexts, and the real culprit was a missing width
       constraint. The hand-rolled wrappers were a bare
       `<div class="overflow-x-auto">`, which has no width of its own and so
       grew to the table's intrinsic width and pushed the page out with it.
       The vendored Table supplies `relative w-full overflow-x-auto`, and the
       `w-full` pins it to this flex child. Measured on the roster at 375px:
       document.scrollWidth was 658 before and is 375 now. -->

  <div class="flex min-w-0 flex-1 flex-col gap-4 p-4">
    <AppPageHeading :title="title" :description="description" :back="back">
      <!-- v-if, or an empty slot would render a blank description line on every
           page that does not pass one. -->
      <template v-if="$slots.description" #description><slot name="description" /></template>
      <template #actions><slot name="actions" /></template>
    </AppPageHeading>

    <slot />
  </div>
</template>
