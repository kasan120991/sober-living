<script setup>
// The resident record's Schedule section. READ-ONLY, deliberately.
//
// The record answers what this person is scheduled for; the event itself is
// created and edited from /schedule. That split is what stops twelve module
// sections each growing their own editor.
//
// What this shows is a join through THEIR ATTENDEE ROWS — never a query on
// their cohort. The difference is visible in the empty state: a resident on
// nothing shows nothing, rather than everything the men's side happens to run.
//
// ── Three bands, in this order (chosen 2026-08-05 from three rendered variants)
// A one-line attendance check, the diary, then the history. Schedule-first,
// because the rail already carries a dot for what needs attention and Overview is
// defined as the needs-attention surface — so this section does not have to be
// where a review starts. What it uniquely answers is "what is this person
// scheduled for", and a day-grouped diary answers that better than anything else.
//
// The two rejected variants: a two-column split (bought the pane's width, but the
// phone breakpoint forces the ordering question anyway, so it costs two layouts
// to maintain), and record-first with a run of marks per session (the best idea of
// the three and the least ready — it needs months of history to be worth drawing,
// and is worth revisiting on top of this shape).
//
// ── The diary is FullCalendar's LIST VIEW ─────────────────────────────────────
// Not a hand-rolled day-grouped list. A `list` view IS a day-grouped agenda, and
// pulse themes it (`listDay*`, `listItemEvent*`, `noEvents*`), so this section
// matches the board's typography and palette for free rather than approximating
// them. The plugin is a subpath of the already-installed package.
//
// It is a CUSTOM 14-day view, because the shipped ones are fixed durations —
// listWeek is 7 and listMonth is a calendar month, and the endpoint's window is
// 14 days. `duration: { days: 14 }` says exactly that.
//
// NAIVE WALL-CLOCK STRINGS, never `startsAt` — the rule from FcCalendar.vue's
// header, and the one change that would make this disagree with every other
// screen. `startsAtLocal` already carries the per-date override.
import {
  addMinutesToWallClock,
  attendanceDisplay,
  attendanceSummary,
  toneClass,
} from '~/utils/schedule.js'
import { facilityDateNow, humanDate, localDateKeyOf } from '~/utils/facilityTime.js'

const props = defineProps({
  residentId: { type: String, required: true },
})

const { getResidentSchedule } = useSchedule()

const data = ref(null)
const pending = ref(true)

async function load() {
  pending.value = !data.value
  data.value = await getResidentSchedule(props.residentId)
  pending.value = false
}
await load()
onRealtimeChanged(load)

const hasActiveStay = computed(() => data.value?.hasActiveStay !== false)
const upcoming = computed(() => data.value?.upcoming ?? [])
const recent = computed(() => data.value?.recent ?? [])
const summary = computed(() => attendanceSummary(recent.value))

/** How many distinct days the diary covers, for the band's aside. */
const dayCount = computed(() => new Set(upcoming.value.map((s) => s.date)).size)

/** Sessions per date, for the day header's trailing cell. */
const perDay = computed(() => {
  const out = new Map()
  for (const s of upcoming.value) out.set(s.date, (out.get(s.date) ?? 0) + 1)
  return out
})

/**
 * The count for a day header's date.
 *
 * `localDateKeyOf`, not `facilityDateOf` — FullCalendar built this Date from our
 * own naive wall-clock string, so its local fields already are the facility date.
 */
function countOn(date) {
  const n = perDay.value.get(localDateKeyOf(date)) ?? 0
  return n > 1 ? `${n} sessions` : ''
}

const events = computed(() =>
  upcoming.value.map((s) => ({
    // No cohort in the id: this is one resident's own schedule, so every row is
    // their own cohort by construction. (`cohortsLabel` would return '' here
    // anyway — the payload carries singular `cohort`, not the array it wants.)
    id: `${s.occurrenceId}|${s.date}`,
    title: s.title,
    start: `${s.date}T${s.startsAtLocal}`,
    end: `${s.date}T${addMinutesToWallClock(s.startsAtLocal, s.durationMinutes)}`,
    extendedProps: { location: s.location, rescheduled: s.rescheduled },
  })),
)

const options = computed(() => ({
  // A fortnight, matching the endpoint's own window. The shipped list views are
  // 7 days or a month; neither is 14.
  initialView: 'listFortnight',
  views: { listFortnight: { type: 'list', duration: { days: 14 } } },
  initialDate: facilityDateNow(),
  events: events.value,
  // BOUNDED, and scrolling inside itself — not `height: 'auto'`.
  //
  // A fortnight of a daily group is eighteen rows over thirteen day-headers, and
  // at auto height that pushed the attendance history a full screen below the
  // fold. Three bands that cannot be seen together are not three bands. Same
  // reasoning and roughly the same cap as AppAttendeePicker's roster list.
  height: 420,
  // Read-only: no click target, no drag, nothing that looks actionable and is
  // not. Editing happens on /schedule, which the footnote points at.
  editable: false,
  selectable: false,
  // The day header is rendered by the #listDayHeaderContent slot below, which is
  // what gets "Today" and "Tomorrow" out of `humanDate` — no date format can
  // produce those.
  //
  // `listDayAltFormat: false` kills the SECOND date FullCalendar otherwise prints
  // on the far side of the header ("Thursday, Aug 6 … August 6, 2026"). Note it is
  // NOT `listDaySideFormat` — that was v6's name for it, and setting the old name
  // silently does nothing, which is exactly how the duplicate got here.
  listDayAltFormat: false,
  // Never reached — the band renders a sentence instead when there is nothing,
  // so FullCalendar's own empty state cannot contradict it. Set anyway so a
  // future caller does not get "No events to display" in the middle of a record.
  noEventsText: 'Nothing scheduled.',
}))
</script>

<template>
  <div class="flex flex-col gap-5">
    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <template v-else>
      <!-- ── Attendance, in one line ──────────────────────────────────────────
           Hidden entirely when nothing has been recorded. A 0-of-0 bar reads as
           a failing grade rather than as an absence of information. -->
      <section v-if="summary" class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Attendance
        </h2>
        <div class="bg-card rounded-md border p-4">
          <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <!-- Counts, never a percentage. `recent` caps at ten and a new
                 resident has one or two marks, so the denominator carrying the
                 sample size is the honest form — see attendanceSummary(). -->
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

      <!-- ── The diary ──────────────────────────────────────────────────────── -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Upcoming
          </h2>
          <span v-if="upcoming.length" class="text-muted-foreground text-xs tabular-nums">
            {{ upcoming.length }} over {{ dayCount }} {{ dayCount === 1 ? 'day' : 'days' }}
          </span>
        </div>

        <div v-if="upcoming.length" class="bg-card overflow-hidden rounded-md border">
          <FcCalendar :options="options">
            <!-- Today and Tomorrow instead of a bare weekday. `humanDate` is the
                 app's day-header helper everywhere else, and no FullCalendar date
                 format can produce a relative label.

                 `localDateKeyOf` and NOT `facilityDateOf`: this Date was built by
                 FullCalendar from our own naive wall-clock string, so its local
                 fields already ARE the facility date. Re-interpreting it in New
                 York would shift the key a day for a browser further west. -->
            <!-- A list day header has TWO cells — `level` 0 on the leading edge
                 and 1 on the trailing edge, which FullCalendar normally fills with
                 the same date in two formats. A content generator replaces the
                 text of BOTH, so overriding it without branching on `level`
                 prints the label twice, once at each end of the row.

                 `listDayAltFormat: false` does not help: it suppresses the alt
                 FORMAT, not the alt cell, so a generator still runs there. Rather
                 than hide it, give it something worth the space — how many
                 sessions that day, which is the one thing a day header can say
                 that the rows beneath it cannot. -->
            <template #listDayHeaderContent="arg">
              <span
                v-if="!arg.level"
                :class="arg.isToday && 'text-primary font-semibold'"
              >
                {{ humanDate(localDateKeyOf(arg.date), { short: true }) }}
              </span>
              <span v-else class="text-muted-foreground text-[11px] tabular-nums">
                {{ countOn(arg.date) }}
              </span>
            </template>

            <!-- Location and "moved" as the row's secondary line. `moved` is a
                 muted word, never a hue — the same rule the board follows, and
                 the payload has carried `rescheduled` all along with nothing
                 rendering it. -->
            <template #eventContent="arg">
              <span :class="arg.timeClass" class="tabular-nums">{{ arg.timeText }}</span>
              <span :class="arg.titleClass">{{ arg.event.title }}</span>
              <span
                v-if="arg.event.extendedProps.location || arg.event.extendedProps.rescheduled"
                class="text-muted-foreground truncate text-[11px]"
              >
                {{ arg.event.extendedProps.location }}
                <template v-if="arg.event.extendedProps.rescheduled"> · moved</template>
              </span>
            </template>
          </FcCalendar>
        </div>

        <!-- Two distinct sentences where there used to be one. `hasActiveStay`
             has always been on the wire and was never read, so a discharged
             resident was told "nothing scheduled in the next two weeks" — which
             reads as a rota gap and sends somebody looking for the events that
             ought to be there. -->
        <p v-else-if="!hasActiveStay" class="text-muted-foreground text-sm">
          No active stay, so nothing is scheduled. Their attendance record is unchanged.
        </p>
        <p v-else class="text-muted-foreground text-sm">
          Not on any event in the next two weeks.
        </p>

        <p class="text-muted-foreground text-xs">
          A resident's schedule is the events they are an attendee of — not everything their
          cohort runs. Events are created and edited on the
          <NuxtLink to="/schedule" class="underline underline-offset-2">schedule</NuxtLink>.
        </p>
      </section>

      <!-- ── The record ─────────────────────────────────────────────────────── -->
      <section class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Attendance history
        </h2>

        <!-- A list, not a table. Four columns for four short facts made the note
             — the only prose here, and the part a review actually reads — the
             narrowest cell on the row. -->
        <div v-if="recent.length" class="overflow-hidden rounded-md border">
          <div
            v-for="a in recent"
            :key="a.id"
            class="bg-card flex min-h-12 items-center gap-3 border-b px-3 py-2 last:border-b-0"
          >
            <span class="text-muted-foreground w-[5.5rem] shrink-0 text-xs tabular-nums">
              {{ humanDate(a.date, { short: true }) }}
            </span>
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

        <p v-else class="text-muted-foreground text-sm">No attendance recorded yet.</p>
      </section>
    </template>
  </div>
</template>
