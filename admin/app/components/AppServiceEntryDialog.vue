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

        <AppField v-if="!residentId && !isAmendment" label="Resident" required>
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
        </AppField>

        <div class="flex gap-3">
          <AppField
            v-slot="{ id }"
            label="Hours"
            description="Quarter hours, e.g. 3.5"
            class="w-32"
            required
          >
            <Input :id="id" v-model="form.hours" type="number" step="0.25" min="0" max="24" required />
          </AppField>
          <AppField v-slot="{ id }" label="Date worked" class="flex-1" required>
            <Input :id="id" v-model="form.workedOn" type="date" required />
          </AppField>
        </div>

        <AppField
          v-slot="{ id }"
          label="Location"
          description="Required — an hour with no place is not defensible later."
          required
        >
          <Input :id="id" v-model="form.location" placeholder="Habitat ReStore" required />
        </AppField>

        <div class="flex gap-3">
          <AppField v-slot="{ id }" label="Supervisor" class="flex-1">
            <Input :id="id" v-model="form.supervisorName" placeholder="Dana Cole" />
          </AppField>
          <AppField
            v-slot="{ id }"
            label="Their phone"
            description="Verifying means ringing them."
            class="flex-1"
          >
            <Input :id="id" v-model="form.supervisorPhone" placeholder="404-555-0143" />
          </AppField>
        </div>

        <AppField v-slot="{ id }" label="Note">
          <Input :id="id" v-model="form.note" placeholder="Optional" />
        </AppField>

        <AppField
          v-if="isAmendment"
          v-slot="{ id }"
          label="What was wrong"
          description="Recorded permanently. Without it the record shows a number changed and nothing about why."
          required
        >
          <Input
            :id="id"
            v-model="form.amendmentReason"
            placeholder="Supervisor's sheet says 5 hours, not 8"
            required
          />
        </AppField>

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
