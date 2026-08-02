<script setup>
// Standard page frame: sticky navbar carrying the title and the mobile sidebar
// toggle, then the scrolling body.
//
// The title lives in the navbar rather than being repeated as an in-body <h1> —
// two headings saying the same thing is the usual way dashboard pages end up
// with a wasted first screenful.
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar
        :title="title"
        :ui="{
          root: 'border-b border-[var(--color-hairline)] bg-[var(--color-elevated)]',
          title: 'text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]',
        }"
      >
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p v-if="description" class="mb-5 max-w-[65ch] text-sm text-[var(--color-mute)]">
        {{ description }}
      </p>
      <slot />
    </template>
  </UDashboardPanel>
</template>
