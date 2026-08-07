<script setup>
/**
 * Correct what a request says — its title, its description, and which apartment
 * it was filed against.
 *
 * All-staff, and only while the request is open: the server refuses a closed
 * one with a 409, and the menu does not offer this on a closed row. Correcting
 * what you filed is the same kind of act as filing it; a closed request plus
 * its trail is what an auditor reads, so it freezes.
 *
 * Moving the apartment is a CORRECTION, not an edit — it takes the request out
 * of one unit's history and puts it in another's — which is why the field says
 * so rather than sitting there unlabelled.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  request: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'done'])

const { editRequest } = useMaintenance()
const { listApartments } = useApartments()
const notify = useNotify()

const apartments = ref([])
const form = reactive({ title: '', description: '', apartmentId: '' })
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  async (v) => {
    if (!v || !props.request) return
    form.title = props.request.title ?? ''
    form.description = props.request.description ?? ''
    form.apartmentId = props.request.apartmentId ?? ''
    error.value = ''
    if (!apartments.value.length) apartments.value = await listApartments()
  },
)

const moved = computed(
  () => form.apartmentId && form.apartmentId !== props.request?.apartmentId,
)

async function submit() {
  if (!form.title.trim()) {
    error.value = 'Say what is wrong.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await editRequest(props.request.id, {
      title: form.title.trim(),
      description: form.description.trim() || null,
      apartmentId: form.apartmentId,
    })
    notify.success('Request updated')
    emit('update:open', false)
    emit('done')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not update the request.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader><DialogTitle>Edit request</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField v-slot="{ id }" label="What is wrong">
          <Input :id="id" v-model="form.title" />
        </AppField>

        <AppField v-slot="{ id }" label="Details" description="Optional.">
          <Textarea :id="id" v-model="form.description" :rows="3" />
        </AppField>

        <AppField
          v-slot="{ id }"
          label="Apartment"
          description="Only for a request filed against the wrong unit — it moves out of one apartment's history and into another's."
        >
          <Select :id="id" v-model="form.apartmentId">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="a in apartments" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <p v-if="moved" class="text-warning text-[12.5px]">
          This will move the request off {{ request?.apartmentName }}.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending">Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
