<script setup>
// Freeing a bed without discharging the resident.
//
// This used to fire immediately from a ghost button on the record page. It is
// not reversible in the way that implies: releasing writes `endedAt` on an
// append-only history row, and re-assigning opens a NEW row, so a mis-tap
// leaves a permanent spurious ended/started pair in the answer to "who slept in
// 12B on March 12". From a row menu, where the wrong row is one pixel away,
// that needed a gate.
//
// It asks for a reason rather than just confirming. `DELETE /residents/:id/bed`
// has always accepted one and the service writes `endedReason: reason ||
// 'released'` — the record page hardcoding 'released' was the only thing
// throwing that away.
const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: null },
  residentName: { type: String, default: '' },
  bedLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'released'])

const { releaseBed } = useResidents()
const notify = useNotify()

const reason = ref('')
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    reason.value = ''
    error.value = ''
  },
)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    // Blank falls through to the server's default rather than being sent as an
    // empty string, so history never records a reason of "".
    await releaseBed(props.residentId, reason.value.trim() || null)
    notify.success('Bed released')
    emit('update:open', false)
    emit('released')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not release the bed.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Release {{ bedLabel || 'the bed' }}</DialogTitle>
        <DialogDescription v-if="residentName">{{ residentName }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField
          v-slot="{ id }"
          label="Reason"
          description="Optional, and worth writing: bed history is what answers who was in a bed on a given night."
        >
          <Input :id="id" v-model="reason" placeholder="Moving apartments" />
        </AppField>

        <!-- The non-obvious consequence. Staff expect "release" to mean the
             person is gone; it does not. -->
        <p class="text-muted-foreground text-xs">
          {{ residentName || 'The resident' }} stays on the roster with no bed, and starts
          showing in notifications as awaiting placement. Use Discharge to close the stay.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending">Release bed</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
