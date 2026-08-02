<script setup>
import { Plus } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'

const emit = defineEmits(['created'])
const { user } = useAuth()
const { createApartment } = useApartments()
const notify = useNotify()

// Presentation only — the API refuses a non-admin regardless of what renders.
const canCreate = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

const open = ref(false)
const pending = ref(false)
const error = ref('')
const form = reactive({ name: '', cohort: 'MEN' })

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await createApartment({ ...form })
    notify.success(`${form.name} added`)
    open.value = false
    Object.assign(form, { name: '', cohort: 'MEN' })
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

        <AppField v-slot="{ id }" label="Name" description="How staff say it out loud — “Apt 12”.">
          <Input :id="id" v-model="form.name" placeholder="Apt 12" required />
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
