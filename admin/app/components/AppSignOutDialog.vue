<script setup>
import { DoorOpen } from '@lucide/vue'
import { FACILITY_TIMEZONE, facilityTimeNow } from '~/utils/facilityTime.js'

/**
 * Record a sign-out. Owns its trigger — only the Sign-Outs page opens it.
 *
 * Times are wall-clock strings the SERVER interprets in the facility
 * timezone. Dates stay implicit (today) for hallway speed, with one
 * inference: an expected return "earlier" than the out time means after
 * midnight, so it is sent as tomorrow.
 */
const props = defineProps({
  /** Active roster rows: { id, fullName } minimum. */
  residents: { type: Array, default: () => [] },
  /** Residents who already have an open sign-out. */
  outIds: { type: Array, default: () => [] },
})
const emit = defineEmits(['recorded'])

const { recordSignOut } = useSignOuts()
const notify = useNotify()

const open = ref(false)
const pending = ref(false)
const error = ref('')
const form = reactive({
  residentId: '',
  destination: '',
  purpose: '',
  outTime: '',
  expectedReturnTime: '',
})

const outSet = computed(() => new Set(props.outIds))

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  Object.assign(form, {
    residentId: '',
    destination: '',
    purpose: '',
    outTime: facilityTimeNow(),
    expectedReturnTime: '',
  })
})

async function submit() {
  error.value = ''
  pending.value = true
  try {
    const body = {
      residentId: form.residentId,
      destination: form.destination,
      purpose: form.purpose || undefined,
      outTime: form.outTime || undefined,
      expectedReturnTime: form.expectedReturnTime,
    }
    // "Back at 00:30" recorded at 22:00 means after midnight — tomorrow on
    // the facility calendar. The server would otherwise refuse the ordering.
    if (form.outTime && form.expectedReturnTime <= form.outTime) {
      const tomorrow = new Date(Date.now() + 86_400_000)
      body.expectedReturnDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: FACILITY_TIMEZONE,
      }).format(tomorrow)
    }
    await recordSignOut(body)
    const name = props.residents.find((r) => r.id === form.residentId)?.fullName
    notify.success(`${name ?? 'Resident'} signed out`)
    open.value = false
    emit('recorded')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not record the sign-out.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button size="sm"><DoorOpen class="size-4" /> Sign someone out</Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>Sign someone out</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField label="Resident">
          <Select v-model="form.residentId" required>
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Who is leaving?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="r in residents"
                :key="r.id"
                :value="r.id"
                :disabled="outSet.has(r.id)"
              >
                {{ r.fullName }}{{ outSet.has(r.id) ? ' — already out' : '' }}
              </SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <AppField v-slot="{ id }" label="Destination">
          <Input :id="id" v-model="form.destination" placeholder="NA meeting — St. Mark's" required />
        </AppField>

        <AppField v-slot="{ id }" label="Purpose" description="Optional.">
          <Input :id="id" v-model="form.purpose" />
        </AppField>

        <div class="grid grid-cols-2 gap-3">
          <AppField v-slot="{ id }" label="Out at">
            <Input :id="id" v-model="form.outTime" type="time" required />
          </AppField>
          <AppField
            v-slot="{ id }"
            label="Expected back"
            description="Earlier than the out time means after midnight."
          >
            <Input :id="id" v-model="form.expectedReturnTime" type="time" required />
          </AppField>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="pending || !form.residentId">Sign out</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
