<script setup>
import { isoDate } from '~/composables/useResidents.js'
import { money, inCredit } from '~/utils/money.js'
import { STAFF_ROLE } from '~/utils/roles.js'

// Segmented by cohort, because the separation is structural rather than a
// preference: an apartment serves one cohort and Postgres refuses a resident
// placed in the wrong one. A screen that mixes the two and then adds a Cohort
// column is describing a facility that does not exist.
const COHORTS = [
  { key: 'ALL', label: 'All' },
  { key: 'MEN', label: 'Men' },
  { key: 'WOMEN', label: 'Women' },
]

const { user } = useAuth()
const { listResidents } = useResidents()

const residents = ref([])
const capacity = ref(null)
const unhoused = ref([])
const pending = ref(true)
const query = ref('')
const showDischarged = ref(false)
const cohort = ref('ALL')

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

const counts = computed(() => ({
  ALL: residents.value.length,
  MEN: residents.value.filter((r) => r.cohort === 'MEN').length,
  WOMEN: residents.value.filter((r) => r.cohort === 'WOMEN').length,
}))

// Filtered client-side: the roster is a facility, not a dataset. If it ever
// outgrows that, this becomes a query parameter.
//
// Search deliberately ignores the segment. Typing a name and getting nothing
// because the person is in the other cohort is the kind of answer that sends
// someone back to a paper binder.
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (q) return residents.value.filter((r) => r.fullName.toLowerCase().includes(q))
  if (cohort.value === 'ALL') return residents.value
  return residents.value.filter((r) => r.cohort === cohort.value)
})

const searching = computed(() => query.value.trim().length > 0)

// Inside a cohort segment the Cohort column would be one value repeated down
// the page. It earns its place only on All, or when a search has crossed both.
const showCohortColumn = computed(() => cohort.value === 'ALL' || searching.value)

const columns = computed(() =>
  [
    'Resident',
    showCohortColumn.value ? 'Cohort' : null,
    'Bed',
    'Phase',
    'Intake',
    'Day',
    'Balance',
  ].filter(Boolean),
)

const shownCapacity = computed(() => {
  if (!capacity.value) return []
  const keys = cohort.value === 'ALL' || searching.value ? ['MEN', 'WOMEN'] : [cohort.value]
  return keys.map((k) => ({ key: k, label: k === 'MEN' ? 'Men' : 'Women', ...capacity.value[k] }))
})
</script>

<template>
  <AppPage title="Residents">
    <div class="flex flex-col gap-4">
      <AppPageHeading title="Residents">
        <template #description>
          <span class="tabular-nums">{{ counts.ALL }}</span> in the house across two cohorts.
          <template v-if="unhoused.length">
            <span class="tabular-nums">{{ unhoused.length }}</span>
            awaiting placement.
          </template>
          <template v-else>Everyone has a bed.</template>
        </template>
        <template #actions>
          <AppResidentIntake v-if="canIntake" @intaken="load" />
        </template>
      </AppPageHeading>

      <div class="flex flex-wrap items-center gap-3">
        <Tabs v-model="cohort">
          <TabsList>
            <TabsTrigger v-for="c in COHORTS" :key="c.key" :value="c.key">
              {{ c.label }}
              <span class="text-muted-foreground ms-1.5 tabular-nums">{{ counts[c.key] }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Input v-model="query" placeholder="Search by name" class="w-full sm:w-56" />

        <div class="flex items-center gap-2">
          <Switch id="discharged" v-model="showDischarged" />
          <Label for="discharged" class="font-normal">Include discharged</Label>
        </div>
      </div>

      <!-- Capacity belongs to the cohort you are looking at, so it sits with
           the segment rather than floating above both as a pair of cards. -->
      <AppCohortCapacity v-if="shownCapacity.length" :cohorts="shownCapacity" />

      <AppUnhousedAlert :unhoused="unhoused" @assigned="load" />

      <p v-if="searching" class="text-muted-foreground text-xs">Searching across both cohorts.</p>

      <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

      <div v-else class="border-border overflow-hidden rounded-md border">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th
                  v-for="h in columns"
                  :key="h"
                  class="border-border bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-[0.1em] whitespace-nowrap uppercase"
                  :class="h === 'Balance' && 'text-right'"
                >
                  {{ h }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in filtered" :key="r.id" class="bg-card">
                <td class="border-border h-12 border-b px-3 whitespace-nowrap">
                  <NuxtLink
                    :to="`/residents/${r.id}`"
                    class="text-foreground font-medium hover:underline"
                  >
                    {{ r.lastName }}, {{ r.firstName }}
                  </NuxtLink>
                </td>

                <td v-if="showCohortColumn" class="border-border h-12 border-b px-3 whitespace-nowrap">
                  <Badge variant="outline" class="tracking-wider text-[10px] uppercase">
                    {{ r.cohort === 'MEN' ? 'Men' : 'Women' }}
                  </Badge>
                </td>

                <!-- "No bed" is an exception state, so it is one of the two
                     things on this screen that gets colour. -->
                <td class="border-border h-12 border-b px-3 whitespace-nowrap">
                  <span v-if="r.bed" class="text-foreground">
                    {{ r.bed.apartmentName }} · {{ r.bed.label }}
                  </span>
                  <Badge
                    v-else-if="r.status === 'ACTIVE'"
                    variant="outline"
                    class="border-warning/40 bg-warning/15 text-warning"
                    >No bed</Badge
                  >
                  <span v-else class="text-muted-foreground/60">—</span>
                </td>

                <td class="border-border h-12 border-b px-3 whitespace-nowrap">
                  {{ r.program?.name ?? '—' }}
                </td>
                <td class="border-border h-12 border-b px-3 tabular-nums whitespace-nowrap">
                  {{ isoDate(r.intakeAt) ?? '—' }}
                </td>
                <td class="border-border h-12 border-b px-3 tabular-nums whitespace-nowrap">
                  <span v-if="r.status === 'ACTIVE'">{{ r.dayOfStay }}</span>
                  <span v-else class="text-muted-foreground/60">discharged</span>
                </td>

                <!-- Right-aligned and tabular so the column can be scanned for
                     magnitude. Deliberately no threshold colouring: "how far
                     behind is too far" is facility policy and is not set yet. -->
                <td
                  class="border-border h-12 border-b px-3 text-right tabular-nums whitespace-nowrap"
                >
                  <span
                    v-if="r.balanceCents != null"
                    :class="
                      r.balanceCents === 0
                        ? 'text-muted-foreground'
                        : inCredit(r.balanceCents)
                          ? 'text-success'
                          : 'text-foreground'
                    "
                  >
                    {{ money(r.balanceCents) }}
                  </span>
                  <span v-else class="text-muted-foreground/60">—</span>
                </td>
              </tr>

              <tr v-if="!filtered.length">
                <td
                  :colspan="columns.length"
                  class="bg-card text-muted-foreground px-3 py-8 text-center text-sm"
                >
                  {{ query ? `No resident matching “${query}”.` : 'Nobody in this cohort.' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </AppPage>
</template>
