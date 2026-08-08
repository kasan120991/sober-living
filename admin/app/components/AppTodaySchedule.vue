<script setup>
// The dashboard's "Today" — a plain list of the day's sessions.
//
// It was FullCalendar's `listDay` view until 2026-08-08. Nothing was wrong with
// it; a five-row read-only list is simply not what a calendar library is for,
// and this is the app's most-refetched page. Dropping it here takes a
// FullCalendar instance off the screen that every realtime invalidation lands
// on, and hands the row shape back to the same `border-t` idiom the Signed out
// and Outstanding balances panels beside it already use — which is why the
// three now read as one row of panels rather than two panels and a widget.
//
// FullCalendar stays where it earns its keep: /schedule, which needs Day, Week
// and Month, drag-to-reschedule and a now-indicator. This panel needs none of
// that.
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
import {
  SESSION_STATE,
  addMinutesToWallClock,
  cohortsLabel,
  sessionEventId,
} from '~/utils/schedule.js'
import { formatWallClock } from '~/utils/facilityTime.js'

const props = defineProps({
  /** The `{ shared, lanes }` bands straight off GET /dashboard's `upcoming`. */
  shared: { type: Object, default: () => ({ days: [], total: 0 }) },
  lanes: { type: Array, default: () => [] },
})

/**
 * SORTED, and that is not decoration — it is the one thing FullCalendar was
 * doing for us that a list has to do for itself. `shared` and `lanes` are each
 * ordered, but concatenating them interleaves two ordered runs into an
 * unordered one: a 7:30 women's session in `lanes` would have printed above a
 * 9:00 shared house meeting purely because of which band it came from.
 *
 * Sorted on the WALL-CLOCK STRING, which is safe precisely because it is
 * zero-padded 'HH:MM' — so lexical order is chronological order, and no Date
 * is constructed. `startsAtLocal` already carries any per-date override.
 */
const sessions = computed(() =>
  [
    ...(props.shared.days ?? []).flatMap((d) => d.sessions),
    ...props.lanes.flatMap((l) => l.days.flatMap((d) => d.sessions)),
  ]
    .filter((s) => s.state !== SESSION_STATE.CANCELLED)
    .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal))
    .map((s) => ({
      // sessionEventId(), not a second copy of the same expression — the
      // cohort segment is what keeps a refuse-to-merge pair distinct.
      key: sessionEventId(s),
      title: s.title,
      // The cohort WORD, never a hue — the only thing on this panel
      // distinguishing a men's session from a women's.
      cohort: cohortsLabel(s.cohorts),
      time: timeRange(s.startsAtLocal, s.durationMinutes),
    })),
)

/**
 * "7:00 – 7:30 AM", dropping the repeated meridiem — what the list view
 * rendered, and it matters because this panel is a third of the foot's width.
 *
 * formatWallClock is a PURE STRING TRANSFORM with no Date and no timezone: a
 * wall clock is already facility time, and running it through `new Date()` to
 * format it would re-interpret it as an instant, which is the bug class
 * expand.js warns about.
 */
function timeRange(startsAtLocal, durationMinutes) {
  const from = formatWallClock(startsAtLocal)
  const to = formatWallClock(addMinutesToWallClock(startsAtLocal, durationMinutes))
  const [fromTime, fromSuffix] = from.split(' ')
  return to.endsWith(fromSuffix) ? `${fromTime} – ${to}` : `${from} – ${to}`
}
</script>

<template>
  <p v-if="!sessions.length" class="text-muted-foreground border-t px-4 py-3 text-sm">
    Nothing scheduled today.
  </p>

  <!-- The row shape is the Signed-out panel's, deliberately: min-h-12, the same
       padding, the same hover. flex-wrap with a basis on the title is what lets
       the cohort word drop to its own line in a narrow column instead of
       crushing the title — the attention panel's own rule.

       THE TITLE WRAPS RATHER THAN TRUNCATING, which the list view also did:
       this panel is a third of the foot's width and the whole width of a phone
       row, and a clipped group name is worse than a second line. The list view
       needed an INLINE style to win that, because pulse's stylesheets are
       unlayered and beat Tailwind's layered rules; with FullCalendar gone a
       plain class does it, which is a small dividend of the change. -->
  <NuxtLink
    v-for="s in sessions"
    :key="s.key"
    to="/schedule"
    class="hover:bg-muted/50 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-4 py-2.5 transition-colors"
  >
    <span class="text-muted-foreground w-[7.5rem] shrink-0 text-xs tabular-nums">{{ s.time }}</span>
    <span class="min-w-0 flex-1 basis-32 text-sm font-medium">{{ s.title }}</span>
    <span class="text-muted-foreground ms-auto shrink-0 text-[11px]">{{ s.cohort }}</span>
  </NuxtLink>
</template>
