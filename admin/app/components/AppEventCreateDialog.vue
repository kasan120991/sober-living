<script setup>
// Creating an event, as a wide two-column dialog. md and up only.
//
// Takes `v-model:open` and NO trigger of its own, per CLAUDE.md's dialog rule:
// two screens open this — the Schedule page's "New event" button and the
// calendar's click-empty-space — and a component that owns its trigger can only
// be opened where it is rendered.
//
// ── Why this exists when CLAUDE.md said "a page, not a dialog" ─────────────
// That note is still right about its own case: "a roster picker in a dialog is a
// scroll trap on a phone." The answer is not to overrule it but to bound it —
// this dialog is a DESKTOP affordance, and below `md` the callers route to
// /schedule/new instead of opening it. That page is not a fallback kept limping
// along; it renders the same AppEventForm with `layout="stacked"`, so there is
// one form with two shells and no second copy of any rule.
//
// The route also stays live as a deep link at every width — the calendar has
// always navigated with ?date=&time=&minutes=, and a URL somebody bookmarked
// should not stop working because a dialog was added.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  /** `{ date, time, minutes }` from click-empty-space. Passed straight through. */
  prefill: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['created'])

// Remounts the form on every open, which is what resets it. A create form that
// remembers last time's half-filled title is a bug, not a convenience.
const formKey = ref(0)
watch(open, (v) => v && formKey.value++)

function onCreated(created) {
  open.value = false
  emit('created', created)
}
</script>

<template>
  <Dialog v-model:open="open">
    <!-- Two columns need width, so this is far past the vendored `sm:max-w-md`.
         Capped at 5xl rather than left to grow: a form whose fields stretch to a
         27-inch monitor is harder to read, not easier.

         `max-h`/`overflow-y-auto` on the CONTENT, not the columns — one scrollbar
         for the dialog beats two that disagree about how far down you are. The
         roster keeps its own inner scroller, which is the one place a second one
         earns itself. -->
    <DialogContent
      class="flex max-h-[90vh] w-full flex-col gap-5 overflow-y-auto sm:max-w-5xl"
      @open-auto-focus.prevent
    >
      <DialogHeader>
        <DialogTitle>New event</DialogTitle>
        <DialogDescription>
          One event, one time, one roster — the men, the women, or both. A both-cohorts event
          is one meeting with one roster and one roll.
        </DialogDescription>
      </DialogHeader>

      <AppEventForm
        :key="formKey"
        layout="columns"
        :prefill="prefill"
        @created="onCreated"
        @cancel="open = false"
      >
        <template #footer="{ valid, pending, count }">
          <DialogFooter class="border-t pt-4">
            <div class="flex w-full items-center gap-3">
              <span class="text-muted-foreground text-xs tabular-nums">
                {{ count }} {{ count === 1 ? 'resident' : 'residents' }} on the roster
              </span>
              <Button type="button" variant="ghost" class="ms-auto" @click="open = false">
                Cancel
              </Button>
              <Button type="submit" :disabled="pending || !valid">Create event</Button>
            </div>
          </DialogFooter>
        </template>
      </AppEventForm>
    </DialogContent>
  </Dialog>
</template>
