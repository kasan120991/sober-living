<script setup>
import { isoDate } from '~/composables/useResidents.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const { user } = useAuth()
const { listResidents } = useResidents()

const residents = ref([])
const capacity = ref(null)
const unhoused = ref([])
const pending = ref(true)
const query = ref('')
const showDischarged = ref(false)

const canIntake = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

async function load() {
  pending.value = true
  const data = await listResidents(showDischarged.value)
  residents.value = data.residents
  capacity.value = data.capacity
  unhoused.value = data.unhoused
  pending.value = false
}
await load()
watch(showDischarged, load)

// Filtered client-side: the roster is a facility, not a dataset. If it ever
// outgrows that, this becomes a query parameter.
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return residents.value
  return residents.value.filter((r) => r.fullName.toLowerCase().includes(q))
})

const total = computed(() => residents.value.length)

const COLUMNS = ['Resident', 'Cohort', 'Bed', 'Phase', 'Intake', 'Expected out', 'Day']
</script>

<template>
  <AppPage title="Residents">
    <template #actions>
      <AppResidentIntake v-if="canIntake" @intaken="load" />
    </template>

    <div class="flex flex-col gap-4">
      <!-- Capacity is always present; the alert appears only when someone is
           unhoused, and names the free bed rather than only the problem. -->
      <AppCohortCapacity v-if="capacity" :capacity="capacity" />
      <AppUnhousedAlert :unhoused="unhoused" @assigned="load" />

      <div class="flex flex-wrap items-center gap-3">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search by name"
          class="w-full sm:w-64"
        />
        <USwitch v-model="showDischarged" label="Include discharged" />
        <span class="ms-auto text-xs text-[var(--color-mute)]">
          <span class="tabular-nums">{{ total }}</span> shown
        </span>
      </div>

      <p v-if="pending" class="text-sm text-[var(--color-mute)]">Loading…</p>

      <div
        v-else
        class="overflow-hidden rounded-[var(--ui-radius)] border border-[var(--color-hairline)]"
      >
        <!-- Seven columns is wide, so the table scrolls inside its own container
             rather than letting the page scroll sideways. -->
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th
                  v-for="h in COLUMNS"
                  :key="h"
                  class="whitespace-nowrap border-b border-[var(--color-hairline)] bg-[var(--color-elevated)] px-3 py-2 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-mute)]"
                >
                  {{ h }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in filtered" :key="r.id" class="bg-[var(--color-elevated)]">
                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3">
                  <NuxtLink
                    :to="`/residents/${r.id}`"
                    class="font-medium text-[var(--color-ink)] hover:underline"
                  >
                    {{ r.lastName }}, {{ r.firstName }}
                  </NuxtLink>
                </td>

                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3">
                  <span
                    class="rounded-[3px] border border-[var(--color-hairline)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-body)]"
                  >
                    {{ r.cohort === 'MEN' ? 'Men' : 'Women' }}
                  </span>
                </td>

                <!-- "No bed" is the one exception state on this screen, so it is
                     the only thing here that gets colour. design.md §4. -->
                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3">
                  <span v-if="r.bed" class="font-mono text-[12.5px] text-[var(--color-ink)]">
                    {{ r.bed.apartmentName }} · {{ r.bed.label }}
                  </span>
                  <span
                    v-else-if="r.status === 'ACTIVE'"
                    class="inline-flex items-center rounded-full border border-[rgba(245,166,35,.35)] bg-[var(--color-warning-soft)] px-2 py-0.5 text-xs text-[var(--color-warning-deep)]"
                  >
                    No bed
                  </span>
                  <span v-else class="text-[var(--color-faint)]">—</span>
                </td>

                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12px]">
                  {{ r.program?.name ?? '—' }}
                </td>
                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12.5px] tabular-nums">
                  {{ isoDate(r.intakeAt) ?? '—' }}
                </td>
                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12.5px] tabular-nums">
                  {{ isoDate(r.expectedDischargeAt) ?? '—' }}
                </td>
                <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12.5px] tabular-nums">
                  <span v-if="r.status === 'ACTIVE'">{{ r.dayOfStay }}</span>
                  <span v-else class="text-[var(--color-faint)]">discharged</span>
                </td>
              </tr>

              <tr v-if="!filtered.length">
                <td
                  :colspan="COLUMNS.length"
                  class="bg-[var(--color-elevated)] px-3 py-8 text-center text-sm text-[var(--color-mute)]"
                >
                  {{ query ? `No resident matching “${query}”.` : 'No residents yet.' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </AppPage>
</template>
