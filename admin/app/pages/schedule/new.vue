<script setup>
// Creating an event — the STACKED shell, and the phone's answer.
//
// Above `md` the Schedule page and the calendar open AppEventCreateDialog
// instead of navigating here. This page is what they route to below `md`,
// because a two-column dialog has no phone form and a roster picker in a dialog
// is a scroll trap — the concern CLAUDE.md recorded when it chose a page in the
// first place, which still holds.
//
// It is not a degraded copy. Every field, rule and confirmation lives in
// AppEventForm; this supplies a page heading, a footer, and `layout="stacked"`.
// The dialog supplies its own two of those. Nothing is duplicated, so the two
// cannot drift.
//
// The route stays a live deep link at EVERY width — the calendar has always
// navigated with ?date=&time=&minutes=, and a bookmarked URL should not break
// because a dialog was added elsewhere.
const router = useRouter()
const route = useRoute()

// Read here rather than in the form: on this shell the prefill arrives as a
// query string, in the dialog as a prop. The form validates whatever it is given.
const prefill = {
  date: route.query.date,
  time: route.query.time,
  minutes: route.query.minutes,
}
</script>

<template>
  <AppPage title="New event" :back="{ label: 'Schedule', to: '/schedule' }">
    <template #description>
      One event, one time. Choose who attends — the men, the women, or both. A both-cohorts
      event is one meeting with one roster and one roll.
    </template>

    <div class="max-w-3xl">
      <AppEventForm layout="stacked" :prefill="prefill" @created="router.push('/schedule')">
        <template #footer="{ valid, pending, count }">
          <div class="flex items-center gap-3 border-t pt-5">
            <span class="text-muted-foreground text-xs tabular-nums">
              {{ count }} {{ count === 1 ? 'resident' : 'residents' }} on the roster
            </span>
            <div class="ms-auto flex gap-2">
              <Button type="button" variant="ghost" @click="router.push('/schedule')">
                Cancel
              </Button>
              <Button type="submit" :disabled="pending || !valid">Create event</Button>
            </div>
          </div>
        </template>
      </AppEventForm>
    </div>
  </AppPage>
</template>
