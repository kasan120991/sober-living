<script setup>
import { ChevronRight } from '@lucide/vue'

defineProps({
  apartments: { type: Array, default: () => [] },
  /** Soft-deleted apartments. Populated only for admins — the parent guards. */
  removed: { type: Array, default: () => [] },
  pending: { type: Boolean, default: false },
  selectedId: { type: String, default: null },
})

const { restoreApartment } = useApartments()
const notify = useNotify()
const refresh = inject('refreshApartments', () => {})

const busy = ref(null)

async function restore(a) {
  busy.value = a.id
  try {
    await restoreApartment(a.id)
    notify.success(`${a.name} restored`)
    await refresh()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not restore the apartment.')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div v-if="pending" class="text-muted-foreground p-4 text-sm">Loading…</div>

  <template v-else>
    <div v-if="!apartments.length" class="p-6">
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

    <!-- Removal is soft, and this is the way back. Rendered even when the live
         list is empty — a facility whose every apartment was removed is exactly
         when restore matters most. -->
    <template v-if="removed.length">
      <p
        class="text-muted-foreground border-b px-4 pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase"
      >
        Removed
      </p>
      <ul class="flex flex-col">
        <li
          v-for="a in removed"
          :key="a.id"
          class="flex min-h-[52px] items-center justify-between gap-3 border-b px-4 py-2"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground truncate text-sm font-medium">{{ a.name }}</span>
              <Badge
                variant="outline"
                class="text-muted-foreground text-[10px] uppercase tracking-wider"
              >
                {{ a.cohort === 'MEN' ? 'Men' : 'Women' }}
              </Badge>
            </div>
            <p class="text-muted-foreground/70 mt-0.5 text-xs tabular-nums">
              {{ a.bedCount }} bed{{ a.bedCount === 1 ? '' : 's' }} held
            </p>
          </div>
          <Button variant="outline" size="sm" :disabled="busy === a.id" @click="restore(a)">
            Restore
          </Button>
        </li>
      </ul>
    </template>
  </template>
</template>
