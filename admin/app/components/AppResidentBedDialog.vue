<script setup>
// Assigning or moving a bed.
//
// Takes scalars rather than a resident object: the roster row has `cohort` and
// `bed` at the top level, the record page has them under `current`. Passing the
// object would make this component guess which shape it received.
const props = defineProps({
  open: { type: Boolean, default: false },
  /** Nullable — the roster binds this from a row ref that is null while closed. */
  residentId: { type: String, default: null },
  residentName: { type: String, default: '' },
  cohort: { type: String, default: null },
  /** Decides whether this is a move or a first placement. */
  hasBed: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'assigned'])

const { assignBed, availableBeds } = useResidents()
const notify = useNotify()

const beds = ref([])
const chosen = ref('')
const loading = ref(false)
const pending = ref(false)
const error = ref('')

// The fetch used to happen before the dialog opened, so it never rendered empty.
// Now that it lives here, `loading` is what stops every open flashing "No free
// beds in this cohort." for a frame before the list arrives.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    error.value = ''
    chosen.value = ''
    loading.value = true
    try {
      beds.value = await availableBeds(props.cohort)
      chosen.value = beds.value[0]?.id ?? ''
    } catch {
      beds.value = []
      error.value = 'Could not load free beds.'
    } finally {
      loading.value = false
    }
  },
)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    await assignBed(props.residentId, chosen.value)
    notify.success(props.hasBed ? 'Bed moved' : 'Bed assigned')
    emit('update:open', false)
    emit('assigned')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not assign the bed.'
  } finally {
    pending.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('bed')
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>{{ hasBed ? 'Move bed' : 'Assign a bed' }}</DialogTitle>
        <DialogDescription v-if="residentName">{{ residentName }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Field>
          <FieldLabel :for="ids.bed">Bed</FieldLabel>
          <p v-if="loading" class="text-muted-foreground text-sm">Loading…</p>
          <Select v-else v-model="chosen">
            <SelectTrigger class="w-full"><SelectValue placeholder="Select a bed" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="b in beds" :key="b.id" :value="b.id">{{ b.label }}</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Free beds in matching-cohort apartments only. Moving closes the current assignment and opens a new one — the history keeps both.</FieldDescription>
        </Field>

        <p v-if="!loading && !beds.length" class="text-warning text-sm">
          No free beds in this cohort.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending || loading || !beds.length">Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
