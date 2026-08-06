<script setup>
// Assigning a bed from the census board — the bed is fixed, you pick the person.
//
// The mirror image of AppResidentBedDialog, and deliberately a separate
// component rather than a `mode` on that one. The two share exactly one line,
// `assignBed()`; everything else forks — that one fetches free beds on open,
// this one is handed its candidates, and the title, field, empty state and
// disable rule all differ. AppResidentReleaseBedDialog is the precedent: one
// small dialog per act, against the same endpoint family.
const props = defineProps({
  open: { type: Boolean, default: false },
  bedId: { type: String, default: null },
  /** "Apt 14 · Bed C" — composed by the page, which has the apartment in scope. */
  bedLabel: { type: String, default: '' },
  cohort: { type: String, default: null },
  /** `[{ id, fullName }]`, already filtered to this bed's cohort by the page. */
  candidates: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'assigned'])

const { assignBed } = useResidents()
const notify = useNotify()

const chosen = ref('')
const pending = ref(false)
const error = ref('')
const wentStale = ref(false)

const cohortLabel = computed(() => (props.cohort === 'MEN' ? 'Men' : 'Women'))

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    wentStale.value = false
    // One person waiting is the common case, so it should be one tap and Assign.
    chosen.value = props.candidates[0]?.id ?? ''
  },
)

// `POST /residents/:id/bed` is assign-OR-move: it closes whatever assignment the
// stay currently holds. So if this list goes stale — someone else placed them
// while the dialog sat open — submitting would quietly MOVE them here and write
// a spurious ended/started pair into bed history, which is permanent evidence
// for "who slept in 12B on March 12". The page keeps `candidates` a computed
// over live census data; this is the other half, catching the selection the
// moment it stops being unhoused.
watch(
  () => props.candidates,
  (list) => {
    if (!props.open || !chosen.value) return
    if (!list.some((c) => c.id === chosen.value)) {
      chosen.value = ''
      wentStale.value = true
    }
  },
  { deep: true },
)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    // Arguments swapped relative to every other caller: the resident is the
    // variable here and the bed is fixed. Same endpoint either way.
    await assignBed(chosen.value, props.bedId)
    notify.success('Bed assigned')
    emit('update:open', false)
    emit('assigned')
  } catch (err) {
    // Left open on failure rather than closed: the likeliest error is another
    // manager taking this bed first, and the answer to that is to pick a
    // different tile, not to retype anything.
    error.value = err?.data?.error ?? 'Could not assign the bed.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Assign a resident</DialogTitle>
        <DialogDescription v-if="bedLabel">{{ bedLabel }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField
          label="Resident"
          :description="`${cohortLabel} awaiting a bed. Assigning opens a new bed-history row — the board updates for everyone.`"
        >
          <Select v-model="chosen" :disabled="!candidates.length">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Select a resident" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="c in candidates" :key="c.id" :value="c.id">
                {{ c.fullName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <p v-if="wentStale" class="text-warning text-sm">
          They have since been given a bed. Pick someone else, or close this.
        </p>
        <p v-else-if="!candidates.length" class="text-warning text-sm">
          Nobody is awaiting a bed in this cohort.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending || !chosen">Assign</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
