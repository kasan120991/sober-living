<script setup>
// Capacity is reported per cohort because the pools are genuinely separate — a
// free women's bed cannot take a man. One combined figure would hide the case
// that matters: one side full while the other has room and someone waiting.
defineProps({
  capacity: { type: Object, required: true },
})

const COHORTS = [
  { key: 'MEN', label: 'Men' },
  { key: 'WOMEN', label: 'Women' },
]
</script>

<template>
  <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
    <div
      v-for="c in COHORTS"
      :key="c.key"
      class="rounded-[var(--ui-radius)] border border-[var(--color-hairline)] bg-[var(--color-elevated)] p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink)]">
          <span
            class="rounded-[3px] border border-[var(--color-hairline)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-body)]"
          >
            {{ c.label }}
          </span>
          <span class="tabular-nums">
            {{ capacity[c.key].occupied }} of {{ capacity[c.key].usable }} beds
          </span>
        </span>
        <span class="text-[12.5px] tabular-nums text-[var(--color-mute)]">
          {{ capacity[c.key].free }} free
        </span>
      </div>

      <!-- Occupied is solid ink (the normal state), free is a dashed outline,
           out of service is hatched amber. design.md §4. -->
      <div class="flex h-2 gap-0.5 overflow-hidden rounded-[3px] bg-[var(--color-hairline-soft)]">
        <span
          v-if="capacity[c.key].occupied"
          class="block h-full bg-[var(--color-ink)]"
          :style="{ flex: capacity[c.key].occupied }"
        />
        <span
          v-if="capacity[c.key].free"
          class="block h-full rounded-[2px] border border-dashed border-[var(--color-mute)]"
          :style="{ flex: capacity[c.key].free }"
        />
        <span
          v-if="capacity[c.key].outOfService"
          class="block h-full bg-[var(--color-warning-soft)]"
          :style="{
            flex: capacity[c.key].outOfService,
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--color-warning) 0 3px, transparent 3px 6px)',
          }"
        />
      </div>

      <p
        class="mt-2 text-xs"
        :class="capacity[c.key].free === 0 ? 'text-[var(--color-warning-deep)]' : 'text-[var(--color-mute)]'"
      >
        <template v-if="capacity[c.key].free === 0">Full</template>
        <template v-else>{{ capacity[c.key].free }} bed{{ capacity[c.key].free === 1 ? '' : 's' }} available</template>
        <template v-if="capacity[c.key].outOfService">
          · {{ capacity[c.key].outOfService }} out of service
        </template>
      </p>
    </div>
  </div>
</template>
