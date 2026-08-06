<script setup>
// Moving a series — "the Tuesday group is Thursdays from now on".
//
// This exists because editing a recurrence rule in place is refused, and it is
// refused for a specific reason worth restating here: `expand()` checks whether
// the rule covers a date BEFORE it looks at recorded sessions, so rewriting the
// weekdays makes every past Tuesday stop being emitted by the board, the roll
// queue and the resident record while its attendance sits orphaned in the table.
//
// So this does not rewrite anything. It ends the current series the day before the
// change and starts a new one from that date, carrying the roster. Every past date
// keeps the rule that produced it, so the rolls stay readable — and two series is
// what the facility would say happened anyway.
import { WEEKDAYS, RECURRENCE, cohortsLabel } from '~/utils/schedule.js'
import { addDays, facilityDateNow, formatWallClock, humanDate } from '~/utils/facilityTime.js'

const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  /** From getEvent — needs `id`, `title`, timing, `cohorts` and `recorded`. */
  event: { type: Object, default: null },
})
const emit = defineEmits(['moved'])

const { moveSeries } = useSchedule()
const notify = useNotify()

const form = reactive({ from: '', startsAtLocal: '', durationMinutes: 60, weekdays: [], reason: '' })
const pending = ref(false)
const error = ref('')

// Pre-filled with the CURRENT shape, so the dialog opens showing what is true and
// the user changes only what is moving. Re-assigned on every open.
watch(open, (v) => {
  if (!v || !props.event) return
  error.value = ''
  const e = props.event
  // Default the start to tomorrow, or the day after the last record if that is
  // later — the earliest date the server will accept.
  const earliest = e.recorded?.lastRecordedDate
    ? addDays(e.recorded.lastRecordedDate, 1)
    : addDays(facilityDateNow(), 1)
  Object.assign(form, {
    from: earliest,
    startsAtLocal: e.startsAtLocal,
    durationMinutes: e.durationMinutes,
    weekdays: [...(e.weekdays ?? [])],
    reason: '',
  })
})

const floor = computed(() => {
  const last = props.event?.recorded?.lastRecordedDate
  return last ? addDays(last, 1) : addDays(facilityDateNow(), 1)
})

const isWeekly = computed(() => props.event?.recurrence === RECURRENCE.WEEKLY)

const valid = computed(
  () => Boolean(form.from) && form.durationMinutes > 0 && (!isWeekly.value || form.weekdays.length > 0),
)

function toggleWeekday(value) {
  const i = form.weekdays.indexOf(value)
  i === -1 ? form.weekdays.push(value) : form.weekdays.splice(i, 1)
}

async function submit() {
  if (!valid.value || pending.value) return
  pending.value = true
  error.value = ''
  try {
    const res = await moveSeries(props.event.id, {
      from: form.from,
      startsAtLocal: form.startsAtLocal,
      durationMinutes: Number(form.durationMinutes),
      weekdays: isWeekly.value ? form.weekdays : undefined,
      reason: form.reason.trim() || undefined,
    })
    notify.success(
      `${res.event.title} moved`,
      `The old series ends ${humanDate(res.previous.endsOn, { short: true, relative: false })}. The new one starts ${humanDate(res.event.startsOn, { short: true, relative: false })}.`,
    )
    open.value = false
    emit('moved', res.event)
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not move the series.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Move {{ event?.title }}</DialogTitle>
        <DialogDescription>
          This series stops the day before, and a new one starts with the roster it has now.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField
          v-slot="{ id }"
          label="New series starts"
          required
          :description="`No earlier than ${humanDate(floor, { short: true, relative: false })} — everything up to then is on the record.`"
        >
          <Input :id="id" v-model="form.from" type="date" :min="floor" required />
        </AppField>

        <div class="grid gap-4 sm:grid-cols-2">
          <AppField v-slot="{ id }" label="Starts at">
            <Input :id="id" v-model="form.startsAtLocal" type="time" required />
          </AppField>
          <AppField v-slot="{ id }" label="Minutes">
            <Input
              :id="id"
              v-model.number="form.durationMinutes"
              type="number"
              min="1"
              max="1440"
              required
            />
          </AppField>
        </div>

        <AppField v-if="isWeekly" label="On these days">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="d in WEEKDAYS"
              :key="d.value"
              type="button"
              class="min-h-9 rounded-md border px-2.5 text-xs transition-colors max-md:min-h-11 pointer-coarse:min-h-11"
              :class="
                form.weekdays.includes(d.value)
                  ? 'bg-accent border-foreground/30 font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50'
              "
              :aria-pressed="form.weekdays.includes(d.value)"
              :aria-label="d.full"
              @click="toggleWeekday(d.value)"
            >
              {{ d.label }}
            </button>
          </div>
        </AppField>

        <AppField
          v-slot="{ id }"
          label="Why"
          description="Optional, and kept with the new series."
        >
          <Input :id="id" v-model="form.reason" placeholder="Room reassigned, court order…" />
        </AppField>

        <!-- The consequence, in numbers rather than adjectives. This is the
             sentence that makes the two-events outcome expected rather than a
             surprise the user discovers on the board afterwards. -->
        <p class="text-muted-foreground text-xs">
          <template v-if="event?.recorded?.marked">
            {{ event.recorded.marked }} recorded
            {{ event.recorded.marked === 1 ? 'mark stays' : 'marks stay' }} on the current series,
            which ends
            {{ humanDate(addDays(form.from || floor, -1), { short: true, relative: false }) }}.
          </template>
          <template v-else>
            The current series ends
            {{ humanDate(addDays(form.from || floor, -1), { short: true, relative: false }) }} and
            keeps everything recorded against it.
          </template>
          The new series runs at
          <span class="text-foreground font-medium">{{ formatWallClock(form.startsAtLocal) }}</span>
          for {{ cohortsLabel(event?.cohorts ?? []) }}, with the same roster.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="pending || !valid">Move series</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
