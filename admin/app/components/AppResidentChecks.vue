<script setup>
// The resident record's Apartment checks section. READ-ONLY, deliberately —
// the record answers where this person was last seen and how the rounds have
// found them; recording and amending live on /checks, the same split the
// Schedule section keeps.
//
// ── Last seen, then the day-grouped trail (chosen 2026-08-06 from rendered
// variants) ── the hero answers the hallway question first, and it is LOUD
// exactly when the answer is "nobody could find them": the destructive card
// derives from the same server helper the bell's RESIDENT_NOT_ACCOUNTED item
// uses, so this pane and the bell cannot disagree. Below it, their check
// lines newest-first, grouped by facility day — date-filterable and
// keyset-paginated, because a 24/7 hourly round writes ~24 lines a day and
// this trail only ever grows.
import { toneClass } from '~/utils/schedule.js'
import {
  facilityDateOf,
  facilityHourKeyOf,
  formatFacilityTime,
  formatHourLabel,
  humanDate,
} from '~/utils/facilityTime.js'

const props = defineProps({
  residentId: { type: String, required: true },
})

const { getResidentChecks } = useChecks()

const data = ref(null) // page-1 response — carries the hero
const lines = ref([]) // accumulated across Load more
const nextCursor = ref(null)
const date = ref('') // '' = the paginated trail; a date = one facility day
const pending = ref(true)
const loadingMore = ref(false)

async function load() {
  pending.value = !data.value
  const res = await getResidentChecks(props.residentId, { date: date.value || undefined })
  data.value = res
  // A refetch (realtime or filter change) resets to page one on purpose —
  // the newest line is the point of refetching.
  lines.value = res.lines
  nextCursor.value = res.nextCursor
  pending.value = false
}
await load()
onRealtimeChanged(load)
watch(date, load)

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await getResidentChecks(props.residentId, { cursor: nextCursor.value })
    lines.value = [...lines.value, ...res.lines]
    nextCursor.value = res.nextCursor
  } finally {
    loadingMore.value = false
  }
}

const hasActiveStay = computed(() => data.value?.hasActiveStay !== false)
const status = computed(() => data.value?.status ?? null)

/** Order-preserving day grouping, so a day spanning a page boundary continues
 *  under its existing header when Load more appends. */
const byDay = computed(() => {
  const out = []
  for (const l of lines.value) {
    const key = facilityDateOf(l.checkedAt)
    if (out.at(-1)?.key !== key) out.push({ key, lines: [] })
    out.at(-1).lines.push(l)
  }
  return out
})

const STATUS_DISPLAY = {
  PRESENT: { label: 'Present', tone: 'success' },
  SIGNED_OUT: { label: 'Signed out', tone: 'muted' },
  NOT_FOUND: { label: 'Not found', tone: 'destructive' },
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <template v-else-if="!hasActiveStay">
      <p class="text-muted-foreground text-sm">
        No active stay, so no round covers them. Their check history belongs to the stay it
        was recorded on.
      </p>
    </template>

    <template v-else>
      <!-- ── The hero: where are they ─────────────────────────────────────── -->
      <section class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Last accounted for
        </h2>

        <Card
          v-if="status?.notAccounted" class="border-destructive shadow-[inset_3px_0_0_var(--destructive)]">
          <p class="text-destructive text-sm font-semibold">
            Not found at the
            {{ formatHourLabel(facilityHourKeyOf(status.notAccounted.checkedAt)) }} check
          </p>
          <p class="text-muted-foreground mt-0.5 text-[13px]">
            {{ status.notAccounted.apartmentName }} ·
            <span class="tabular-nums">{{ formatFacilityTime(status.notAccounted.checkedAt) }}</span>
            · by {{ status.notAccounted.byName }}
          </p>
          <p class="text-muted-foreground mt-1 text-xs">
            Flagged on the bell until a later check or a sign-out accounts for them.
          </p>
        </Card>

        <Card v-else-if="status?.lastSeen">
          <p class="text-sm font-semibold">
            Last seen
            <span class="tabular-nums">{{ formatFacilityTime(status.lastSeen.checkedAt) }}</span>
            <span class="text-muted-foreground font-normal">
              · {{ status.lastSeen.apartmentName }}</span
            >
          </p>
          <p class="mt-0.5 text-[13px]">{{ status.lastSeen.note }}</p>
          <p class="text-muted-foreground mt-0.5 text-xs">
            {{ humanDate(facilityDateOf(status.lastSeen.checkedAt)) }} · by
            {{ status.lastSeen.byName }}
          </p>
        </Card>

        <p v-else class="text-muted-foreground text-sm">
          No checks yet. They appear here as staff record the hourly rounds.
        </p>
      </section>

      <!-- ── The trail ────────────────────────────────────────────────────── -->
      <section class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            History
          </h2>
          <div class="ms-auto flex items-center gap-1.5">
            <Input v-model="date" type="date" class="h-8 w-40 text-xs" aria-label="Show one day" />
            <Button v-if="date" variant="ghost" size="sm" class="h-8 px-2 text-xs" @click="date = ''">
              Clear
            </Button>
          </div>
        </div>

        <p v-if="!lines.length && date" class="text-muted-foreground text-sm">
          No check lines on {{ humanDate(date) }} for this resident.
        </p>
        <p v-else-if="!lines.length" class="text-muted-foreground text-sm">
          No checks recorded on this stay yet.
        </p>

        <div v-else class="flex flex-col gap-3">
          <div v-for="day in byDay" :key="day.key">
            <p class="text-muted-foreground mb-1 text-xs font-medium">
              {{ humanDate(day.key, { short: true }) }}
            </p>
            <div class="flex flex-col">
              <div
                v-for="l in day.lines"
                :key="l.id"
                class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 py-2 text-sm last:border-b-0"
              >
                <span class="text-muted-foreground w-16 shrink-0 text-[13px] tabular-nums">
                  {{ formatFacilityTime(l.checkedAt) }}
                </span>
                <Badge
                  variant="outline"
                  class="border-transparent text-[10px]"
                  :class="toneClass(STATUS_DISPLAY[l.status].tone)"
                >
                  {{ STATUS_DISPLAY[l.status].label }}
                </Badge>
                <span v-if="l.note" class="min-w-0 text-[13px]">{{ l.note }}</span>
                <!-- Why they were out, never where. The server selects the
                     sign-out's `purpose` and deliberately never its
                     `destination` — see signOutPurposes() for the reasoning.
                     Absent purpose renders nothing rather than filler: most
                     sign-outs have none, and "no purpose given" would be noise
                     on the common case. -->
                <span
                  v-else-if="l.purpose"
                  class="text-muted-foreground min-w-0 text-[13px] italic"
                >
                  {{ l.purpose }}
                </span>
                <span class="text-muted-foreground/80 ms-auto text-xs">
                  {{ l.apartmentName }} · {{ l.byName
                  }}<span
                    v-if="l.amended"
                    class="text-muted-foreground ms-1.5 lowercase"
                    :title="l.amendmentReason ?? undefined"
                  >
                    · amended</span
                  >
                </span>
              </div>
            </div>
          </div>

          <Button
            v-if="nextCursor && !date"
            variant="ghost"
            class="w-full"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </Button>
        </div>

        <p class="text-muted-foreground text-xs">
          The hourly round as it found this resident — their lines only, current versions
          only. Checks are recorded and corrected on the
          <NuxtLink to="/checks" class="underline underline-offset-2">checks board</NuxtLink>.
        </p>
      </section>
    </template>
  </div>
</template>
