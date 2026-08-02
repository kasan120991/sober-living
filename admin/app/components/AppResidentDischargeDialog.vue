<script setup>
// Closing a stay.
//
// The name in the title is not decoration: opened from a roster row you are not
// on the person's page, and this is the one action in the app that cannot be
// undone. It should be impossible to discharge the wrong resident because the
// dialog never said who it was about.
import { DISCHARGE_TYPES } from '~/composables/useResidents.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: null },
  residentName: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'discharged'])

const { dischargeResident } = useResidents()
const notify = useNotify()

const pending = ref(false)
const error = ref('')
const form = reactive({ dischargeType: 'SUCCESSFUL', dischargeReason: '' })

// The inline version this replaced never reset, so cancelling a discharge and
// reopening showed the previous reason and the previous error — on a screen
// where the text becomes a permanent record.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    form.dischargeType = 'SUCCESSFUL'
    form.dischargeReason = ''
  },
)

async function submit() {
  error.value = ''
  if (!form.dischargeReason.trim()) {
    error.value = 'A discharge needs a reason.'
    return
  }
  pending.value = true
  try {
    await dischargeResident(props.residentId, { ...form })
    notify.success(`${props.residentName || 'Resident'} discharged`)
    emit('update:open', false)
    emit('discharged')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not complete the discharge.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Discharge {{ residentName }}</DialogTitle>
        <DialogDescription>This closes the stay and frees the bed.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField label="Type">
          <Select v-model="form.dischargeType">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="d in DISCHARGE_TYPES" :key="d.value" :value="d.value">
                {{ d.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <AppField
          v-slot="{ id }"
          label="Reason"
          description="Required. This is the record that explains the discharge to a referral source or an audit."
        >
          <Textarea :id="id" v-model="form.dischargeReason" :rows="3" />
        </AppField>

        <p class="text-muted-foreground text-xs">
          This cannot be undone. A mistake is corrected by a new intake, not by editing
          this one.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending">Discharge</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
