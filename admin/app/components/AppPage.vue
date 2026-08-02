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

  <!-- min-w-0 stops this flex child keeping min-width:auto. Note it is NOT
       sufficient on its own: at 375px a wide table still scrolls the page
       sideways, because a <table> inside nested overflow contexts contributes
       its full width to an ancestor's scrollWidth even when the intermediate
       container clips it. Known issue; the table scrolls correctly inside its
       own container. -->
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
