<script setup>
/**
 * File a maintenance request.
 *
 * Extracted from `pages/apartments/[id].vue` on 2026-08-07, where it was
 * written inline and reachable from nowhere else — which is why `/maintenance`
 * had no way to file anything and you had to navigate to an apartment first.
 * Two screens open it now, so it takes `v-model:open` and no trigger of its
 * own, and scalars rather than an apartment object.
 *
 * `apartmentId` bound means the unit is decided (the apartment page); left
 * null, the form grows a picker (the queue). The AppLedgerEntryDialog pattern.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  /** Bound on the apartment page; null on the queue, which shows a picker. */
  apartmentId: { type: String, default: null },
})
const emit = defineEmits(['update:open', 'created'])

const { createRequest } = useMaintenance()
const { listApartments } = useApartments()
const notify = useNotify()

const apartments = ref([])
const form = reactive({ apartmentId: '', title: '', description: '', priority: 'NORMAL' })
const pending = ref(false)
const error = ref('')

const needsPicker = computed(() => !props.apartmentId)

watch(
  () => props.open,
  async (v) => {
    if (!v) return
    form.apartmentId = props.apartmentId ?? ''
    form.title = ''
    form.description = ''
    form.priority = 'NORMAL'
    error.value = ''
    if (needsPicker.value && !apartments.value.length) {
      apartments.value = await listApartments()
    }
  },
)

async function submit() {
  if (!form.title.trim()) {
    error.value = 'Say what is wrong.'
    return
  }
  if (!form.apartmentId) {
    error.value = 'Choose an apartment — a request is work on a unit.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await createRequest({
      apartmentId: form.apartmentId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
    })
    notify.success('Request filed')
    emit('update:open', false)
    emit('created')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not file the request.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader><DialogTitle>File a maintenance request</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField v-if="needsPicker" v-slot="{ id }" label="Apartment">
          <Select :id="id" v-model="form.apartmentId">
            <SelectTrigger><SelectValue placeholder="Choose an apartment" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="a in apartments" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <AppField v-slot="{ id }" label="What is wrong">
          <Input :id="id" v-model="form.title" placeholder="No hot water in the second bathroom" />
        </AppField>

        <AppField v-slot="{ id }" label="Details" description="Optional.">
          <Textarea :id="id" v-model="form.description" :rows="3" />
        </AppField>

        <AppField
          v-slot="{ id }"
          label="Priority"
          description="Urgent is due in 24 hours, normal in 7 days, low in 30."
        >
          <Select :id="id" v-model="form.priority">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="NORMAL">Normal</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending">File request</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
