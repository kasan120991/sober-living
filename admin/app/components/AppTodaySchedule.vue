<script setup>
// The dashboard's "Today" — FullCalendar's one-day list view over the same
// { shared, lanes } bands GET /schedule returns. It was a rolling 7-day list
// first; narrowed to the current day on 2026-08-06, by request.
//
// The flat array below is the deliberate concatenation of two provably
// disjoint bands, the same rule AppScheduleCalendar documents: the server
// merged a both-cohorts event exactly once, so joining shared and lanes here
// is not a merge. What must never exist is a server endpoint returning the
// flat list.
//
// The WHOLE day shows, including sessions already over — this panel answers
// "what is today's schedule", and a morning group vanishing at 8am would make
// the day look emptier than it was. Un-taken rolls are the queue's business,
// not this list's. Cancelled sessions stay off it: a day view is read as what
// is happening, and a cancelled meeting is not happening.
//
// READ-ONLY. A row navigates to /schedule, where rolls and edits live.
//
// NAIVE WALL-CLOCK STRINGS, never `startsAt` — the rule from FcCalendar.vue's
// header. `startsAtLocal` already carries any per-date override.
import {
  SESSION_STATE,
  addMinutesToWallClock,
  cohortsLabel,
  sessionEventId,
} from '~/utils/schedule.js'
import {
  facilityDateNow,
  facilityNowAsLocal,
  humanDate,
  localDateKeyOf,
} from '~/utils/facilityTime.js'

const props = defineProps({
  /** The `{ shared, lanes }` bands straight off GET /dashboard's `upcoming`. */
  shared: { type: Object, default: () => ({ days: [], total: 0 }) },
  lanes: { type: Array, default: () => [] },
})

const router = useRouter()

const allSessions = computed(() => [
  ...(props.shared.days ?? []).flatMap((d) => d.sessions),
  ...props.lanes.flatMap((l) => l.days.flatMap((d) => d.sessions)),
])

const events = computed(() =>
  allSessions.value
    .filter((s) => s.state !== SESSION_STATE.CANCELLED)
    .map((s) => ({
      id: sessionEventId(s),
      title: s.title,
      start: `${s.date}T${s.startsAtLocal}`,
      end: `${s.date}T${addMinutesToWallClock(s.startsAtLocal, s.durationMinutes)}`,
      extendedProps: {
        // The cohort WORD, never a hue — it is the only thing on this panel
        // distinguishing a men's session from a women's.
        cohortLabel: cohortsLabel(s.cohorts),
        location: s.location,
      },
    })),
)

const options = computed(() => ({
  // The shipped one-day list view; the window the server sends is one day too.
  initialView: 'listDay',
  initialDate: facilityDateNow(),
  events: events.value,
  now: () => facilityNowAsLocal(),
  // A single day is a handful of rows — no bound needed, unlike the old
  // 7-day view that a daily event could fill.
  height: 'auto',
  editable: false,
  selectable: false,
  listDayAltFormat: false,
  noEventsText: 'Nothing scheduled today.',
  eventClick: () => router.push('/schedule'),
}))
</script>

<template>
  <FcCalendar :options="options">
    <!-- Pulse highlights TODAY's list day-header with its own cushion, so the
         label leans into that rather than fighting it: "Today" in primary,
         with the date as the quiet trailing cell (level 1 — see
         AppResidentSchedule for why the branch is required). -->
    <template #listDayHeaderContent="arg">
      <span v-if="!arg.level" :class="arg.isToday && 'text-primary font-semibold'">
        {{ humanDate(localDateKeyOf(arg.date), { short: true }) }}
      </span>
      <span v-else class="text-muted-foreground text-[11px]">
        {{ humanDate(localDateKeyOf(arg.date), { short: true, relative: false }) }}
      </span>
    </template>

    <!-- The cohort word rides INSIDE the title span rather than as a third
         child — a separate span wraps above the title when the column is
         narrow, which read as a floating label. Inline, it truncates with
         the title as one line. -->
    <!-- INLINE style, not a utility class: pulse's stylesheets are unlayered
         and beat Tailwind's layered rules (see nuxt.config), so its nowrap
         wins over `whitespace-normal`. Wrapping matters here — this column is
         narrow and a clipped title is worse than a second line. -->
    <template #eventContent="arg">
      <span :class="arg.timeClass" class="tabular-nums">{{ arg.timeText }}</span>
      <span :class="arg.titleClass" style="white-space: normal">
        {{ arg.event.title }}
        <span class="text-muted-foreground text-[11px]" style="white-space: nowrap">
          · {{ arg.event.extendedProps.cohortLabel }}
        </span>
      </span>
    </template>
  </FcCalendar>
</template>
