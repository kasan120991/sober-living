<script setup>
// Editing an event. The create dialog's twin, md and up.
//
// `v-model:open` and no trigger of its own: the roll sheet opens this, and so
// will an event list later. Below `md` the callers route to /schedule/<id>, which
// renders the same AppEventForm stacked — the dialog is a desktop affordance and
// a roster picker in one on a phone is the scroll trap CLAUDE.md warned about.
//
// ── What this dialog can and cannot offer ──────────────────────────────────
// Which fields are live depends on what has been RECORDED, not on a permission:
// once a roll has been taken or a session cancelled, when the event runs is part
// of the record, and rewriting the recurrence would take those sessions off every
// read path. AppEventForm locks those fields and explains why; the server refuses
// them independently. Identity and the roster stay live throughout.
//
// The footer's left-hand action is the destructive one, following
// AppApartmentEdit: "Delete event" while nothing is recorded, "End series…" once
// something is — never both, because only one of them can ever succeed.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  /** The event id. Fetched here rather than passed, so the caller needs only an id. */
  eventId: { type: String, default: null },
})
const emit = defineEmits(['saved', 'deleted'])

const { getEvent, deleteEvent } = useSchedule()
const notify = useNotify()

const event = ref(null)
const loading = ref(false)
const error = ref('')
const endOpen = ref(false)
const moveOpen = ref(false)

// Keyed on the EVENT as well as `open`, the same correctness the roll sheet
// needed: opening a second event must refetch rather than show the first one's
// roster under the second one's title.
watch(
  () => (open.value && props.eventId ? props.eventId : null),
  async (id) => {
    if (!id) return
    error.value = ''
    event.value = null
    loading.value = true
    try {
      event.value = await getEvent(id)
    } catch (err) {
      error.value = err?.data?.error ?? 'Could not load this event.'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const frozen = computed(() => Boolean(event.value?.recorded?.frozen))

async function reload() {
  event.value = await getEvent(props.eventId)
}

function onSaved(saved) {
  open.value = false
  emit('saved', saved)
}

/**
 * Delete, with no confirm dialog of its own — the house pattern for a delete the
 * SERVER can refuse (AppBedTable's "Remove bed", AppApartmentEdit's "Remove
 * apartment"). It is only offered when nothing is recorded, so the destructive
 * case cannot be reached from here at all; if that changes underneath us the
 * server says so and the message is shown verbatim.
 */
async function destroy() {
  try {
    await deleteEvent(props.eventId)
    notify.success('Event deleted')
    open.value = false
    emit('deleted')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not delete the event.'
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex max-h-[90vh] w-full flex-col gap-5 overflow-y-auto sm:max-w-5xl"
      @open-auto-focus.prevent
    >
      <DialogHeader>
        <DialogTitle>{{ event ? event.title : 'Event' }}</DialogTitle>
        <DialogDescription>
          <template v-if="event?.supersedesId">
            Continues an earlier series that was moved.
          </template>
          <template v-else>
            One event, one time, one roster. The roster stays editable whatever has been
            recorded.
          </template>
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <p v-if="loading" class="text-muted-foreground text-sm">Loading…</p>

      <AppEventForm
        v-else-if="event"
        :key="event.id"
        layout="columns"
        :event="event"
        @saved="onSaved"
        @move="moveOpen = true"
      >
        <template #footer="{ valid, pending, count }">
          <DialogFooter class="border-t pt-4 sm:justify-between">
            <!-- One action that changes meaning. Delete is impossible once anything
                 is recorded, so it is replaced rather than disabled — a permanently
                 dead button teaches nothing, and absence of a control meaning
                 "not possible" is the rule the rest of the app follows. -->
            <Button
              v-if="frozen"
              type="button"
              variant="ghost"
              class="text-destructive"
              @click="endOpen = true"
            >
              End series…
            </Button>
            <Button v-else type="button" variant="ghost" class="text-destructive" @click="destroy">
              Delete event
            </Button>

            <div class="flex items-center gap-3">
              <span class="text-muted-foreground text-xs tabular-nums">
                {{ count }} {{ count === 1 ? 'resident' : 'residents' }}
              </span>
              <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
              <Button type="submit" :disabled="pending || !valid">Save changes</Button>
            </div>
          </DialogFooter>
        </template>
      </AppEventForm>

      <AppEventEndDialog
        v-model:open="endOpen"
        :event="event"
        @ended="
          (e) => {
            reload()
            emit('saved', e)
          }
        "
      />
      <AppEventMoveDialog
        v-model:open="moveOpen"
        :event="event"
        @moved="
          (e) => {
            open = false
            emit('saved', e)
          }
        "
      />
    </DialogContent>
  </Dialog>
</template>
