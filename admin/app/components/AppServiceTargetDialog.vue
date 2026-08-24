<script setup>
// Setting the hours a resident owes for this stay.
//
// Managers only, server-side. Setting the obligation is not a hallway act the
// way logging and verifying are — it is usually a court order or a case
// manager's figure, and it is the number every other screen measures against.
import { hours } from '~/utils/serviceHours.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: null },
  residentName: { type: String, default: '' },
  /** `current.service`, for the current value and where it came from. */
  service: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'saved'])

const { setTarget } = useServiceHours()
const notify = useNotify()

const value = ref('')
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    // Pre-filled only when this stay carries its own figure. A phase default is
    // left blank on purpose, so saving without typing does not silently convert
    // an inherited default into a per-stay override.
    value.value =
      props.service?.targetSource === 'STAY' ? String(props.service.requiredMinutes / 60) : ''
  },
)

async function save(clear = false) {
  pending.value = true
  error.value = ''
  try {
    await setTarget(props.residentId, clear ? null : Number(value.value))
    notify.success(clear ? 'Target cleared' : 'Target set')
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not set the target.'
  } finally {
    pending.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('hoursForThisStay')
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Service hours target</DialogTitle>
        <DialogDescription v-if="residentName">{{ residentName }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="save(false)">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Field>
          <FieldLabel :for="ids.hoursForThisStay">Hours for this stay</FieldLabel>
          <Input :id="ids.hoursForThisStay" v-model="value" type="number" min="0" max="2000" step="1" />
          <FieldDescription>Whole hours. Leave blank and clear to fall back to the phase default.</FieldDescription>
        </Field>

        <p class="text-muted-foreground text-xs">
          <template v-if="service?.targetSource === 'STAY'">
            Currently {{ hours(service.requiredMinutes) }}, set for this stay.
          </template>
          <template v-else-if="service?.targetSource === 'PROGRAM'">
            Currently {{ hours(service.requiredMinutes) }} from the phase default. Setting a
            figure here overrides it for this stay only — and survives a phase change, which
            is the point: an order does not shrink because somebody moved up a phase.
          </template>
          <template v-else>
            No target is set and the phase carries no default, so nothing is owed and no
            progress is shown.
          </template>
        </p>

        <DialogFooter>
          <Button
            v-if="service?.targetSource === 'STAY'"
            type="button"
            variant="ghost"
            :disabled="pending"
            @click="save(true)"
          >
            Clear override
          </Button>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending || value === ''">Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
