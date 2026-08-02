<script setup>
// Capacity is reported per cohort because the pools are genuinely separate — a
// free women's bed cannot take a man. One combined figure would hide the case
// that matters: one side full while the other has room and someone waiting.
//
// The roster passes only the cohorts currently in view, so inside a segment
// this is a single card describing what you are actually looking at, and on
// All it is both.
defineProps({
  /** `[{ key, label, occupied, usable, free, outOfService }]` */
  cohorts: { type: Array, required: true },
})
</script>

<template>
  <div class="grid grid-cols-1 gap-2.5" :class="cohorts.length > 1 && 'sm:grid-cols-2'">
    <div v-for="c in cohorts" :key="c.key" class="bg-card rounded-md border p-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-sm font-medium">
          <Badge variant="outline" class="tracking-wider text-[10px] uppercase">
            {{ c.label }}
          </Badge>
          <span class="tabular-nums">{{ c.occupied }} of {{ c.usable }} beds</span>
        </span>
        <span class="text-muted-foreground text-xs tabular-nums">{{ c.free }} free</span>
      </div>

      <!-- Occupied solid, free a dashed outline, out of service hatched warning. -->
      <div class="bg-muted flex h-2 gap-0.5 overflow-hidden rounded-[3px]">
        <span v-if="c.occupied" class="bg-primary block h-full" :style="{ flex: c.occupied }" />
        <span
          v-if="c.free"
          class="border-muted-foreground block h-full rounded-[2px] border border-dashed"
          :style="{ flex: c.free }"
        />
        <span
          v-if="c.outOfService"
          class="bg-warning/25 block h-full"
          :style="{
            flex: c.outOfService,
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--warning) 0 3px, transparent 3px 6px)',
          }"
        />
      </div>

      <p class="mt-2 text-xs" :class="c.free === 0 ? 'text-warning' : 'text-muted-foreground'">
        <template v-if="c.free === 0">Full</template>
        <template v-else>{{ c.free }} bed{{ c.free === 1 ? '' : 's' }} available</template>
        <template v-if="c.outOfService"> · {{ c.outOfService }} out of service</template>
      </p>
    </div>
  </div>
</template>
