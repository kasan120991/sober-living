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
    <!-- The panel heading already says "Today", so the day header carries the
         actual date instead of repeating it. Level 1 is the trailing cell a
         list day-header also renders — see AppResidentSchedule for the branch. -->
    <template #listDayHeaderContent="arg">
      <span v-if="!arg.level" class="text-muted-foreground">
        {{ humanDate(localDateKeyOf(arg.date), { short: true, relative: false }) }}
      </span>
      <span v-else />
    </template>

    <template #eventContent="arg">
      <span :class="arg.timeClass" class="tabular-nums">{{ arg.timeText }}</span>
      <span :class="arg.titleClass">{{ arg.event.title }}</span>
      <span class="text-muted-foreground shrink-0 text-[11px]">
        {{ arg.event.extendedProps.cohortLabel }}
      </span>
    </template>
  </FcCalendar>
</template>
