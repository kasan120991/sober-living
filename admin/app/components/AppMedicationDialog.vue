<script setup>
// Putting a resident ON a medication, and correcting the entry afterwards.
//
// ADD AND EDIT ARE ONE MODAL IN TWO MODES, never two components — the
// AppMaintenanceDetailDialog rule. Two forms is how the add path comes to
// accept a shape the edit path refuses.
//
// Managers only, matching the server: recording a dose is a hallway act, but
// deciding what somebody takes is not. The dialog is simply not rendered for a
// tech — and that is presentation, not protection. The route refuses either
// way.
//
// This component existing at all is the fix for a real gap: the API and the
// read-only record section shipped without it, so a medication could only be
// created by calling the API by hand. Exactly the failure CLAUDE.md records
// against module 10's vendorName — a column whose whole justification was
// getting something out of a description, with nothing in the UI able to set it.
import { X } from '@lucide/vue'
import { facilityDateNow, facilityDateOf, formatWallClock } from '~/utils/facilityTime.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: null },
  /** Pass a medication to edit it; omit to add a new one. */
  medication: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'saved'])

const { addMedication, editMedication } = useMeds()
const notify = useNotify()

const blank = () => ({
  name: '',
  dosage: '',
  instructions: '',
  prescriber: '',
  pharmacy: '',
  isPrn: false,
  times: [],
  startsOn: facilityDateNow(),
})

const form = reactive(blank())
const newTime = ref(undefined)
const busy = ref(false)
const error = ref('')

const editing = computed(() => Boolean(props.medication))

watch(
  () => (props.open ? (props.medication?.id ?? 'new') : null),
  (key) => {
    if (!key) return
    error.value = ''
    newTime.value = undefined
    Object.assign(form, blank())
    if (props.medication) {
      const m = props.medication
      Object.assign(form, {
        name: m.name,
        dosage: m.dosage,
        instructions: m.instructions ?? '',
        prescriber: m.prescriber ?? '',
        pharmacy: m.pharmacy ?? '',
        isPrn: m.isPrn,
        times: [...m.times],
        startsOn: facilityDateOf(m.startsOn),
      })
    }
  },
  { immediate: true },
)

/**
 * Times are CHOSEN FROM A LIST, not typed.
 *
 * This replaced an <input type="time"> plus an "Add time" button, and the
 * reason is worth keeping because the native control looked like the obvious
 * choice and was the wrong one. In a 12-hour locale it has THREE segments —
 * hour, minute, AM/PM — and it reports `value` as an EMPTY STRING until every
 * one of them is filled. So somebody types 8, then 00, sees "08:00" sitting in
 * the field, and the app still has nothing. The button did nothing, silently,
 * and no amount of disabling or hinting makes a control usable when the user
 * has visibly done the thing and the machine disagrees.
 *
 * A dropdown cannot reach that state. There is no partial selection, no locale
 * parsing, no keyboard sequence to get wrong, and picking commits immediately —
 * so the separate Add step is gone too. Half-hour granularity because a med
 * pass is a round time by nature; the seed and the facility both use whole
 * hours.
 */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  return { value, label: formatWallClock(value) }
})

/** Picking a time IS adding it. Idempotent, so a re-pick is harmless. */
function addTime(t) {
  if (!t) return
  if (!form.times.includes(t)) form.times = [...form.times, t].sort()
  // Reka's Select reserves '' for "cleared", so reset to undefined — the
  // sentinel rule in CLAUDE.md's UI notes.
  newTime.value = undefined
}
const dropTime = (t) => (form.times = form.times.filter((x) => x !== t))

// The same pairing the database enforces: a scheduled medication needs at least
// one time, an as-needed one carries none. Refusing here only saves the round
// trip — the CHECK is what actually holds.
const canSave = computed(
  () =>
    form.name.trim() &&
    form.dosage.trim() &&
    (form.isPrn ? form.times.length === 0 : form.times.length > 0),
)

// Switching to as-needed clears the schedule rather than leaving times behind
// that the server would refuse — the control says what it does.
watch(
  () => form.isPrn,
  (prn) => {
    if (prn) form.times = []
  },
)

async function submit() {
  busy.value = true
  error.value = ''
  const body = {
    name: form.name.trim(),
    dosage: form.dosage.trim(),
    instructions: form.instructions.trim() || undefined,
    prescriber: form.prescriber.trim() || undefined,
    pharmacy: form.pharmacy.trim() || undefined,
    isPrn: form.isPrn,
    times: form.times,
    startsOn: form.startsOn,
  }
  try {
    if (editing.value) {
      await editMedication(props.medication.id, body)
      notify.success('Medication updated')
    } else {
      await addMedication(props.residentId, body)
      notify.success('Medication added')
    }
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save this medication.'
  } finally {
    busy.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('dose', 'instructions', 'name', 'prescriber', 'starts', 'times')
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ editing ? 'Edit medication' : 'Add a medication' }}</DialogTitle>
        <DialogDescription>
          What the resident takes and when. Staff hand the dose over and observe it —
          the times below are when it appears on the med pass.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div class="flex gap-3">
          <Field class="flex-1">
            <FieldLabel :for="ids.name">Name</FieldLabel>
            <Input :id="ids.name" v-model="form.name" placeholder="Sertraline" required />
          </Field>
          <Field class="flex-1">
            <FieldLabel :for="ids.dose">Dose</FieldLabel>
            <Input :id="ids.dose" v-model="form.dosage" placeholder="50 mg, 1 tablet" required />
            <FieldDescription>As written on the label.</FieldDescription>
          </Field>
        </div>

        <Field>
          <FieldLabel :for="ids.instructions">Instructions</FieldLabel>
          <Input :id="ids.instructions" v-model="form.instructions" placeholder="With food" />
          <FieldDescription>Optional.</FieldDescription>
        </Field>

        <!-- Scheduled vs as-needed. The one control whose effect is another
             control's contents, so it sits directly above the times. -->
        <div class="flex items-center gap-3 rounded-md border px-3 py-2">
          <Switch id="prn" :model-value="form.isPrn" @update:model-value="form.isPrn = $event" />
          <label for="prn" class="flex-1 text-sm">
            As needed
            <span class="text-muted-foreground block text-xs">
              No set times. Logged when the resident actually takes it, never shown as due.
            </span>
          </label>
        </div>

        <Field v-if="!form.isPrn">
          <FieldLabel :for="ids.times">Times</FieldLabel>
          <div class="flex flex-col gap-2">
            <div v-if="form.times.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="t in form.times"
                :key="t"
                class="bg-accent flex items-center gap-1 rounded-full px-2.5 py-1 text-xs tabular-nums"
              >
                {{ formatWallClock(t) }}
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground"
                  :aria-label="`Remove ${formatWallClock(t)}`"
                  @click="dropTime(t)"
                >
                  <X class="size-3" />
                </button>
              </span>
            </div>
            <!-- Choosing a time adds it. No separate button, because there is
                 no half-entered state for one to guard against. -->
            <!-- Keyed on the count so the trigger returns to "Add a time…"
                 after each pick. Reka keeps its own display state, and clearing
                 the bound value alone leaves the last choice showing — which
                 makes an add-another control read as a single-choice one. -->
            <Select
              :key="form.times.length"
              :model-value="newTime"
              @update:model-value="addTime"
            >
              <SelectTrigger class="w-44">
                <SelectValue placeholder="Add a time…" />
              </SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem
                  v-for="t in TIME_OPTIONS"
                  :key="t.value"
                  :value="t.value"
                  :disabled="form.times.includes(t.value)"
                >
                  {{ t.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FieldDescription>Facility clock. An 8pm dose stays 8pm across daylight saving.</FieldDescription>
        </Field>

        <div class="flex gap-3">
          <Field class="flex-1">
            <FieldLabel :for="ids.prescriber">Prescriber</FieldLabel>
            <Input :id="ids.prescriber" v-model="form.prescriber" placeholder="Dr. Alvarez" />
            <FieldDescription>Optional.</FieldDescription>
          </Field>
          <Field class="flex-1">
            <FieldLabel :for="ids.starts">Starts</FieldLabel>
            <Input :id="ids.starts" v-model="form.startsOn" type="date" />
          </Field>
        </div>

        <!-- Say where the irreversibility is, at the point somebody is writing
             one — the AppLedgerEntryDialog habit. -->
        <p class="text-muted-foreground text-xs">
          A medication can be edited freely. Once a dose has been recorded against it, it
          can only be discontinued — never deleted, because that would hide the doses.
        </p>

        <DialogFooter class="border-t pt-4">
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="busy || !canSave">
            {{ editing ? 'Save changes' : 'Add medication' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
