<script setup>
// Logging hours worked, and amending an entry that was recorded wrong.
//
// One dialog for both, because they are the same form with one extra field: an
// amendment is a new entry that happens to point at an old one. Splitting them
// would mean two copies of every input and two places to fix a label.
//
// Takes `v-model:open` and scalars, no trigger of its own — both the record
// section and (later) the /service page open it. That is module 1's dialog rule
// and this is the case it exists for.
import { hours } from '~/utils/serviceHours.js'
import { facilityDateNow } from '~/utils/facilityTime.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: null },
  residentName: { type: String, default: '' },
  /** When set, this is an AMENDMENT of that entry rather than a new one. */
  amending: { type: Object, default: null },
  /**
   * With no residentId, the form grows a resident picker — the dashboard's
   * quick action opens this with nobody chosen yet. Rows: { id, fullName }.
   */
  residents: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'saved'])

const { logHours, amendEntry } = useServiceHours()
const notify = useNotify()

const form = reactive({
  hours: '',
  workedOn: '',
  location: '',
  supervisorName: '',
  supervisorPhone: '',
  note: '',
  amendmentReason: '',
})
const pickedResidentId = ref('')

/** The resident this entry is for — bound by the caller, or picked in-form. */
const effectiveResidentId = computed(() => props.residentId ?? (pickedResidentId.value || null))
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    pickedResidentId.value = ''
    const a = props.amending
    Object.assign(form, {
      // An amendment opens pre-filled with what is being corrected, so the
      // person only retypes the thing that was wrong.
      hours: a ? String(a.minutes / 60) : '',
      workedOn: a ? String(a.workedOn).slice(0, 10) : facilityDateNow(),
      location: a?.location ?? '',
      supervisorName: a?.supervisorName ?? '',
      supervisorPhone: a?.supervisorPhone ?? '',
      note: a?.note ?? '',
      amendmentReason: '',
    })
  },
)

const isAmendment = computed(() => Boolean(props.amending))
const valid = computed(
  () =>
    Boolean(effectiveResidentId.value || isAmendment.value) &&
    form.hours !== '' &&
    Number(form.hours) >= 0 &&
    form.workedOn &&
    form.location.trim() &&
    (!isAmendment.value || form.amendmentReason.trim()),
)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    const body = {
      hours: Number(form.hours),
      workedOn: form.workedOn,
      location: form.location.trim(),
      supervisorName: form.supervisorName.trim() || undefined,
      supervisorPhone: form.supervisorPhone.trim() || undefined,
      note: form.note.trim() || undefined,
    }
    if (isAmendment.value) {
      await amendEntry(props.amending.id, { ...body, amendmentReason: form.amendmentReason.trim() })
      notify.success('Entry amended')
    } else {
      await logHours(effectiveResidentId.value, body)
      notify.success('Hours logged')
    }
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save the entry.'
  } finally {
    pending.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('dateWorked', 'hours', 'location', 'note', 'resident', 'supervisor', 'theirPhone', 'whatWasWrong')
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ isAmendment ? 'Amend an entry' : 'Log service hours' }}</DialogTitle>
        <DialogDescription v-if="residentName">{{ residentName }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <p v-if="isAmendment" class="text-muted-foreground text-xs">
          This creates a new entry that replaces the original — the original stays on the
          record and stops counting. It starts unverified, because the sign-off was about
          figures that are changing.
        </p>

        <Field v-if="!residentId && !isAmendment">
          <FieldLabel :for="ids.resident">Resident<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
          <Select v-model="pickedResidentId" required>
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Whose hours are these?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in residents" :key="r.id" :value="r.id">
                {{ r.fullName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div class="flex gap-3">
          <Field class="w-32">
            <FieldLabel :for="ids.hours">Hours<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
            <Input :id="ids.hours" v-model="form.hours" type="number" step="0.25" min="0" max="24" required />
            <FieldDescription>Quarter hours, e.g. 3.5</FieldDescription>
          </Field>
          <Field class="flex-1">
            <FieldLabel :for="ids.dateWorked">Date worked<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
            <Input :id="ids.dateWorked" v-model="form.workedOn" type="date" required />
          </Field>
        </div>

        <Field>
          <FieldLabel :for="ids.location">Location<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
          <Input :id="ids.location" v-model="form.location" placeholder="Habitat ReStore" required />
          <FieldDescription>Required — an hour with no place is not defensible later.</FieldDescription>
        </Field>

        <div class="flex gap-3">
          <Field class="flex-1">
            <FieldLabel :for="ids.supervisor">Supervisor</FieldLabel>
            <Input :id="ids.supervisor" v-model="form.supervisorName" placeholder="Dana Cole" />
          </Field>
          <Field class="flex-1">
            <FieldLabel :for="ids.theirPhone">Their phone</FieldLabel>
            <Input :id="ids.theirPhone" v-model="form.supervisorPhone" placeholder="404-555-0143" />
            <FieldDescription>Verifying means ringing them.</FieldDescription>
          </Field>
        </div>

        <Field>
          <FieldLabel :for="ids.note">Note</FieldLabel>
          <Input :id="ids.note" v-model="form.note" placeholder="Optional" />
        </Field>

        <Field v-if="isAmendment">
          <FieldLabel :for="ids.whatWasWrong">What was wrong<span class="text-destructive" aria-hidden="true">*</span></FieldLabel>
          <Input
            :id="ids.whatWasWrong"
            v-model="form.amendmentReason"
            placeholder="Supervisor's sheet says 5 hours, not 8"
            required
          />
          <FieldDescription>Recorded permanently. Without it the record shows a number changed and nothing about why.</FieldDescription>
        </Field>

        <p v-if="isAmendment" class="text-muted-foreground text-xs">
          Was {{ hours(amending.minutes) }}. Zero hours voids the entry.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending || !valid">
            {{ isAmendment ? 'Save amendment' : 'Log hours' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
