<script setup>
// Placeholder body for a module that has a route and a nav entry but no
// implementation yet. Names the CLAUDE.md module it will become, so the nav is
// never a dead end with no explanation.
defineProps({
  module: { type: String, required: true },
  summary: { type: String, required: true },
})
</script>

<template>
  <Card class="p-5">
    <p class="text-muted-foreground text-[11px] uppercase tracking-wider">
      {{ module }}
    </p>
    <p class="mt-2 max-w-[65ch] text-sm">{{ summary }}</p>
  </Card>
</template>
