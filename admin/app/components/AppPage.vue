<script setup>
// Standard page frame: a sticky header carrying the title and the mobile
// sidebar trigger, then the scrolling body.
//
// The title lives in the header rather than being repeated as an in-body <h1> —
// two headings saying the same thing is the usual way dashboard pages end up
// with a wasted first screenful.
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <header
    class="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4"
  >
    <SidebarTrigger class="-ml-1" />
    <Separator orientation="vertical" class="mr-2 h-4" />
    <h1 class="font-heading text-[15px] font-semibold tracking-tight">{{ title }}</h1>
    <div class="ml-auto flex items-center gap-2">
      <slot name="actions" />
    </div>
  </header>

  <div class="flex flex-1 flex-col gap-4 p-4">
    <p v-if="description" class="text-muted-foreground max-w-[65ch] text-sm">{{ description }}</p>
    <slot />
  </div>
</template>
