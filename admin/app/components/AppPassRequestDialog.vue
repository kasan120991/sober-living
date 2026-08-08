<script setup>
// Filing a travel pass request. ALL-STAFF — the tech at the door is the person
// a resident actually asks, and making them find a manager to type it is how a
// request never gets filed. Deciding it is the manager's act, not recording it.
//
// Takes v-model:open and no trigger of its own: two screens open it (the passes
// board and the resident record), which is CLAUDE.md's rule for exactly that.
//
// ELIGIBILITY IS SHOWN BEFORE THE FORM, not after submitting. "Phase 1 · day 12
// of 90" is actionable where a 409 on save is just a wasted minute — and the
// server refuses regardless, so this is courtesy rather than protection.
import { facilityDateNow } from '~/utils/facilityTime.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** Bind to skip the picker — the record page knows whose pass this is. */
  residentId: { type: String, default: null },
  residentName: { type: String, default: null },
})
const emit = defineEmits(['update:open', 'saved'])

const { requestPass } = usePasses()
const { listResidents } = useResidents()
const { getResidentPasses } = usePasses()
const notify = useNotify()

const blank = () => ({
  residentId: props.residentId ?? '',
  destination: '',
  purpose: '',
  departDate: facilityDateNow(),
  departTime: '09:00',
  returnDate: facilityDateNow(),
  returnTime: '18:00',
})

const form = reactive(blank())
const residents = ref([])
const eligibility = ref(null)
const busy = ref(false)
const error = ref('')

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    error.value = ''
    eligibility.value = null
    Object.assign(form, blank())
    // The picker only exists when nobody is bound — the AppLedgerEntryDialog
    // pattern, so the record page does not ask a question it knows the answer to.
    if (!props.residentId && !residents.value.length) {
      residents.value = (await listResidents()).residents.filter((r) => r.status === 'ACTIVE')
    }
    if (form.residentId) await checkEligibility()
  },
  { immediate: true },
)

async function checkEligibility() {
  if (!form.residentId) return
  eligibility.value = null
  try {
    const res = await getResidentPasses(form.residentId)
    eligibility.value = res.eligibility
  } catch {
    // A failed eligibility read is not a reason to block filing — the server
    // decides, and it will say so on save.
    eligibility.value = null
  }
}
watch(() => form.residentId, checkEligibility)

const canSave = computed(
  () =>
    form.residentId &&
    form.destination.trim() &&
    form.departDate &&
    form.returnDate &&
    !busy.value,
)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await requestPass(form.residentId, {
      destination: form.destination.trim(),
      purpose: form.purpose.trim() || undefined,
      departDate: form.departDate,
      departTime: form.departTime,
      returnDate: form.returnDate,
      returnTime: form.returnTime,
    })
    notify.success('Pass requested — a manager will review it')
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not file this request.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Request a travel pass</DialogTitle>
        <DialogDescription>
          An overnight or multi-day absence. The bed is held while they are away, and a
          manager approves before it counts.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField v-if="!residentId" label="Resident" required>
          <Select v-model="form.residentId">
            <SelectTrigger class="w-full"><SelectValue placeholder="Who is going?" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in residents" :key="r.id" :value="r.id">
                {{ r.lastName }}, {{ r.firstName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </AppField>
        <p v-else class="text-muted-foreground text-sm">For {{ residentName }}.</p>

        <!-- Shown BEFORE the form is filled in, so nobody types a destination
             for a request that cannot be granted. -->
        <Alert v-if="eligibility && !eligibility.eligible" variant="destructive">
          <AlertDescription>{{ eligibility.reason }}</AlertDescription>
        </Alert>

        <AppField v-slot="{ id }" label="Destination">
          <Input :id="id" v-model="form.destination" placeholder="Sister's wedding — Macon, GA" required />
        </AppField>

        <AppField v-slot="{ id }" label="Purpose" description="Optional.">
          <Input :id="id" v-model="form.purpose" placeholder="Family event" />
        </AppField>

        <div class="flex gap-3">
          <AppField v-slot="{ id }" label="Leaves" class="flex-1">
            <Input :id="id" v-model="form.departDate" type="date" required />
          </AppField>
          <AppField v-slot="{ id }" label="At" class="w-32">
            <Input :id="id" v-model="form.departTime" type="time" required />
          </AppField>
        </div>
        <div class="flex gap-3">
          <AppField v-slot="{ id }" label="Back by" class="flex-1">
            <Input :id="id" v-model="form.returnDate" type="date" required />
          </AppField>
          <AppField v-slot="{ id }" label="At" class="w-32">
            <Input :id="id" v-model="form.returnTime" type="time" required />
          </AppField>
        </div>

        <p class="text-muted-foreground text-xs">
          Times are the facility clock. While they are away the bed stays theirs, the hourly
          round accounts for them, and their scheduled medication stops showing as due.
        </p>

        <DialogFooter class="border-t pt-4">
          <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!canSave">File request</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
