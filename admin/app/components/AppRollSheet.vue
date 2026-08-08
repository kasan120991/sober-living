<script setup>
// Taking the roll.
//
// The screen this module exists for, and the one built mobile-first: a tech is
// standing in the room with a phone and twelve people in front of them. Every
// decision here is about taps.
//
//   - "Mark all attended" is at the TOP, because everyone-showed-up is the 90%
//     case. Twelve taps becomes one, plus corrections.
//   - One request saves the whole roll. Twelve round trips over house wifi is
//     how attendance ends up on a sheet of paper that never gets entered.
//   - Three buttons per person, not a dropdown. Absent and excused stay
//     distinct — "he did not come" and "he was allowed not to come" are
//     different facts, and collapsing them destroys the one that defends the
//     facility.
//
// This is all-staff on purpose. Setting the schedule is a manager's job;
// recording what happened at it is the job of whoever was in the room.
import { Check, Ellipsis, Pencil } from '@lucide/vue'
import { ATTENDANCE_SHORT, ATTENDANCE_STATUS, COHORT_LABEL, cohortsLabel } from '~/utils/schedule.js'
import { facilityDateOf, formatFacilityTime, formatWallClock, humanDate } from '~/utils/facilityTime.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /**
   * `{ eventId, date, title, cohorts }` — a session is addressed by the pair,
   * never an id: a future session has no row until this saves one, and a
   * both-cohorts event has one roll spanning two occurrences.
   */
  session: { type: Object, default: null },
  /** Whether to offer the event-level actions. Presentation; the server gates too. */
  canManage: { type: Boolean, default: false },
})
// `edit-event` rather than rendering the edit dialog here: the parent closes this
// sheet and opens that dialog, so two modals are never stacked. This sheet sets
// `pointer-events: none` on the body while open, which would make a dialog behind
// it unreachable anyway.
const emit = defineEmits(['update:open', 'saved', 'edit-event'])

const { getRoll, takeAttendance } = useSchedule()
const notify = useNotify()

const roll = ref(null)
const marks = reactive({})
const loading = ref(false)
const pending = ref(false)
const error = ref('')

// Keyed on the SESSION as well as `open`, not on `open` alone.
//
// Honest note on why, because the original comment here overstated it: with
// `watch(open)` the refetch fires on every false→true, so open → close → open a
// different tile always worked, and while the sheet IS open the overlay sets
// `pointer-events: none` on the body, so a click cannot reach another tile
// behind it. The "swapped session, stale roster" bug is therefore NOT reachable
// through the UI today.
//
// It stays keyed this way regardless, for one reason: the refetch's real
// dependency is which session is being shown, and `open` is a proxy for it that
// happens to be sound only while the sheet is modal. Anything that makes it
// non-modal — a side panel, a hover preview — turns a comment into a bug.
watch(
  () => (props.open && props.session ? `${props.session.eventId}|${props.session.date}` : null),
  async (key) => {
    if (!key) return
    error.value = ''
    roll.value = null
    for (const k of Object.keys(marks)) delete marks[k]
    loading.value = true
    try {
      const data = await getRoll(props.session.eventId, props.session.date)
      roll.value = data
      // Existing marks pre-select, so reopening a taken roll shows what was
      // recorded rather than a blank sheet somebody has to redo.
      //
      // An attendee AWAY ON A TRAVEL PASS pre-selects EXCUSED — but only when
      // nothing has been recorded for them, so a mark somebody deliberately
      // typed is never overwritten by a pass. This is the whole of module 9's
      // attendance integration, and where it lives is the decision: nothing is
      // written at approval time. Writing EXCUSED marks ahead would freeze the
      // event's SHAPE, because recordedAgainst() in schedule/write.js counts
      // attendance rows — so approving a five-day pass for somebody on a daily
      // group would block a manager from rescheduling that group, with a 409
      // giving no hint why. Pre-selecting instead keeps the mark real and
      // human-authored: a person opened the roll and saved it.
      for (const p of data.people) {
        if (p.status) marks[p.stayId] = p.status
        else if (p.onPass) marks[p.stayId] = ATTENDANCE_STATUS.EXCUSED
      }
    } catch (err) {
      error.value = err?.data?.error ?? 'Could not load this roll.'
    } finally {
      loading.value = false
    }
  },
)

const people = computed(() => roll.value?.people ?? [])
const markedCount = computed(() => Object.keys(marks).length)
const allMarked = computed(() => people.value.length > 0 && markedCount.value === people.value.length)

/**
 * "Mark all attended" SKIPS anyone away on a travel pass, and that is the one
 * thing about this button worth guarding. Without it, one tap records a
 * resident as present at a group they are two hundred miles from — a false
 * entry in the evidence this module exists to protect, made by the button most
 * likely to be pressed. Their EXCUSED stands, and the row says why.
 *
 * A per-row tap still overrides it: truth wins, exactly as a signed-out
 * resident found on site may be marked PRESENT on an apartment check.
 */
function markAll(status) {
  for (const p of people.value) {
    if (p.onPass && status !== ATTENDANCE_STATUS.EXCUSED) continue
    marks[p.stayId] = status
  }
}

async function submit() {
  pending.value = true
  error.value = ''
  try {
    await takeAttendance({
      eventId: props.session.eventId,
      date: props.session.date,
      marks: Object.entries(marks).map(([stayId, status]) => ({ stayId, status })),
    })
    notify.success('Roll saved')
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save the roll.'
  } finally {
    pending.value = false
  }
}

const STATUSES = [
  ATTENDANCE_STATUS.ATTENDED,
  ATTENDANCE_STATUS.ABSENT,
  ATTENDANCE_STATUS.EXCUSED,
]

const toneFor = (status, active) => {
  if (!active) return 'text-muted-foreground hover:bg-accent/60'
  if (status === ATTENDANCE_STATUS.ATTENDED) return 'bg-success/15 text-success font-semibold'
  if (status === ATTENDANCE_STATUS.ABSENT) return 'bg-destructive/15 text-destructive font-semibold'
  return 'bg-warning/15 text-warning font-semibold'
}
</script>

<template>
  <Sheet :open="open" @update:open="(v) => emit('update:open', v)">
    <SheetContent side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
      <SheetHeader class="border-b p-4">
        <!-- pe-9 reserves the lane SheetContent's own close button occupies: it is
             `absolute top-4 right-4`, so without this it lands directly on top of
             the ellipsis and silently swallows every click on it. -->
        <div class="flex items-start gap-2 pe-9">
          <SheetTitle class="min-w-0 flex-1 text-[15px]">{{ session?.title ?? 'Roll' }}</SheetTitle>
          <!-- The only way into the event itself. Follows AppBedTable's row-action
               shape: ghost ellipsis, content aligned end, `@select`, and `…` on an
               item that opens a dialog. Managers only — taking the roll is
               all-staff, setting the schedule is not. -->
          <DropdownMenu v-if="canManage && session">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="-mt-1 shrink-0" aria-label="Event actions">
                <Ellipsis class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem @select="emit('edit-event', session.eventId)">
                <Pencil class="size-4" /> Edit event…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p v-if="roll" class="text-muted-foreground text-xs">
          {{ cohortsLabel(roll.cohorts) }} · {{ humanDate(roll.date, { short: true }) }} ·
          <span class="tabular-nums">{{ formatWallClock(roll.startsAtLocal) }}</span> ·
          <span class="tabular-nums">{{ people.length }}</span> on roster
        </p>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Alert v-if="error" variant="destructive" class="m-4 mb-0">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <p v-if="loading" class="text-muted-foreground p-4 text-sm">Loading…</p>

        <template v-else-if="roll">
          <p v-if="roll.cancelledAt" class="text-warning border-b p-4 text-sm">
            This session was cancelled{{ roll.cancelReason ? ` — ${roll.cancelReason}` : '' }}.
          </p>

          <p v-if="roll.attendanceTakenAt" class="text-muted-foreground border-b px-4 py-2 text-xs">
            Roll taken by {{ roll.attendanceTakenBy?.fullName ?? 'staff' }} at
            <span class="tabular-nums">{{ formatFacilityTime(roll.attendanceTakenAt) }}</span
            >. Changing a mark corrects it in place.
          </p>

          <!-- The 90% case, first and full width. -->
          <div v-if="people.length" class="border-b p-3">
            <Button
              class="w-full"
              variant="outline"
              @click="markAll(ATTENDANCE_STATUS.ATTENDED)"
            >
              <Check class="size-4" /> Mark all attended
            </Button>
          </div>

          <div v-if="people.length" class="flex flex-col">
            <div
              v-for="p in people"
              :key="p.stayId"
              class="flex min-h-14 items-center gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13.5px]">{{ p.fullName }}</p>
                <p class="text-muted-foreground truncate text-[11px]">
                  <!-- One alphabetical list, never grouped by cohort: grouping
                       would rebuild two sheets inside one panel, which is the
                       thing being removed, and "Mark all attended" would stop
                       meaning everyone. The badge is how a mixed roster reads. -->
                  <template v-if="roll.cohorts.length === 2">
                    {{ COHORT_LABEL[p.cohort] }} ·
                  </template>
                  <template v-if="p.offRoster">No longer on this roster</template>
                  <!-- Dates, not the destination — the roll sheet is held up
                       in a room full of residents, so it follows the census
                       tile's rule rather than the work-queue exception. -->
                  <template v-else-if="p.onPass">
                    On a travel pass · back {{ humanDate(facilityDateOf(p.onPass.returnBy), { short: true }) }}
                  </template>
                  <template v-else>
                    {{ p.programName ?? 'No program' }}
                    <template v-if="p.bedLabel"> · {{ p.bedLabel }}</template>
                  </template>
                </p>
              </div>

              <div class="inline-flex shrink-0 overflow-hidden rounded-md border">
                <button
                  v-for="s in STATUSES"
                  :key="s"
                  type="button"
                  class="px-2.5 text-[11px] transition-colors max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
                  :class="toneFor(s, marks[p.stayId] === s)"
                  :aria-pressed="marks[p.stayId] === s"
                  :aria-label="`${ATTENDANCE_SHORT[s]} — ${p.fullName}`"
                  @click="marks[p.stayId] = s"
                >
                  {{ ATTENDANCE_SHORT[s] }}
                </button>
              </div>
            </div>
          </div>

          <p v-else class="text-muted-foreground p-4 text-sm">
            Nobody is on this roster yet. Add attendees from the event to take a roll.
          </p>
        </template>
      </div>

      <SheetFooter v-if="roll && people.length" class="border-t p-4">
        <div class="flex w-full items-center gap-3">
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ markedCount }} of {{ people.length }} marked
          </span>
          <Button
            class="ms-auto"
            :disabled="pending || markedCount === 0 || Boolean(roll.cancelledAt)"
            @click="submit"
          >
            {{ allMarked ? 'Save roll' : `Save ${markedCount}` }}
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
