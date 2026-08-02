<script setup>
import { ChevronRight } from '@lucide/vue'

defineProps({
  apartments: { type: Array, default: () => [] },
  pending: { type: Boolean, default: false },
  selectedId: { type: String, default: null },
})
</script>

<template>
  <div v-if="pending" class="text-muted-foreground p-4 text-sm">Loading…</div>

  <div v-else-if="!apartments.length" class="p-6">
    <p class="text-muted-foreground text-sm">
      No apartments yet. Add one to start assigning beds.
    </p>
  </div>

  <ul v-else class="flex flex-col">
    <li v-for="a in apartments" :key="a.id">
      <NuxtLink
        :to="`/apartments/${a.id}`"
        class="hover:bg-accent flex min-h-[60px] items-center justify-between gap-3 border-b px-4 py-2.5 transition-colors"
        :class="selectedId === a.id && 'bg-accent shadow-[inset_2px_0_0_var(--primary)]'"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ a.name }}</span>
            <!-- Cohort is structural, not a status: a quiet outlined chip, never
                 a colour competing with a genuine exception. -->
            <Badge variant="outline" class="text-[10px] uppercase tracking-wider">
              {{ a.cohort === 'MEN' ? 'Men' : 'Women' }}
            </Badge>
          </div>
          <p class="text-muted-foreground mt-0.5 text-xs">
            <span class="tabular-nums">{{ a.occupiedCount }} of {{ a.bedCount }}</span> occupied
            <template v-if="a.outOfServiceCount">
              · <span class="text-warning">{{ a.outOfServiceCount }} out</span>
            </template>
          </p>
        </div>
        <ChevronRight class="text-muted-foreground/60 size-4 shrink-0" aria-hidden="true" />
      </NuxtLink>
    </li>
  </ul>
</template>
