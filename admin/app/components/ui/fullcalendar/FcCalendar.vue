<script setup>
// FullCalendar 7, on the pulse theme.
//
// Vendored under ui/ for the same reason ui/sonner/Sonner.vue is: third-party
// library code we own, kept out of reach of `shadcn-vue add`.
//
// NAMED FcCalendar, NOT Calendar. shadcn ships a `Calendar` date picker and
// nuxt.config registers ui/ with `pathPrefix: false`, so the two would collide
// the day somebody adds it.
//
// ── Where the look comes from ──────────────────────────────────────────────
// `pulse` is a real FullCalendar theme, imported as a PLUGIN below. It is the
// same design the shadcn registry publishes at fullcalendar.io/docs/shadcn —
// that registry ships React `.tsx` only, and there is no Vue variant, but the
// theme itself is precompiled into this package, so we import it instead of
// porting ~500 lines of TSX.
//
// Its colours come from 31 `--fc-pulse-*` custom properties, all set in
// assets/css/fullcalendar.css against this app's bare tokens. THERE IS NO
// `--fc-*` STYLE BINDING IN THIS FILE ANY MORE — v6's variables were renamed
// away in v7, and a stylesheet palette is where a theme's colours belong.
//
// Do not try to style FullCalendar's internals from CSS: v7 MINIFIES its class
// names (`.fc-dl`, `.fc-ei`, `.fc-oh`), so a selector written against one would
// break on a patch bump. Everything goes through the `*Class` options, which
// apply classes we choose to elements FullCalendar owns.
//
// ── The timezone rule, still the most important thing in this file ─────────
// v7 CAN take `timeZone: 'America/New_York'` natively — that is new, and we are
// deliberately NOT using it. We stay on 'local' and feed NAIVE WALL-CLOCK
// STRINGS (`2026-08-11T19:00`, no Z, no offset), which FullCalendar renders as
// exactly that wall clock in any browser zone, converting nothing.
//
// The reason is the drag path: with naive strings a dropped Date's LOCAL fields
// already are the facility wall clock, which is precisely what
// localDateKeyOf() reads. Under a named zone `info.event.start` becomes an
// instant needing formatDate() or Temporal to read back — new machinery on the
// one path that writes to the database — and it would add a sixth place in the
// repo naming the zone, where CLAUDE.md tracks five on purpose.
//
// NEVER pass a session's `startsAt`. That is a UTC instant and would render in
// whatever zone the browser happens to be in, which is the one change that
// would make this screen disagree with every other screen in the app.
import { useMediaQuery } from '@vueuse/core'
import FullCalendar from '@fullcalendar/vue3'
import pulseTheme from '@fullcalendar/vue3/themes/pulse'
import dayGridPlugin from '@fullcalendar/vue3/daygrid'
import timeGridPlugin from '@fullcalendar/vue3/timegrid'
import interactionPlugin from '@fullcalendar/vue3/interaction'
// The list view, used by the resident record's Schedule section — a day-grouped
// agenda is exactly what that section needs, and pulse themes it (`listDay*`,
// `listItemEvent*`, `noEvents*`) so it matches the board for free. A subpath of
// the already-installed package, so this adds no dependency.
import listPlugin from '@fullcalendar/vue3/list'

const props = defineProps({
  /** Merged over the defaults below. See FullCalendar's option docs. */
  options: { type: Object, default: () => ({}) },
})

const calendar = ref(null)
/** The FullCalendar API, for a parent driving prev/next/today/changeView. */
defineExpose({ api: () => calendar.value?.getApi() })

// v7 stamps `data-color-scheme` on its root and keys its own internals off it.
// Our palette maps to bare tokens that already flip with `.dark`, so this is not
// what makes dark mode work — it is what stops FullCalendar's own defaults
// disagreeing with the app around them.
const colorMode = useColorMode()

// The app's 44px floor, CONDITIONAL exactly as CLAUDE.md requires — max-md OR
// pointer-coarse, never one alone: max-md misses the tablet, and pointer-coarse
// is invisible when you test mobile by resizing a desktop browser.
//
// An OPTION rather than a CSS height override, because the v6 selector this
// used to need (`.fc-timegrid-slot`) is a minified class in v7. A 30-minute
// tile in a default slot is about 21px, which is not a tap target.
const isTouch = useMediaQuery('(max-width: 767px), (pointer: coarse)')

const merged = computed(() => ({
  plugins: [pulseTheme, dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],

  // The page owns navigation — see AppScheduleToolbar.vue, which drives this
  // through useCalendarController() so the buttons are the vendored Button and
  // inherit the conditional tap floor the app bakes into the button source.
  // (v7 defaults this off, unlike v6; stated rather than relied on.)
  headerToolbar: false,

  colorScheme: colorMode.value === 'dark' ? 'dark' : 'light',

  timeZone: 'local',
  firstDay: 0,
  allDaySlot: false,
  nowIndicator: true,
  expandRows: true,
  height: 'auto',
  dayMaxEvents: true,

  // Pulse's own event colours, pointed at our tokens. A per-event `color`
  // overrides these, which is how CANCELLED gets its muted treatment.
  eventColor: 'var(--primary)',
  eventContrastColor: 'var(--primary-foreground)',
  // Below this height a tile lays out in one row instead of stacking time over
  // title. The value the shadcn block uses.
  eventShortHeight: 50,

  slotDuration: '00:30:00',
  // Quarter hours are always a valid 'HH:MM', so a drag can never produce a
  // value the occurrence_start_is_wall_clock CHECK would reject.
  snapDuration: '00:15:00',
  slotMinTime: '06:00:00',
  slotMaxTime: '23:00:00',
  slotMinHeight: isTouch.value ? 44 : undefined,

  // Matches formatFacilityTime()'s 'h:mm AM/PM'. `slotHeaderFormat` is v7's
  // name for what v6 called `slotLabelFormat`.
  eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
  slotHeaderFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },

  // Duration lives on the occurrence, and there is no per-date duration
  // override column — so a resize would be a series change wearing a gesture.
  eventDurationEditable: false,

  ...props.options,
}))
</script>

<template>
  <!-- `sl-calendar` is the hook our own classes hang off (see
       assets/css/fullcalendar.css). It is not used to reach into FullCalendar's
       internals — those class names are minified in v7. -->
  <div class="sl-calendar">
    <!-- Slots are forwarded so a consumer can supply `#eventContent` and the
         like. v7's Vue adapter still renders a named slot per *Content option,
         which is the idiomatic way to put real components inside a tile. -->
    <FullCalendar ref="calendar" :options="merged">
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps ?? {}" />
      </template>
    </FullCalendar>
  </div>
</template>
