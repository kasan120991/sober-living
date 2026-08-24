<script setup>
// Discontinuing a medication — its own dialog because it carries its own rule
// and its own required reason, the way maintenance's close does rather than
// hiding inside a general edit.
//
// Two things it must say out loud, because both are refusals somebody will
// otherwise meet as a raw 409:
//   - the end date can never precede a dose already recorded, and
//   - the medication stays on the record afterwards. It is ended, not removed.
import { facilityDateNow } from '~/utils/facilityTime.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  medication: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'saved'])

const { discontinueMedication } = useMeds()
const notify = useNotify()

const endsOn = ref(facilityDateNow())
const reason = ref('')
const busy = ref(false)
const error = ref('')

watch(
  () => (props.open ? props.medication?.id : null),
  (id) => {
    if (!id) return
    error.value = ''
    reason.value = ''
    endsOn.value = facilityDateNow()
  },
  { immediate: true },
)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await discontinueMedication(props.medication.id, {
      endsOn: endsOn.value,
      endReason: reason.value.trim(),
    })
    notify.success(`${props.medication.name} discontinued`)
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not discontinue this medication.'
  } finally {
    busy.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('lastDay', 'reason')
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Discontinue {{ medication?.name }}</DialogTitle>
        <DialogDescription>
          Anything already given on the last day is kept. Anything not yet given stops
          straight away — it will never show as due or missed. The medication stays on
          the record with the reason.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Field>
          <FieldLabel :for="ids.lastDay">Last day</FieldLabel>
          <Input :id="ids.lastDay" v-model="endsOn" type="date" />
          <FieldDescription>Cannot be earlier than a dose already recorded.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel :for="ids.reason">Reason</FieldLabel>
          <Input
            :id="ids.reason"
            v-model="reason"
            placeholder="Prescriber stopped it at the 30-day review."
            required
          />
          <FieldDescription>Required — this is what an auditor asks about.</FieldDescription>
        </Field>

        <DialogFooter class="border-t pt-4">
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="busy || !reason.trim()">Discontinue</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
