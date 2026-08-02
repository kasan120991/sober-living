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
  <div
    class="rounded-[var(--ui-radius)] border border-[var(--color-hairline)] bg-[var(--color-elevated)] p-5"
  >
    <p class="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-mute)]">
      {{ module }}
    </p>
    <p class="mt-2 max-w-[65ch] text-sm text-[var(--color-body)]">{{ summary }}</p>
  </div>
</template>
