<script setup>
// The dashboard's "Next 7 days" — FullCalendar's list view over the same
// { shared, lanes } bands GET /schedule returns.
//
// The flat array below is the deliberate concatenation of two provably
// disjoint bands, the same rule AppScheduleCalendar documents: the server
// merged a both-cohorts event exactly once, so joining shared and lanes here
// is not a merge. What must never exist is a server endpoint returning the
// flat list.
//
// READ-ONLY. A row navigates to /schedule, where rolls and edits live —
// nothing on the landing page pretends to be an editor.
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

// "Coming up" means it has not finished and was not cancelled — the same
// filter the resident record's diary applies. This morning's already-run
// group is the schedule board's business, not the landing page's.
const upcoming = computed(() => {
  const now = facilityNowAsLocal()
  return allSessions.value.filter(
    (s) =>
      s.state !== SESSION_STATE.CANCELLED &&
      new Date(`${s.date}T${addMinutesToWallClock(s.startsAtLocal, s.durationMinutes)}`) >= now,
  )
})

const events = computed(() =>
  upcoming.value.map((s) => ({
    id: sessionEventId(s),
    title: s.title,
    start: `${s.date}T${s.startsAtLocal}`,
    end: `${s.date}T${addMinutesToWallClock(s.startsAtLocal, s.durationMinutes)}`,
    extendedProps: {
      // The cohort WORD, never a hue — with no lanes on this panel it is the
      // only thing distinguishing a men's session from a women's.
      cohortLabel: cohortsLabel(s.cohorts),
      location: s.location,
    },
  })),
)

const options = computed(() => ({
  // The shipped list views are 7 calendar-week days or a month; this window is
  // a rolling week from today, so it is a custom view — the AppResidentSchedule
  // pattern with a different span.
  initialView: 'listWeekAhead',
  views: { listWeekAhead: { type: 'list', duration: { days: 7 } } },
  initialDate: facilityDateNow(),
  events: events.value,
  now: () => facilityNowAsLocal(),
  // Bounded and scrolling inside itself: a daily event fills a rolling week
  // with a dozen rows, and at auto height the panel would push everything
  // after it off screen.
  height: 480,
  editable: false,
  selectable: false,
  listDayAltFormat: false,
  noEventsText: 'Nothing scheduled this week.',
  eventClick: () => router.push('/schedule'),
}))
</script>

<template>
  <FcCalendar :options="options">
    <!-- Today/Tomorrow instead of a bare weekday; level 1 is the trailing cell
         a list day-header also renders — see AppResidentSchedule for why the
         branch is required. It stays empty here: the row count per day says
         nothing a glance at the rows doesn't. -->
    <template #listDayHeaderContent="arg">
      <span v-if="!arg.level" :class="arg.isToday && 'text-primary font-semibold'">
        {{ humanDate(localDateKeyOf(arg.date), { short: true }) }}
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
