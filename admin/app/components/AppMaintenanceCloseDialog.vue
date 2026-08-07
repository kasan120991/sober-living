<script setup>
/**
 * Close a request — RESOLVED or CANCELLED — with the note that makes it a
 * record. `v-model:open` and scalars, because two screens open it: the
 * maintenance queue and the apartment detail list.
 *
 * The note is required by a database CHECK, not just by this form. Saying so
 * here only names the field before a round trip.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  requestId: { type: String, default: null },
  requestTitle: { type: String, default: '' },
  /** 'RESOLVED' or 'CANCELLED'. */
  mode: { type: String, default: 'RESOLVED' },
})
const emit = defineEmits(['update:open', 'done'])

const { closeRequest } = useMaintenance()
const notify = useNotify()

const note = ref('')
const pending = ref(false)
const error = ref('')

const cancelling = computed(() => props.mode === 'CANCELLED')

watch(
  () => props.open,
  (v) => {
    if (v) {
      note.value = ''
      error.value = ''
    }
  },
)

async function submit() {
  if (!note.value.trim()) {
    error.value = cancelling.value
      ? 'Say why it is being cancelled.'
      : 'Say what was done before closing.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await closeRequest(props.requestId, { status: props.mode, note: note.value.trim() })
    notify.success(cancelling.value ? 'Request cancelled' : 'Request resolved')
    emit('update:open', false)
    emit('done')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not close the request.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>{{ cancelling ? 'Cancel request' : 'Resolve request' }}</DialogTitle>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <p class="text-sm">{{ requestTitle }}</p>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <AppField
          v-slot="{ id }"
          :label="cancelling ? 'Why it is being cancelled' : 'What was done'"
          description="Required. A request that just disappears leaves no record of what was fixed."
        >
          <Textarea
            :id="id"
            v-model="note"
            :rows="3"
            :placeholder="cancelling ? 'Duplicate of the Apt 14 report.' : 'Replaced the latch.'"
          />
        </AppField>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Back</Button>
          <Button type="submit" :disabled="pending">
            {{ cancelling ? 'Cancel request' : 'Resolve' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
