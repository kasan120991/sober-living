<script setup>
// Editing an event — the STACKED shell, and the phone's answer.
//
// Above `md` the schedule board opens AppEventEditDialog instead of navigating
// here. This is what it routes to below `md`, because a two-column dialog has no
// phone form and a roster picker in one is a scroll trap.
//
// Also a live deep link at every width: an event id in a URL should open the
// event, whatever device it was pasted into. Nuxt resolves the static
// `schedule/new` before this dynamic segment, so the two routes coexist.
//
// Not a degraded copy — every field and rule lives in AppEventForm, and the end
// and move dialogs are the same components the wide dialog uses.
const route = useRoute()
const router = useRouter()
const { getEvent, deleteEvent } = useSchedule()
const notify = useNotify()

const event = ref(null)
const pending = ref(true)
const error = ref('')
const endOpen = ref(false)
const moveOpen = ref(false)

async function load() {
  // Only blank when arriving or switching events, never on a realtime refresh of
  // the one already open.
  pending.value = event.value?.id !== route.params.id
  try {
    event.value = await getEvent(route.params.id)
    error.value = ''
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not load this event.'
  } finally {
    pending.value = false
  }
}
watch(() => route.params.id, load, { immediate: true })
onRealtimeChanged(load)

const frozen = computed(() => Boolean(event.value?.recorded?.frozen))

async function destroy() {
  try {
    await deleteEvent(route.params.id)
    notify.success('Event deleted')
    router.push('/schedule')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not delete the event.'
  }
}
</script>

<template>
  <AppPage
    :title="event?.title ?? 'Event'"
    :back="{ label: 'Schedule', to: '/schedule' }"
  >
    <template #description>
      <template v-if="event?.supersedesId">Continues an earlier series that was moved.</template>
      <template v-else>
        One event, one time, one roster. The roster stays editable whatever has been recorded.
      </template>
    </template>

    <Alert v-if="error" variant="destructive" class="max-w-3xl">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else-if="event" class="max-w-3xl">
      <AppEventForm
        :key="event.id"
        layout="stacked"
        :event="event"
        @saved="router.push('/schedule')"
        @move="moveOpen = true"
      >
        <template #footer="{ valid, pending: saving, count }">
          <div class="flex flex-wrap items-center gap-3 border-t pt-5">
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

            <div class="ms-auto flex items-center gap-3">
              <span class="text-muted-foreground text-xs tabular-nums">
                {{ count }} {{ count === 1 ? 'resident' : 'residents' }}
              </span>
              <Button type="button" variant="ghost" @click="router.push('/schedule')">Cancel</Button>
              <Button type="submit" :disabled="saving || !valid">Save changes</Button>
            </div>
          </div>
        </template>
      </AppEventForm>

      <AppEventEndDialog v-model:open="endOpen" :event="event" @ended="load" />
      <AppEventMoveDialog
        v-model:open="moveOpen"
        :event="event"
        @moved="(e) => router.push(`/schedule/${e.id}`)"
      />
    </div>
  </AppPage>
</template>
