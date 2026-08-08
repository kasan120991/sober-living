<script setup>
// The resident record's Medications section. READ-ONLY, deliberately — the
// record answers what this person is on and how their doses have gone;
// recording, amending and changing the list live on /meds, the same split the
// Schedule, Apartment checks and Drug screens sections keep.
//
// ── The list, then the day-grouped trail ── the standing instructions first,
// because "what is he on" is the question a record page is opened to answer,
// then every dose newest-first grouped by facility day, keyset-paginated
// because three medications write six rows a day and this trail only grows.
//
// MEDICATIONS ARE NAMED HERE, unlike anywhere on the med pass board. That is
// the same exception module 5 makes for screen results on the record and it has
// the same justification: a record page is a deliberate navigation to ONE named
// person somebody already chose, and the audit log records it at that grain. On
// the board, which lists the whole house at once, it would not be.
//
// NO RAIL DOT, also deliberately — AppResidentScreens' rule. A dot on a Clinical
// section is an ambient clinical signal on every screen that draws the rail, and
// an unmarked dose is the med pass board's business, not this pane's.
import { Ellipsis, Plus } from '@lucide/vue'
import { toneClass } from '~/utils/schedule.js'
import { doseLine, medStateDisplay } from '~/utils/meds.js'
import { STAFF_ROLE } from '~/utils/roles.js'
import { facilityDateOf, formatFacilityTime, formatWallClock, humanDate } from '~/utils/facilityTime.js'

const props = defineProps({
  residentId: { type: String, required: true },
})

const { getResidentMeds, deleteMedication } = useMeds()
const { user } = useAuth()
const notify = useNotify()

// Presentation only. The routes are managers-only server-side and refuse a tech
// regardless — this just stops offering a button that would always 403.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

// One dialog per section driven by a row ref, never one per row — the
// AppBedTable rule.
const editOpen = ref(false)
const endOpen = ref(false)
const active = ref(null)

function openAdd() {
  active.value = null
  editOpen.value = true
}
function openEdit(m) {
  active.value = m
  editOpen.value = true
}
function openEnd(m) {
  active.value = m
  endOpen.value = true
}

async function remove(m) {
  try {
    await deleteMedication(m.id)
    notify.success(`${m.name} removed`)
    await load()
  } catch (err) {
    // The 409 here is the good one: it means doses exist and the record is
    // being protected. Surface the server's own sentence, which says so.
    notify.error(err?.data?.error ?? 'Could not remove this medication.')
  }
}

const data = ref(null) // page-1 response — carries the medication list
const logs = ref([]) // accumulated across Load more
const nextCursor = ref(null)
const date = ref('') // '' = the paginated trail; a date = one facility day
const pending = ref(true)
const loadingMore = ref(false)

async function load() {
  pending.value = !data.value
  const res = await getResidentMeds(props.residentId, { date: date.value || undefined })
  data.value = res
  // A refetch resets to page one on purpose — the newest dose is the point.
  logs.value = res.logs
  nextCursor.value = res.nextCursor
  pending.value = false
}
await load()
onRealtimeChanged(load)
watch(date, load)

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await getResidentMeds(props.residentId, { cursor: nextCursor.value })
    logs.value = [...logs.value, ...res.logs]
    nextCursor.value = res.nextCursor
  } finally {
    loadingMore.value = false
  }
}

const hasActiveStay = computed(() => data.value?.hasActiveStay !== false)
const medications = computed(() => data.value?.medications ?? [])
const standing = computed(() => medications.value.filter((m) => !m.endsOn))
const stopped = computed(() => medications.value.filter((m) => m.endsOn))

/** Order-preserving day grouping, so a day spanning a page boundary continues
 *  under its existing header when Load more appends. */
const byDay = computed(() => {
  const out = []
  for (const l of logs.value) {
    const key = facilityDateOf(l.recordedAt)
    if (out.at(-1)?.key !== key) out.push({ key, logs: [] })
    out.at(-1).logs.push(l)
  }
  return out
})

/** The schedule as words: "8:00 AM, 8:00 PM" or "As needed". */
const scheduleOf = (m) =>
  m.isPrn ? 'As needed' : m.times.map(formatWallClock).join(', ')
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading medications…</p>

    <p v-else-if="!hasActiveStay" class="text-muted-foreground text-sm">
      This resident has no active stay. Medications belong to the stay they were
      recorded on, so a returning resident starts a fresh list.
    </p>

    <template v-else>
      <!-- Managers only; a tech sees the list and no controls. -->
      <AppMedicationDialog
        v-model:open="editOpen"
        :resident-id="residentId"
        :medication="active"
        @saved="load"
      />
      <AppMedicationEndDialog v-model:open="endOpen" :medication="active" @saved="load" />

      <!-- ── The standing instructions ─────────────────────────────────── -->
      <section>
        <div class="mb-2 flex items-center gap-2">
          <p class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Current medications
          </p>
          <Button v-if="canManage" variant="outline" size="sm" class="ms-auto" @click="openAdd">
            <Plus class="size-4" /> Add medication
          </Button>
        </div>

        <p v-if="!standing.length" class="text-muted-foreground text-sm">
          No medications are on this resident’s list.
        </p>

        <div v-else class="flex flex-col gap-2">
          <div v-for="m in standing" :key="m.id" class="bg-card rounded-md border px-4 py-3">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="text-[14px] font-medium">{{ m.name }}</span>
              <span class="text-muted-foreground text-xs">{{ doseLine(m) }}</span>
              <span class="text-muted-foreground ms-auto text-xs tabular-nums">
                {{ scheduleOf(m) }}
              </span>
              <DropdownMenu v-if="canManage">
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-sm" :aria-label="`Actions for ${m.name}`">
                    <Ellipsis class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-52">
                  <DropdownMenuItem @select="openEdit(m)">Edit…</DropdownMenuItem>
                  <DropdownMenuItem @select="openEnd(m)">Discontinue…</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <!-- Offered because a medication added in error is a real
                       case. The server refuses once any dose exists, and that
                       refusal is surfaced verbatim. -->
                  <DropdownMenuItem variant="destructive" @select="remove(m)">
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p v-if="m.prescriber || m.pharmacy" class="text-muted-foreground mt-1 text-xs">
              {{ [m.prescriber, m.pharmacy].filter(Boolean).join(' · ') }}
            </p>
          </div>
        </div>
      </section>

      <!-- Kept visible rather than hidden: a medication somebody was on until
           last week is exactly what a case manager or a prescriber asks about. -->
      <section v-if="stopped.length">
        <p class="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
          Discontinued
        </p>
        <div class="flex flex-col gap-2">
          <div v-for="m in stopped" :key="m.id" class="rounded-md border px-4 py-3">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="text-muted-foreground text-[14px] line-through">{{ m.name }}</span>
              <span class="text-muted-foreground text-xs">{{ doseLine(m) }}</span>
              <span class="text-muted-foreground ms-auto text-xs">
                Ended {{ humanDate(facilityDateOf(m.endsOn), { short: true, relative: false }) }}
              </span>
            </div>
            <p v-if="m.endReason" class="text-muted-foreground mt-1 text-xs">{{ m.endReason }}</p>
          </div>
        </div>
      </section>

      <!-- ── The dose trail ────────────────────────────────────────────── -->
      <section>
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <p class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Doses
          </p>
          <div class="ms-auto flex items-center gap-2">
            <Input v-model="date" type="date" class="h-8 w-40 text-xs" aria-label="Show one day" />
            <Button v-if="date" variant="ghost" size="sm" @click="date = ''">Clear</Button>
          </div>
        </div>

        <p v-if="!logs.length" class="text-muted-foreground text-sm">
          <template v-if="date">Nothing was recorded on this day.</template>
          <template v-else>No doses have been recorded yet.</template>
        </p>

        <div v-else class="flex flex-col gap-4">
          <div v-for="day in byDay" :key="day.key">
            <p class="text-muted-foreground mb-1 text-xs">{{ humanDate(day.key) }}</p>
            <div class="flex flex-col">
              <div
                v-for="l in day.logs"
                :key="l.id"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
              >
                <!-- The slot the dose answers, not when it was typed. An
                     as-needed dose answers none, so it says so. -->
                <span class="w-16 shrink-0 text-[13px] tabular-nums">
                  {{ l.scheduledFor ? formatFacilityTime(l.scheduledFor) : 'PRN' }}
                </span>
                <!-- The SNAPSHOT, deliberately, not the medication's name
                     today: raising a dose next month must not restate what was
                     handed over last week. -->
                <span class="min-w-0 text-[13px]">{{ l.medicationName }}</span>
                <Badge
                  variant="outline"
                  class="shrink-0 border-transparent text-[10px]"
                  :class="toneClass(medStateDisplay(l.status).tone)"
                >
                  {{ medStateDisplay(l.status).short }}
                </Badge>
                <span v-if="l.note" class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                  {{ l.note }}
                </span>
                <span class="text-muted-foreground ms-auto shrink-0 text-xs">
                  {{ l.observedBy?.fullName }}
                  <Badge
                    v-if="l.amended"
                    variant="outline"
                    class="ms-1 text-[10px]"
                    :title="l.amendmentReason ?? undefined"
                  >
                    Amended
                  </Badge>
                </span>
              </div>
            </div>
          </div>

          <Button
            v-if="nextCursor"
            variant="outline"
            size="sm"
            class="self-start"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </Button>
        </div>
      </section>

      <p class="text-muted-foreground text-xs">
        Doses are recorded and corrected on the
        <NuxtLink to="/meds" class="underline underline-offset-2">med pass board</NuxtLink>.
      </p>
    </template>
  </div>
</template>
