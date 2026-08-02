<script setup>
defineProps({
  apartments: { type: Array, default: () => [] },
  pending: { type: Boolean, default: false },
  selectedId: { type: String, default: null },
})
</script>

<template>
  <div v-if="pending" class="p-4 text-sm text-[var(--color-mute)]">Loading…</div>

  <div v-else-if="!apartments.length" class="p-6">
    <p class="text-sm text-[var(--color-mute)]">
      No apartments yet. Add one to start assigning beds.
    </p>
  </div>

  <ul v-else class="flex flex-col">
    <li v-for="a in apartments" :key="a.id">
      <NuxtLink
        :to="`/apartments/${a.id}`"
        class="flex min-h-[60px] items-center justify-between gap-3 border-b border-[var(--color-hairline-soft)] px-4 py-2.5 transition-colors hover:bg-[var(--color-hairline-soft)]"
        :class="
          selectedId === a.id &&
          'bg-[var(--color-hairline-soft)] shadow-[inset_2px_0_0_var(--color-ink)]'
        "
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="truncate text-[13.5px] font-medium text-[var(--color-ink)]">
              {{ a.name }}
            </span>
            <!-- Cohort is structural, not a status. A quiet outlined chip, never
                 a colour that would compete with a genuine exception. -->
            <span
              class="rounded-[3px] border border-[var(--color-hairline)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-body)]"
            >
              {{ a.cohort === 'MEN' ? 'Men' : 'Women' }}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-[var(--color-mute)]">
            <span class="tabular-nums">{{ a.occupiedCount }} of {{ a.bedCount }}</span> occupied
            <template v-if="a.outOfServiceCount">
              · <span class="text-[var(--color-warning-deep)]">{{ a.outOfServiceCount }} out</span>
            </template>
          </p>
        </div>
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 shrink-0 text-[var(--color-faint)]"
          aria-hidden="true"
        />
      </NuxtLink>
    </li>
  </ul>
</template>
