<script setup>
// The resident record's Attendance section. READ-ONLY — rolls are taken on the
// schedule board, the same split every other rail section keeps.
//
// ── Counts band over a day-grouped trail (variant A, chosen 2026-08-08 from
// three rendered variants; a per-group breakdown and an eight-week grid were
// the others) ── it is the shape Apartment checks and Medications already use,
// so the rail reads the same the whole way down, and a record section is
// usually opened by somebody who came for a different reason.
//
// What that costs, accepted knowingly: it shows a LIST, not a SHAPE. Three
// absences in a row and three spread across a month look alike until you read
// the dates, and the pattern is often the thing worth noticing. If the house
// wants that, the fallback is the grid variant — but attendance here is a few
// sessions a week, which is too sparse for a grid to earn its space.
//
// THE DIARY IS GONE (2026-08-08). This section no longer answers "what is this
// person scheduled for" — /schedule owns the events and answers that. Renaming
// it from Schedule is what makes the section honest about which of the two
// questions it takes.
import { attendanceDisplay, toneClass } from '~/utils/schedule.js'
import { humanDate } from '~/utils/facilityTime.js'

const props = defineProps({
  residentId: { type: String, required: true },
})

const { getResidentAttendance } = useSchedule()

const data = ref(null) // page-1 response — carries the summary
const marks = ref([]) // accumulated across Load more
const nextCursor = ref(null)
const pending = ref(true)
const loadingMore = ref(false)

async function load() {
  pending.value = !data.value
  const res = await getResidentAttendance(props.residentId)
  data.value = res
  // A refetch resets to page one on purpose — the newest mark is the point of
  // refetching, and the summary comes back with it.
  marks.value = res.marks
  nextCursor.value = res.nextCursor
  pending.value = false
}
await load()
onRealtimeChanged(load)

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await getResidentAttendance(props.residentId, { cursor: nextCursor.value })
    marks.value = [...marks.value, ...res.marks]
    nextCursor.value = res.nextCursor
  } finally {
    loadingMore.value = false
  }
}

const hasActiveStay = computed(() => data.value?.hasActiveStay !== false)
// Computed on the SERVER over the whole stay, never from the loaded rows. See
// residentAttendance() — counting `marks` here would describe page one while
// the heading claims to describe the stay, and would shrink as you scrolled.
const summary = computed(() => data.value?.summary ?? null)

/** Order-preserving day grouping, so a day spanning a page boundary continues
 *  under its existing header when Load more appends. */
const byDay = computed(() => {
  const out = []
  for (const m of marks.value) {
    if (out.at(-1)?.key !== m.date) out.push({ key: m.date, marks: [] })
    out.at(-1).marks.push(m)
  }
  return out
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading attendance…</p>

    <p v-else-if="!hasActiveStay" class="text-muted-foreground text-sm">
      No active stay. Attendance belongs to the stay it was recorded on, so a returning
      resident starts a fresh record.
    </p>

    <template v-else>
      <!-- ── The counts ─────────────────────────────────────────────────────
           Hidden entirely when nothing has been recorded. A 0-of-0 bar reads as
           a failing grade rather than as an absence of information. -->
      <section v-if="summary" class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          This stay
        </h2>
        <div class="bg-card rounded-md border p-4">
          <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <!-- Counts, never a percentage: "31 of 38" carries its own sample
                 size where "82%" implies a measurement. -->
            <span class="text-xl leading-none font-semibold tabular-nums">
              {{ summary.attended }}
            </span>
            <span class="text-muted-foreground text-sm">
              of {{ summary.total }} {{ summary.total === 1 ? 'roll' : 'rolls' }} attended
            </span>
            <Badge
              v-if="summary.absent"
              variant="outline"
              class="border-destructive/40"
              :class="toneClass('destructive')"
            >
              {{ summary.absent }} absent
            </Badge>
            <Badge
              v-if="summary.excused"
              variant="outline"
              class="border-warning/45"
              :class="toneClass('warning')"
            >
              {{ summary.excused }} excused
            </Badge>
            <span v-if="summary.since" class="text-muted-foreground ms-auto text-xs">
              since {{ humanDate(summary.since, { short: true, relative: false }) }}
            </span>
          </div>

          <!-- The h-2 flex track from AppServiceProgress / AppCohortCapacity,
               rather than shadcn's Progress — that one is single-value, and
               adding it rewrites main.css and restores the Google-Fonts CDN
               imports CLAUDE.md forbids. Zero-weight segments are omitted, not
               rendered at flex:0, which would still leave a gap. -->
          <div class="bg-muted mt-3 flex h-2 gap-0.5 overflow-hidden rounded-[3px]">
            <span
              v-if="summary.bars.attended"
              class="bg-success block h-full"
              :style="{ flex: summary.bars.attended }"
            />
            <span
              v-if="summary.bars.excused"
              class="bg-warning block h-full"
              :style="{ flex: summary.bars.excused }"
            />
            <span
              v-if="summary.bars.absent"
              class="bg-destructive block h-full"
              :style="{ flex: summary.bars.absent }"
            />
          </div>
        </div>
      </section>

      <!-- ── The trail ──────────────────────────────────────────────────── -->
      <section class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Marks
        </h2>

        <p v-if="!marks.length" class="text-muted-foreground text-sm">
          No attendance recorded yet.
        </p>

        <div v-else class="flex flex-col gap-4">
          <div v-for="day in byDay" :key="day.key">
            <p class="text-muted-foreground mb-1 text-xs">{{ humanDate(day.key) }}</p>
            <!-- A list, not a table. Four columns for four short facts made the
                 note — the only prose here, and the part a review actually
                 reads — the narrowest cell on the row. -->
            <div class="overflow-hidden rounded-md border">
              <div
                v-for="a in day.marks"
                :key="a.id"
                class="bg-card flex min-h-12 items-center gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13.5px]">{{ a.title }}</span>
                  <span class="text-muted-foreground block truncate text-[11px]">
                    <template v-if="a.note">{{ a.note }} · </template>
                    recorded by {{ a.recordedBy?.fullName ?? 'staff' }}
                  </span>
                </span>
                <Badge
                  variant="outline"
                  class="shrink-0 text-[10px]"
                  :class="toneClass(attendanceDisplay(a.status).tone)"
                >
                  {{ attendanceDisplay(a.status).label }}
                </Badge>
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

        <p class="text-muted-foreground text-xs">
          A resident's attendance is the rolls taken on events they are an attendee of.
          Rolls are taken and corrected on the
          <NuxtLink to="/schedule" class="underline underline-offset-2">schedule</NuxtLink>.
        </p>
      </section>
    </template>
  </div>
</template>
