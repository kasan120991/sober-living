<script setup>
// The schedule board.
//
// All three views live here now — Day, Week and Month, every one of them drawn
// by FullCalendar. The hand-built day agenda and two-lane week table this
// replaced were chosen from rendered variants and are recorded in CLAUDE.md
// module 3 as retired, not forgotten.
//
// FcCalendar owns the theming; this owns what the schedule MEANS. The split
// matters: nothing about cohorts, sessions or rolls belongs in a component under
// ui/, and nothing about pulse or --fc-pulse-* belongs here.
//
// ── Cohort, now that there are no lanes ────────────────────────────────────
// Merging the cohorts into one column means the two-lane split no longer carries
// the separation visually. Cohort is a WORD on the tile plus the filter below —
// never a hue, which is the rule that survives from module 3 unchanged. The
// server contract is untouched: { shared, lanes } still crosses the wire and
// band.js still merges a both-cohorts event exactly once.
//
// ── Why a flat array is safe here, when useSchedule.js says there is none ──
// The server returns { shared, lanes } and never a flat list, so a client cannot
// combine the cohorts without concatenating two arrays ON PURPOSE. This does
// exactly that, and it is safe for a precise reason: read.js puts a
// both-cohorts session in `shared` and removes it from BOTH lanes, and
// verify-schedule.js asserts it. The two arrays are provably disjoint, so this
// is not a merge — the merge already happened, once, correctly, on the server in
// the one module that knows how.
//
// What must never exist is a SERVER endpoint returning the flat list. That is
// the one a resident-facing read would reach for.
import { useCalendarController } from '@fullcalendar/vue3'
import {
  COHORT_LABEL,
  SESSION_STATE,
  addMinutesToWallClock,
  cohortsLabel,
  sessionEventId,
  sessionStateDisplay,
} from '~/utils/schedule.js'
import { facilityNowAsLocal, localDateKeyOf } from '~/utils/facilityTime.js'

const props = defineProps({
  /** The `{ shared, lanes }` bands straight off GET /schedule. */
  shared: { type: Object, default: () => ({ days: [], total: 0 }) },
  lanes: { type: Array, default: () => [] },
  /** The date the page is showing, 'YYYY-MM-DD'. */
  date: { type: String, required: true },
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['open-roll', 'create', 'reschedule', 'dates-set'])

// One controller, created here because this component owns the options object
// the calendar needs it in. The toolbar reads it; nothing else does.
const controller = useCalendarController()

const VIEWS = [
  { key: 'timeGridDay', label: 'Day' },
  { key: 'timeGridWeek', label: 'Week' },
  { key: 'dayGridMonth', label: 'Month' },
]

// ── Cohort filter ───────────────────────────────────────────────────────────
// Client-side only, and deliberately never a server parameter: GET /schedule has
// no flat list and no cohort filter, and adding one would put a
// combined-schedule query on the wire — the shape a resident-facing read would
// grab. This is presentation.
const COHORT_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'MEN', label: COHORT_LABEL.MEN },
  { key: 'WOMEN', label: COHORT_LABEL.WOMEN },
]
const cohortFilter = ref('ALL')

const allSessions = computed(() => [
  ...(props.shared.days ?? []).flatMap((d) => d.sessions),
  ...props.lanes.flatMap((l) => l.days.flatMap((d) => d.sessions)),
])

const visible = computed(() =>
  cohortFilter.value === 'ALL'
    ? allSessions.value
    : // Choosing Men shows men-only events AND shared ones, because a shared
      // event IS on the men's schedule. A "Both only" option would be a report,
      // not a filter.
      allSessions.value.filter((s) => s.cohorts.includes(cohortFilter.value)),
)

const endsAtLocalOf = (s) => addMinutesToWallClock(s.startsAtLocal, s.durationMinutes)

const events = computed(() => {
  const now = facilityNowAsLocal()

  const rows = visible.value.map((s) => {
    const display = sessionStateDisplay(s)
    return {
      id: sessionEventId(s),
      title: s.title,
      // NAIVE WALL CLOCK, never s.startsAt. See FcCalendar.vue's header — this is
      // what makes the grid read facility time in any browser zone.
      // s.startsAtLocal is already the per-date override when one exists.
      start: `${s.date}T${s.startsAtLocal}`,
      end: `${s.date}T${endsAtLocalOf(s)}`,
      // Empty for every state but CANCELLED. Tiles are solid primary now, so
      // state is the marker inside them — see sessionStateDisplay().
      className: display.className,
      // Only a SCHEDULED session that has not yet ended can move. Cancelled reads
      // as "the meeting did not happen"; taken is stamped evidence of a meeting
      // that happened at a time; missed has already not happened. In progress IS
      // draggable — "we are running twenty minutes late" is the case this is for.
      // The server enforces all four independently.
      editable:
        props.canManage &&
        s.state === SESSION_STATE.SCHEDULED &&
        new Date(`${s.date}T${endsAtLocalOf(s)}`) >= now,
      extendedProps: {
        // THE ADDRESS. occurrenceId/occurrenceIds are deliberately absent: a
        // session is addressed by (eventId, date), and keeping occurrence ids off
        // the object is what stops somebody writing a handler that posts one.
        // Also absent permanently: any resident name.
        eventId: s.eventId,
        date: s.date,
        cohorts: s.cohorts,
        cohortLabel: cohortsLabel(s.cohorts),
        state: s.state,
        marker: display.marker,
        rosterCount: s.rosterCount,
        markedCount: s.markedCount,
        location: s.location,
        rescheduled: s.rescheduled,
        startsAtLocal: s.startsAtLocal,
        durationMinutes: s.durationMinutes,
      },
    }
  })

  // The client-side echo of the server's own assertion. A duplicate id would
  // make FullCalendar treat two tiles as one event and drag them together —
  // exactly the lie band.js's refuse-to-merge fallback exists to prevent.
  if (import.meta.dev) {
    const ids = rows.map((r) => r.id)
    if (new Set(ids).size !== ids.length) {
      console.error('[schedule] duplicate calendar event ids — a session is in two bands', ids)
    }
  }
  return rows
})

/**
 * Refuse a cross-day drop BEFORE any request.
 *
 * The recurrence rule decides which dates exist, so moving Tuesday's group to
 * Wednesday is not a reschedule — materializeSession would refuse the date.
 * Returning false gives the not-allowed cursor and springs the tile back, with
 * no request, no revert flash and no error toast. Nothing tells the user off,
 * because nothing went wrong: they tried a gesture the grid does not offer.
 */
function eventAllow(dropInfo, draggedEvent) {
  return localDateKeyOf(dropInfo.start) === draggedEvent.extendedProps.date
}

function onEventDrop(info) {
  const p = info.event.extendedProps
  // Belt and braces behind eventAllow.
  if (localDateKeyOf(info.event.start) !== p.date) return info.revert()

  const [h, m] = [info.event.start.getHours(), info.event.start.getMinutes()]
  const startsAtLocal = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

  emit('reschedule', {
    eventId: p.eventId,
    date: p.date,
    startsAtLocal,
    was: p.startsAtLocal,
    title: info.event.title,
    // The caller reverts the optimistic placement if the server refuses.
    revert: info.revert,
  })
}

function onSelect(info) {
  if (!props.canManage) return
  const start = info.start
  emit('create', {
    date: localDateKeyOf(start),
    // A month cell selection has no meaningful time; a timegrid one does.
    time: info.allDay
      ? null
      : `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    minutes: info.allDay ? null : Math.round((info.end - info.start) / 60_000),
  })
  info.view.calendar.unselect()
}

const options = computed(() => ({
  controller,
  initialView: 'timeGridDay',
  initialDate: props.date,
  events: events.value,
  now: () => facilityNowAsLocal(),
  selectable: props.canManage,
  eventAllow,
  eventDrop: onEventDrop,
  select: onSelect,
  eventClick: (info) => {
    const p = info.event.extendedProps
    emit('open-roll', {
      eventId: p.eventId,
      date: p.date,
      title: info.event.title,
      cohorts: p.cohorts,
    })
  },
  datesSet: (info) => emit('dates-set', info),

  // The full line as a native tooltip, since a short tile drops the marker to
  // fit. On the element rather than inside eventContent because the tile's
  // children are now bare — see the #eventContent comment.
  //
  // Safe to put here and nowhere near a name: extendedProps carries counts and
  // states only, which is the rule the whole board follows.
  eventDidMount: (info) => {
    const p = info.event.extendedProps
    const meta = metaOf(p)
    info.el.title = `${info.timeText} ${info.event.title}${meta ? ` · ${meta}` : ''}`
  },

  views: {
    // A month cell has no time axis, so the only drop it offers is another day —
    // which is never a reschedule. eventAllow already refuses that, but this
    // removes the drag affordance so nothing invites the gesture in the first
    // place. Clicking a tile to open its roll still works.
    dayGridMonth: { editable: false },
  },
}))

/**
 * Is this tile a single row, with no space for the state marker?
 *
 * Two ways that happens, and both must be caught: `isShort` is pulse's own flag
 * for a block tile below eventShortHeight (a 30-minute group), and a MONTH cell
 * renders list-item events, which are one row by construction however long the
 * session is. Checking only isShort left month cells showing "M…" for the title.
 */
function isCompact(arg) {
  return Boolean(arg?.isShort) || arg?.view?.type === 'dayGridMonth'
}

/**
 * The line under the title: cohort · state · moved. Words, never hues.
 *
 * The state marker sits here rather than in its own element because a tile is
 * often two lines tall, and a marker that pushes the title out of view is worse
 * than one that shares a line with the cohort.
 */
function metaOf(p) {
  const bits = []
  if (p.cohortLabel) bits.push(p.cohortLabel)
  if (p.marker) bits.push(p.marker)
  else if (p.rosterCount) bits.push(`${p.rosterCount} on roster`)
  if (p.rescheduled) bits.push('moved')
  return bits.join(' · ')
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <AppScheduleToolbar :controller="controller" :views="VIEWS" />

    <div class="flex flex-wrap items-center gap-3">
      <Tabs v-model="cohortFilter">
        <TabsList>
          <TabsTrigger v-for="c in COHORT_FILTERS" :key="c.key" :value="c.key">
            {{ c.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <span class="text-muted-foreground text-xs tabular-nums">
        {{ visible.length }} {{ visible.length === 1 ? 'session' : 'sessions' }}
      </span>
      <span v-if="canManage" class="text-muted-foreground ms-auto text-xs">
        Drag to move one date · click empty space to add
      </span>
    </div>

    <FcCalendar :options="options">
      <!-- ── Tile content ──────────────────────────────────────────────────
           BARE CHILDREN, deliberately not wrapped in our own flex container.
           Pulse's `columnEventInnerClass` already sets the direction and
           padding for us — flex-row when the tile is short, flex-col when
           there is room — so a wrapper of our own imposing `flex-col` fights
           it and overflows a 30-minute tile, clipping the time and the meta
           line. Emitting children and letting the theme arrange them is the
           whole reason for using a shipped theme.

           `arg.timeClass` / `arg.titleClass` are pulse's own computed classes,
           so the typography matches every other tile it draws. -->
      <template #eventContent="arg">
        <span :class="arg.timeClass" class="tabular-nums">{{ arg.timeText }}</span>
        <span :class="arg.titleClass" class="sl-event-title">{{ arg.event.title }}</span>
        <!-- On a one-row tile the state marker steps aside and lives in the
             tooltip instead — the roll queue above the board is the surface
             that carries it regardless. Without this the marker wins the space
             contest against the title, and a month cell reads "M…" where the
             event's name should be.

             The COHORT WORD never steps aside: with the lanes gone it is the
             only thing on screen distinguishing a men's session from a
             women's, and it costs three characters where the marker costs ten. -->
        <span v-if="isCompact(arg)" class="shrink-0 text-[0.6875rem] opacity-70">
          {{ arg.event.extendedProps.cohortLabel }}
        </span>
        <span v-else class="truncate opacity-70">{{ metaOf(arg.event.extendedProps) }}</span>
      </template>
    </FcCalendar>
  </div>
</template>
