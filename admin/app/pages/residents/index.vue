<script setup>
import { Ellipsis } from '@lucide/vue'
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

// Presentation only. Every route behind these actions is gated server-side by
// the same pair — see `managers` in server/src/routes/residents.js.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const { refresh: refreshNotifications } = useNotifications()

async function load() {
  pending.value = true
  const data = await listResidents(showDischarged.value)
  residents.value = data.residents
  capacity.value = data.capacity
  unhoused.value = data.unhoused
  pending.value = false

  // The bell only refreshes on navigation, and on this screen you never
  // navigate — so assigning a bed used to leave a stale "no bed" notification,
  // and releasing one used to not create the notification it should. Not
  // awaited: the table must never wait on the bell, and refresh() swallows its
  // own errors.
  refreshNotifications()
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

// Objects rather than strings, because `filter(Boolean)` silently drops an
// empty-string header — which is how AppBedTable labels its actions column. A
// dropped header means a th short and a colspan off by one, with nothing to
// show for it in the markup.
const columns = computed(() =>
  [
    { key: 'name', label: 'Resident' },
    showCohortColumn.value ? { key: 'cohort', label: 'Cohort' } : null,
    { key: 'bed', label: 'Bed' },
    { key: 'phase', label: 'Phase' },
    { key: 'intake', label: 'Intake' },
    { key: 'day', label: 'Day' },
    { key: 'balance', label: 'Balance', align: 'end' },
    canManage.value ? { key: 'actions', label: 'Actions', srOnly: true, align: 'end' } : null,
  ].filter(Boolean),
)

// ── Row actions ─────────────────────────────────────────────────────────────
// One dialog per table, not per row, each driven by a row ref — the same shape
// AppBedTable uses. Reka renders DropdownMenuContent lazily, so twenty rows
// mount twenty triggers and no menu bodies.
const bedFor = ref(null)
const releaseFor = ref(null)
const payFor = ref(null)
const dischargeFor = ref(null)

// No clear-then-refetch helper: each dialog emits `update:open false` before its
// done event, and the @update:open handler below already nulls the row ref. A
// helper taking the ref would receive the unwrapped value in a template — and by
// then it is null.

const shownCapacity = computed(() => {
  if (!capacity.value) return []
  const keys = cohort.value === 'ALL' || searching.value ? ['MEN', 'WOMEN'] : [cohort.value]
  return keys.map((k) => ({ key: k, label: k === 'MEN' ? 'Men' : 'Women', ...capacity.value[k] }))
})
</script>

<template>
  <AppPage title="Residents">
    <template #description>
      <span class="tabular-nums">{{ counts.ALL }}</span> in the house across two cohorts.
      <template v-if="unhoused.length">
        <span class="tabular-nums">{{ unhoused.length }}</span> awaiting placement.
      </template>
      <template v-else>Everyone has a bed.</template>
    </template>
    <template #actions>
      <AppResidentIntake v-if="canManage" @intaken="load" />
    </template>

    <!-- min-w-0: a flex child defaults to min-width:auto, which lets the table
         push this column wider than the viewport. -->
    <div class="flex min-w-0 flex-col gap-4">
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
                  v-for="c in columns"
                  :key="c.key"
                  class="border-border bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-[0.1em] whitespace-nowrap uppercase"
                  :class="c.align === 'end' && 'text-right'"
                >
                  <span :class="c.srOnly && 'sr-only'">{{ c.label }}</span>
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

                <!-- Same shape as AppBedTable: ghost ellipsis, menu aligned to
                     the end. Discharged rows keep the trigger but offer only
                     the record — an empty cell reads as broken. -->
                <td v-if="canManage" class="border-border h-12 border-b px-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="sm"
                        :aria-label="`Actions for ${r.fullName}`"
                      >
                        <Ellipsis class="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-52">
                      <DropdownMenuItem as-child>
                        <NuxtLink :to="`/residents/${r.id}`">Open record</NuxtLink>
                      </DropdownMenuItem>

                      <template v-if="r.status === 'ACTIVE'">
                        <DropdownMenuSeparator />
                        <DropdownMenuItem @select="bedFor = r">
                          {{ r.bed ? 'Move bed…' : 'Assign a bed…' }}
                        </DropdownMenuItem>
                        <DropdownMenuItem v-if="r.bed" @select="releaseFor = r">
                          Release bed
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="payFor = r">Record a payment…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem class="text-destructive" @select="dischargeFor = r">
                          Discharge…
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenuContent>
                  </DropdownMenu>
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

    <!-- Siblings of the table, never inside a cell. Each is bound to a row ref
         so there is one instance per table rather than one per row. -->
    <AppResidentBedDialog
      :open="Boolean(bedFor)"
      :resident-id="bedFor?.id"
      :resident-name="bedFor?.fullName"
      :cohort="bedFor?.cohort"
      :has-bed="Boolean(bedFor?.bed)"
      @update:open="(v) => !v && (bedFor = null)"
      @assigned="load"
    />

    <AppResidentReleaseBedDialog
      :open="Boolean(releaseFor)"
      :resident-id="releaseFor?.id"
      :resident-name="releaseFor?.fullName"
      :bed-label="releaseFor?.bed ? `${releaseFor.bed.apartmentName} · ${releaseFor.bed.label}` : ''"
      @update:open="(v) => !v && (releaseFor = null)"
      @released="load"
    />

    <!-- defaultType PAYMENT: taking money against a balance is the reason to
         reach for this from a list. balanceCents comes from the row, so the
         dialog fetches nothing. -->
    <AppLedgerEntryDialog
      :open="Boolean(payFor)"
      :resident-id="payFor?.id"
      :resident-name="payFor?.fullName"
      :balance-cents="payFor?.balanceCents"
      default-type="PAYMENT"
      @update:open="(v) => !v && (payFor = null)"
      @posted="load"
    />

    <AppResidentDischargeDialog
      :open="Boolean(dischargeFor)"
      :resident-id="dischargeFor?.id"
      :resident-name="dischargeFor?.fullName"
      @update:open="(v) => !v && (dischargeFor = null)"
      @discharged="load"
    />
  </AppPage>
</template>
