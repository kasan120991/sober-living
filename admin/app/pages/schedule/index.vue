<script setup>
// The schedule board.
//
// Two bands: the UN-TAKEN ROLL QUEUE, then the calendar. The queue is on top
// because a roll nobody took is the thing that quietly costs the facility its
// evidence, and it is derived on every read so it clears itself the moment
// somebody takes one — the same reasoning as the bell having no Notification
// table.
//
// ── What used to be here ───────────────────────────────────────────────────
// A hand-built day agenda and a hand-built two-lane week table, both chosen
// from rendered variants in 2026-08-03, both retired on 2026-08-05 when Day,
// Week and Month all became FullCalendar views drawn in ONE merged column. See
// CLAUDE.md module 3 for what that trades away — chiefly that the cohort split
// is no longer visible as geometry, and reads as a word plus a filter instead.
//
// The navigation and view switch moved with them, into AppScheduleToolbar,
// because FullCalendar owns the window now and a second source of truth for
// "which dates am I looking at" is how a label comes to disagree with a grid.
//
// No resident names anywhere on this page. Counts on the cards, names only
// inside a roll somebody deliberately opened. Same rule as the census tile,
// and for the same reason: this screen gets read over a shoulder.
import { useMediaQuery } from '@vueuse/core'
import { Plus } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { cohortsLabel } from '~/utils/schedule.js'
import {
  daysAgoLabel,
  facilityDateNow,
  formatFacilityTime,
  humanDate,
  localDateKeyOf,
} from '~/utils/facilityTime.js'

const { getSchedule, rescheduleSession } = useSchedule()
const { user } = useAuth()
const router = useRouter()
const notify = useNotify()

// Presentation only. Setting the schedule is manager-only server-side; taking
// a roll is all-staff, deliberately — see routes/schedule.js.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const date = ref(facilityDateNow())
// How many days the current view needs. FullCalendar reports its own window
// through datesSet — 1, 7, or ~42 for a month grid.
const span = ref(1)
const data = ref(null)
const pending = ref(true)

async function load() {
  // First load only — a realtime refresh must not blank the board it updates.
  pending.value = !data.value
  data.value = await getSchedule({ date: date.value, days: span.value })
  pending.value = false
}
await load()
onRealtimeChanged(load)

// ONE key, not [date, span]. datesSet writes both separately, so a plain array
// watcher would fire twice per navigation and could echo. This works because
// they are strings and assigning an identical string to a ref is inert — do not
// switch them to Date objects.
watch(() => `${date.value}|${span.value}`, load)

// A session crossing from scheduled to MISSED mutates nothing server-side — no
// write, so no socket event — which means nothing would tell this page. Same
// pattern the census and sign-outs pages use for a sign-out going overdue, and
// the one CLAUDE.md module 8 asks for by name.
//
// It REFETCHES rather than re-deriving, because unlike presence, session state
// is computed on the server. Hence 60s rather than the census's 30: noticing a
// missed roll up to a minute late costs nothing, and an HTTP request every 30
// seconds on a shared house phone is not free.
//
// This tick previously existed but was dead — it set a `now` ref that nothing
// read, so a session going missed never surfaced until something else refetched.
// That matters more now that the queue is the board's only attention surface.
let tick = null
onMounted(() => {
  tick = setInterval(load, 60_000)
})
onUnmounted(() => clearInterval(tick))

const lanes = computed(() => data.value?.lanes ?? [])
// Events BOTH cohorts attend. They are in this band and in NEITHER lane, so a
// house meeting draws once rather than looking like two separate meetings.
const shared = computed(() => data.value?.shared ?? { days: [], total: 0 })

// The queue is capped here, not on the server. The API returns everything it
// found in a fortnight, and on a house that has never taken a roll that is a
// hundred rows — a list nobody can act on is the same as no list at all.
const QUEUE_SHOWN = 4
const queue = computed(() => data.value?.needsRoll ?? [])
const queueShown = computed(() => queue.value.slice(0, QUEUE_SHOWN))

const rollOpen = ref(false)
const rollFor = ref(null)

/** FullCalendar reporting the window it just navigated to. */
function onDatesSet(info) {
  span.value = Math.max(1, Math.round((info.end - info.start) / 86_400_000))
  date.value = localDateKeyOf(info.start)
}

// ── Where "new event" goes ──────────────────────────────────────────────────
// Above md the wide two-column dialog; below md the page at /schedule/new. The
// dialog is a desktop affordance — two columns need width, and a roster picker
// in a dialog on a phone is the scroll trap CLAUDE.md warned about. Both shells
// render the same AppEventForm, so this is a layout switch, not two forms.
//
// Width ONLY, deliberately not `pointer: coarse` as well: the 44px tap floor
// cares whether a finger is doing the pointing, but two columns only care
// whether they fit. A touch laptop at 1440 should get the dialog.
const isWide = useMediaQuery('(min-width: 768px)')

const createOpen = ref(false)
const createPrefill = ref({})

/** Click empty space on the calendar → the create form, prefilled. */
function onCreate({ date: d, time, minutes }) {
  if (isWide.value) {
    createPrefill.value = { date: d, time, minutes }
    createOpen.value = true
    return
  }
  const q = new URLSearchParams({ date: d })
  if (time) q.set('time', time)
  if (minutes) q.set('minutes', String(minutes))
  router.push(`/schedule/new?${q}`)
}

/** The header button. No prefill — nothing about a date was chosen. */
function onNewEvent() {
  if (!isWide.value) return router.push('/schedule/new')
  createPrefill.value = {}
  createOpen.value = true
}

const editOpen = ref(false)
const editId = ref(null)

/**
 * Editing the event a roll belongs to. Closes the sheet FIRST — it is modal and
 * sets `pointer-events: none` on the body, so a dialog opened underneath it would
 * be unreachable. Two modals stacked is never the answer.
 */
function onEditEvent(eventId) {
  rollOpen.value = false
  if (!isWide.value) return router.push(`/schedule/${eventId}`)
  editId.value = eventId
  editOpen.value = true
}

function openRoll(session) {
  rollFor.value = {
    eventId: session.eventId,
    date: session.date,
    title: session.title,
    cohorts: session.cohorts,
  }
  rollOpen.value = true
}

/**
 * A dragged tile. ONE date, never the series — the user dragged one tile, and a
 * tile is one date. Silently rewriting every future Tuesday because somebody
 * nudged next week is the direct-manipulation betrayal, and there is no undo
 * stack. The toast says which it did.
 */
async function onReschedule({ eventId, date: d, startsAtLocal, was, title, revert }) {
  try {
    await rescheduleSession({ eventId, date: d, startsAtLocal })
    notify.success(
      `${title} moved to ${formatFacilityTime(`${d}T${startsAtLocal}:00`)}`,
      `${humanDate(d, { short: true })} only — the rest of the series is unchanged.`,
    )
    await load()
  } catch (err) {
    revert()
    notify.error(err?.data?.error ?? 'Could not move that session.')
  }
}
</script>

<template>
  <AppPage title="Schedule">
    <template #description>
      Separate schedules per cohort. A resident is on an event because they are on its
      roster, never because of their cohort.
    </template>
    <template #actions>
      <Button v-if="canManage" size="sm" @click="onNewEvent">
        <Plus class="size-4" /> New event
      </Button>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-5">
      <!-- ── The queue ──────────────────────────────────────────────────────
           Load-bearing, not a convenience. Since every tile on the calendar is
           now a solid primary tile, "needs attention" cannot be read off the
           grid by glancing — this band is where it lives. Do not remove it
           without putting that signal somewhere else first. -->
      <section v-if="queue.length">
        <div class="mb-2 flex items-center justify-between gap-3">
          <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            Needs a roll
          </h2>
          <span v-if="queue.length > QUEUE_SHOWN" class="text-muted-foreground text-xs tabular-nums">
            {{ queue.length }} total
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="s in queueShown"
            :key="`${s.occurrenceId}|${s.date}`"
            class="bg-card flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 shadow-[inset_3px_0_0_var(--warning)]"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13.5px] font-medium">
                {{ s.title }}
                <span class="text-muted-foreground text-[11px] tracking-wider uppercase">
                  · {{ cohortsLabel(s.cohorts) }}
                </span>
              </p>
              <p class="text-muted-foreground text-xs">
                {{ humanDate(s.date, { short: true }) }} ·
                <span class="tabular-nums">{{ formatFacilityTime(s.startsAt) }}</span> ·
                <span class="tabular-nums">{{ s.rosterCount }}</span> on roster ·
                {{ daysAgoLabel(s.date) }}
              </p>
            </div>
            <Button size="sm" variant="outline" @click="openRoll(s)">Take roll</Button>
          </div>
        </div>
      </section>

      <!-- ── The board ───────────────────────────────────────────────────────
           Owns its own toolbar and view switch: FullCalendar decides which
           dates are on screen, so anything that names the window has to read
           from it rather than compute alongside it. -->
      <AppScheduleCalendar
        :shared="shared"
        :lanes="lanes"
        :date="date"
        :can-manage="canManage"
        @open-roll="openRoll"
        @dates-set="onDatesSet"
        @create="onCreate"
        @reschedule="onReschedule"
      />
    </div>

    <AppRollSheet
      v-model:open="rollOpen"
      :session="rollFor"
      :can-manage="canManage"
      @saved="load"
      @edit-event="onEditEvent"
    />

    <!-- Siblings of the board, never inside it, and driven by refs — the same
         shape as every other dialog more than one screen opens. -->
    <AppEventCreateDialog v-model:open="createOpen" :prefill="createPrefill" @created="load" />
    <AppEventEditDialog
      v-model:open="editOpen"
      :event-id="editId"
      @saved="load"
      @deleted="load"
    />
  </AppPage>
</template>
