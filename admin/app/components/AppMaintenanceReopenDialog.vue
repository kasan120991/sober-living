<script setup>
/**
 * Reopen a closed request.
 *
 * The description is doing real work: it tells the user the earlier closure is
 * NOT being undone. That is true now — a REOPENED row is appended beside it —
 * and it was not before 2026-08-07, when reopening wiped the resolution.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  requestId: { type: String, default: null },
  requestTitle: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'done'])

const { reopenRequest } = useMaintenance()
const notify = useNotify()

const note = ref('')
const pending = ref(false)
const error = ref('')

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
    error.value = 'Say why it is being reopened.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await reopenRequest(props.requestId, { note: note.value.trim() })
    notify.success('Request reopened')
    emit('update:open', false)
    emit('done')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not reopen the request.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader><DialogTitle>Reopen request</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <p class="text-sm">{{ requestTitle }}</p>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <AppField
          v-slot="{ id }"
          label="Why it is being reopened"
          description="The earlier closure stays on the record — this is added beside it, never over it."
        >
          <Textarea :id="id" v-model="note" :rows="3" placeholder="Cold again within the week." />
        </AppField>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Back</Button>
          <Button type="submit" :disabled="pending">Reopen</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
