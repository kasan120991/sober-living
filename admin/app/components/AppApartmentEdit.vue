<script setup>
import { Settings } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { apartmentNumber, toApartmentName } from '~/utils/apartments.js'

const props = defineProps({ apartment: { type: Object, required: true } })
const emit = defineEmits(['saved'])

const { user } = useAuth()
const { updateApartment, removeApartment } = useApartments()
const notify = useNotify()

const isAdmin = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

const open = ref(false)
const pending = ref(false)
const error = ref('')
const form = reactive({ number: '', cohort: 'MEN' })

// Cohort is locked once beds exist — Postgres refuses the change via the
// composite foreign key from Bed. This dialog is the only place that fact is
// actionable, which is why the explanation lives here rather than on the page.
const cohortLocked = computed(() => (props.apartment.beds?.length ?? 0) > 0)

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  Object.assign(form, {
    number: apartmentNumber(props.apartment.name),
    cohort: props.apartment.cohort ?? 'MEN',
  })
})

async function save() {
  error.value = ''
  pending.value = true
  try {
    const body = { name: toApartmentName(form.number) }
    if (!cohortLocked.value) body.cohort = form.cohort
    await updateApartment(props.apartment.id, body)
    notify.success('Apartment updated')
    open.value = false
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save the apartment.'
  } finally {
    pending.value = false
  }
}

async function destroy() {
  error.value = ''
  pending.value = true
  try {
    await removeApartment(props.apartment.id)
    notify.success(`${props.apartment.name} removed`)
    open.value = false
    await navigateTo('/apartments')
    emit('saved')
  } catch (err) {
    // The API refuses an apartment that still has beds. Its message names the
    // next step, so surface it rather than a generic failure.
    error.value = err?.data?.error ?? 'Could not remove the apartment.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog v-if="isAdmin" v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="ghost" size="sm" aria-label="Edit apartment">
        <Settings class="size-4" />
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Edit {{ apartment.name }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="save">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <AppField v-slot="{ id }" label="Number">
          <div class="flex items-stretch">
            <span
              class="border-input bg-muted text-muted-foreground flex items-center rounded-l-md border border-r-0 px-3 text-sm"
            >
              Apt
            </span>
            <Input
              :id="id"
              v-model="form.number"
              class="rounded-l-none"
              inputmode="numeric"
              required
            />
          </div>
        </AppField>

        <AppField
          label="Cohort"
          :description="
            cohortLocked
              ? 'Locked while this apartment has beds.'
              : 'An apartment serves one cohort.'
          "
        >
          <Select v-model="form.cohort" :disabled="cohortLocked">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEN">Men</SelectItem>
              <SelectItem value="WOMEN">Women</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <DialogFooter class="border-t pt-4 sm:justify-between">
          <Button type="button" variant="ghost" class="text-destructive" :disabled="pending" @click="destroy">
            Remove apartment
          </Button>
          <div class="flex gap-2">
            <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
            <Button type="submit" :disabled="pending">Save</Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
