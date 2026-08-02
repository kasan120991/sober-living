<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

const emit = defineEmits(['created'])
const { user } = useAuth()
const { createApartment } = useApartments()
const toast = useToast()

// Presentation only — the API refuses a non-admin regardless of what renders.
const canCreate = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

const open = ref(false)
const pending = ref(false)
const error = ref('')
const form = reactive({ name: '', cohort: 'MEN', timezone: 'America/Chicago' })

const cohorts = [
  { label: 'Men', value: 'MEN' },
  { label: 'Women', value: 'WOMEN' },
]

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await createApartment({ ...form })
    toast.add({ title: `${form.name} added`, color: 'success', icon: 'i-lucide-check' })
    open.value = false
    Object.assign(form, { name: '', cohort: 'MEN', timezone: 'America/Chicago' })
    emit('created')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not add the apartment.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UModal v-if="canCreate" v-model:open="open" title="Add apartment">
    <UButton icon="i-lucide-plus" size="sm" color="primary" label="Apartment" />

    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <UFormField label="Name" name="name" hint="How staff say it out loud — “Apt 12”.">
          <UInput v-model="form.name" placeholder="Apt 12" class="w-full" required />
        </UFormField>

        <UFormField
          label="Cohort"
          name="cohort"
          description="An apartment serves one cohort. This cannot be changed once it has beds."
        >
          <USelect v-model="form.cohort" :items="cohorts" value-key="value" class="w-full" />
        </UFormField>

        <UFormField
          label="Timezone"
          name="timezone"
          description="Curfews and med windows are local times interpreted against this."
        >
          <UInput v-model="form.timezone" placeholder="America/Chicago" class="w-full" required />
        </UFormField>

        <div class="flex justify-end gap-2 pt-1">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" color="primary" :loading="pending" label="Add apartment" />
        </div>
      </form>
    </template>
  </UModal>
</template>
