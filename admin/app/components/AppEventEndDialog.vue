<script setup>
// Ending a series.
//
// The operation for a group that has stopped running, and the ONLY way to stop one
// that has a record against it. Deleting such an event would soft-delete it out of
// every resident record and silently erase attendance a licensing audit may need;
// ending it leaves every past session and every mark exactly where they are.
//
// Built as a small confirm dialog rather than the "Last date" field in the edit
// form, following AppResidentDischargeDialog: the subject is NAMED in the title,
// the consequence is stated in words, and the number that matters is on screen. A
// consequential write should not look like typing in a date box.
//
// The date has a FLOOR, and it is the real reason this needs care. `occursOn`
// returns false past `endsOn`, so ending a series before its last recorded date
// orphans those sessions exactly as changing the weekdays would. The server holds
// the line; this stops somebody reaching for a date that will be refused.
import { formatWallClock, humanDate } from '~/utils/facilityTime.js'

const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  /** From getEvent — needs `id`, `title`, `endsOn` and `recorded`. */
  event: { type: Object, default: null },
})
const emit = defineEmits(['ended'])

const { updateEvent } = useSchedule()
const notify = useNotify()

const endsOn = ref('')
const pending = ref(false)
const error = ref('')

// Re-filled on every open, so the dialog never carries the previous attempt's
// date onto a screen whose output is a permanent record.
watch(open, (v) => {
  if (!v) return
  error.value = ''
  endsOn.value = props.event?.endsOn ?? ''
})

/** No earlier than the last date carrying a record — below that, history vanishes. */
const floor = computed(() => props.event?.recorded?.lastRecordedDate ?? null)

const recordedLabel = computed(() => {
  const r = props.event?.recorded
  if (!r) return ''
  const bits = []
  if (r.marked) bits.push(`${r.marked} recorded ${r.marked === 1 ? 'mark' : 'marks'}`)
  if (r.cancelled) bits.push(`${r.cancelled} cancelled ${r.cancelled === 1 ? 'session' : 'sessions'}`)
  return bits.join(' and ')
})

async function submit() {
  if (!endsOn.value) {
    error.value = 'Choose the last date this series runs.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    const saved = await updateEvent(props.event.id, { endsOn: endsOn.value })
    notify.success(`${saved.title} ends ${humanDate(endsOn.value, { short: true, relative: false })}`)
    open.value = false
    emit('ended', saved)
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not end the series.'
  } finally {
    pending.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('lastDate')
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <!-- Named, so it is impossible to end the wrong series from a menu where
             the wrong row is one pixel away. -->
        <DialogTitle>End {{ event?.title }}</DialogTitle>
        <DialogDescription>
          The series stops running after the date you choose. Nothing already recorded changes.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Field>
          <FieldLabel :for="ids.lastDate">Last date<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
          <Input :id="ids.lastDate" v-model="endsOn" type="date" :min="floor ?? undefined" required />
          <FieldDescription>{{
            floor
              ? `No earlier than ${humanDate(floor, { short: true, relative: false })} — there is a record on that date.`
              : 'The final date this series runs.'
           }}</FieldDescription>
        </Field>

        <p class="text-muted-foreground text-xs">
          Sessions up to this date stay exactly as they are<template v-if="recordedLabel">,
          including {{ recordedLabel }}</template>. To stop it running and remove it entirely you
          would have to delete it, and an event with a record against it cannot be deleted.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="pending">End series</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
