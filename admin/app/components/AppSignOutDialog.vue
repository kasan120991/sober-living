<script setup>
import { useId } from 'vue'
import { FACILITY_TIMEZONE, facilityTimeNow } from '~/utils/facilityTime.js'

/**
 * Record a sign-out. Takes `v-model:open` and no trigger of its own — the
 * Sign-Outs page and the dashboard's quick actions both open it, which is
 * module 1's dialog rule and the case it exists for.
 *
 * Times are wall-clock strings the SERVER interprets in the facility
 * timezone. Dates stay implicit (today) for hallway speed, with one
 * inference: an expected return "earlier" than the out time means after
 * midnight, so it is sent as tomorrow.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  /** Active roster rows: { id, fullName } minimum. */
  residents: { type: Array, default: () => [] },
  /** Residents who already have an open sign-out. */
  outIds: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'recorded'])

const { recordSignOut } = useSignOuts()
const notify = useNotify()

const open = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})
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

// FieldLabel does not generate an id the way AppField did — it renders a plain
// Label, so `for` and `id` are the caller's job. Generated rather than
// hardcoded because two copies of this dialog can be mounted at once (the
// Sign-Outs page and the dashboard's quick actions both render it), and
// duplicate ids would point every label at whichever control mounted first.
const ids = {
  resident: useId(),
  destination: useId(),
  purpose: useId(),
  outTime: useId(),
  back: useId(),
}

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
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>Sign someone out</DialogTitle>
        <DialogDescription>
          A same-day departure. An overnight absence is a travel pass.
        </DialogDescription>
      </DialogHeader>

      <form @submit.prevent="submit">
        <FieldGroup>
          <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <Field>
            <FieldLabel :for="ids.resident">Resident</FieldLabel>
            <Select v-model="form.residentId" required>
              <SelectTrigger :id="ids.resident" class="w-full">
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
          </Field>

          <Field>
            <FieldLabel :for="ids.destination">Destination</FieldLabel>
            <Input
              :id="ids.destination"
              v-model="form.destination"
              placeholder="NA meeting — St. Mark's"
              required
            />
          </Field>

          <!-- Steered toward a REASON rather than a place, because this field is
               what the resident record's apartment-check trail shows in place of
               the destination. That rule is enforced by which column is read, so
               the only lever on what the column HOLDS is here, where it is typed. -->
          <Field>
            <FieldLabel :for="ids.purpose">Purpose</FieldLabel>
            <Input :id="ids.purpose" v-model="form.purpose" placeholder="Work shift" />
            <FieldDescription>Optional. Why they are out — not where.</FieldDescription>
          </Field>

          <div class="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel :for="ids.outTime">Out at</FieldLabel>
              <Input :id="ids.outTime" v-model="form.outTime" type="time" required />
            </Field>
            <Field>
              <FieldLabel :for="ids.back">Expected back</FieldLabel>
              <Input
                :id="ids.back"
                v-model="form.expectedReturnTime"
                type="time"
                required
              />
              <FieldDescription>
                Earlier than the out time means after midnight.
              </FieldDescription>
            </Field>
          </div>
        </FieldGroup>

        <DialogFooter class="mt-6">
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="pending || !form.residentId">Sign out</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
