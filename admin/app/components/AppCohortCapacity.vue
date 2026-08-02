<script setup>
// Capacity is reported per cohort because the pools are genuinely separate — a
// free women's bed cannot take a man. One combined figure would hide the case
// that matters: one side full while the other has room and someone waiting.
defineProps({ capacity: { type: Object, required: true } })

const COHORTS = [
  { key: 'MEN', label: 'Men' },
  { key: 'WOMEN', label: 'Women' },
]
</script>

<template>
  <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
    <div v-for="c in COHORTS" :key="c.key" class="bg-card rounded-md border p-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-sm font-medium">
          <Badge variant="outline" class="text-[10px] uppercase tracking-wider">
            {{ c.label }}
          </Badge>
          <span class="tabular-nums">
            {{ capacity[c.key].occupied }} of {{ capacity[c.key].usable }} beds
          </span>
        </span>
        <span class="text-muted-foreground text-xs tabular-nums">
          {{ capacity[c.key].free }} free
        </span>
      </div>

      <!-- Occupied solid, free a dashed outline, out of service hatched warning. -->
      <div class="bg-muted flex h-2 gap-0.5 overflow-hidden rounded-[3px]">
        <span v-if="capacity[c.key].occupied" class="bg-primary block h-full"
              :style="{ flex: capacity[c.key].occupied }" />
        <span v-if="capacity[c.key].free"
              class="border-muted-foreground block h-full rounded-[2px] border border-dashed"
              :style="{ flex: capacity[c.key].free }" />
        <span v-if="capacity[c.key].outOfService" class="bg-warning/25 block h-full"
              :style="{
                flex: capacity[c.key].outOfService,
                backgroundImage:
                  'repeating-linear-gradient(135deg, var(--warning) 0 3px, transparent 3px 6px)',
              }" />
      </div>

      <p class="mt-2 text-xs" :class="capacity[c.key].free === 0 ? 'text-warning' : 'text-muted-foreground'">
        <template v-if="capacity[c.key].free === 0">Full</template>
        <template v-else>
          {{ capacity[c.key].free }} bed{{ capacity[c.key].free === 1 ? '' : 's' }} available
        </template>
        <template v-if="capacity[c.key].outOfService">
          · {{ capacity[c.key].outOfService }} out of service
        </template>
      </p>
    </div>
  </div>
</template>
