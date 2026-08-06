<script setup>
import { Plus } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { toApartmentName } from '~/utils/apartments.js'

const emit = defineEmits(['created'])
const { user } = useAuth()
const { createApartment } = useApartments()
const notify = useNotify()

// Presentation only — the API refuses a non-admin regardless of what renders.
const canCreate = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

const open = ref(false)
const pending = ref(false)
const error = ref('')
const form = reactive({ number: '', cohort: 'MEN' })

async function submit() {
  error.value = ''
  pending.value = true
  try {
    const name = toApartmentName(form.number)
    await createApartment({ name, cohort: form.cohort })
    notify.success(`${name} added`)
    open.value = false
    Object.assign(form, { number: '', cohort: 'MEN' })
    emit('created')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not add the apartment.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog v-if="canCreate" v-model:open="open">
    <DialogTrigger as-child>
      <Button size="sm"><Plus class="size-4" /> Apartment</Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Add apartment</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- Just the number — the "Apt" is supplied, so the roster never mixes
             "Apt 12" with "apt 12" with "12". -->
        <AppField v-slot="{ id }" label="Number" description="It shows as “Apt 12” everywhere.">
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
              placeholder="12"
              inputmode="numeric"
              required
            />
          </div>
        </AppField>

        <AppField
          label="Cohort"
          description="An apartment serves one cohort. This cannot be changed once it has beds."
        >
          <Select v-model="form.cohort">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEN">Men</SelectItem>
              <SelectItem value="WOMEN">Women</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="pending">Add apartment</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
