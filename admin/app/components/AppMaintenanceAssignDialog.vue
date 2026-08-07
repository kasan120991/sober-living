<script setup>
/**
 * Say who owns the job — a colleague, an outside vendor, or both.
 *
 * Calls `startWork`, the same endpoint the one-tap "Start work" uses. There is
 * deliberately no separate assign route: ownership already has a rule and a
 * database CHECK behind that one, and a second endpoint would be a second place
 * for the rule to live.
 *
 * This dialog is why `vendorName` and `workOrderRef` exist at all. They shipped
 * on 2026-08-07 with nothing in the UI able to set them — the menu called
 * `startWork(id)` with no body — so "work order 118" was recordable only by the
 * seed. That was the gap this closes.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  request: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'done'])

const { startWork } = useMaintenance()
const { listStaff } = useStaff()
const notify = useNotify()

// Reka's Select reserves the empty string for "selection cleared".
const NOBODY = 'nobody'

const staff = ref([])
const form = reactive({ assignedToId: NOBODY, vendorName: '', workOrderRef: '' })
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  async (v) => {
    if (!v || !props.request) return
    form.assignedToId = props.request.assignedTo?.id ?? NOBODY
    form.vendorName = props.request.vendorName ?? ''
    form.workOrderRef = props.request.workOrderRef ?? ''
    error.value = ''
    if (!staff.value.length) staff.value = await listStaff()
  },
)

/** The database refuses IN_PROGRESS with neither, so say so before the trip. */
const ownerless = computed(
  () => form.assignedToId === NOBODY && !form.vendorName.trim(),
)

async function submit() {
  if (ownerless.value) {
    error.value = 'Name somebody or a vendor — in progress means somebody owns it.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await startWork(props.request.id, {
      assignedToId: form.assignedToId === NOBODY ? null : form.assignedToId,
      vendorName: form.vendorName.trim() || null,
      workOrderRef: form.workOrderRef.trim() || null,
    })
    notify.success('Assigned')
    emit('update:open', false)
    emit('done')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not assign the request.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader><DialogTitle>Assign request</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <p class="text-sm">{{ request?.title }}</p>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField
          v-slot="{ id }"
          label="Who is on it"
          description="Somebody here, a vendor below, or both — a manager who owns the job and called a plumber is one request."
        >
          <Select :id="id" v-model="form.assignedToId">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="NOBODY">Nobody in-house</SelectItem>
              <SelectItem v-for="s in staff" :key="s.id" :value="s.id">{{ s.fullName }}</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <AppField v-slot="{ id }" label="Vendor" description="Optional.">
          <Input :id="id" v-model="form.vendorName" placeholder="Ridgeway Glazing" />
        </AppField>

        <AppField
          v-slot="{ id }"
          label="Work order"
          description="Their reference for the job, so it can be chased by number."
        >
          <Input :id="id" v-model="form.workOrderRef" placeholder="118" />
        </AppField>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="pending">Assign</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
