<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

const props = defineProps({
  apartment: { type: Object, required: true },
})
const emit = defineEmits(['saved'])

const { user } = useAuth()
const { updateApartment, removeApartment } = useApartments()
const toast = useToast()

const isAdmin = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

const open = ref(false)
const pending = ref(false)
const error = ref('')
const form = reactive({})

// Cohort is locked once beds exist — Postgres refuses the change via the
// composite foreign key from Bed. This dialog is the only place that fact is
// actionable, which is why the explanation lives here rather than on the page.
const cohortLocked = computed(() => (props.apartment.beds?.length ?? 0) > 0)

const cohorts = [
  { label: 'Men', value: 'MEN' },
  { label: 'Women', value: 'WOMEN' },
]

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  Object.assign(form, {
    name: props.apartment.name ?? '',
    cohort: props.apartment.cohort ?? 'MEN',
  })
})

async function save() {
  error.value = ''
  pending.value = true
  try {
    const body = { ...form }
    if (cohortLocked.value) delete body.cohort
    await updateApartment(props.apartment.id, body)
    toast.add({ title: 'Apartment updated', color: 'success', icon: 'i-lucide-check' })
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
    toast.add({ title: `${props.apartment.name} removed`, color: 'success' })
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
  <UModal v-if="isAdmin" v-model:open="open" :title="`Edit ${apartment.name}`">
    <UButton
      icon="i-lucide-settings"
      color="neutral"
      variant="ghost"
      size="sm"
      aria-label="Edit apartment"
    />

    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <UFormField label="Name" name="name">
          <UInput v-model="form.name" class="w-full" required />
        </UFormField>

        <UFormField
          label="Cohort"
          name="cohort"
          :description="
            cohortLocked
              ? 'Locked while this apartment has beds. Remove them first — this is what keeps men and women from sharing a unit.'
              : 'An apartment serves exactly one cohort.'
          "
        >
          <USelect
            v-model="form.cohort"
            :items="cohorts"
            value-key="value"
            :disabled="cohortLocked"
            class="w-full"
          />
        </UFormField>

        <div class="flex items-center justify-between gap-2 border-t border-[var(--color-hairline)] pt-4">
          <UButton
            color="error"
            variant="ghost"
            label="Remove apartment"
            :disabled="pending"
            @click="destroy"
          />
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
            <UButton type="submit" color="primary" :loading="pending" label="Save" />
          </div>
        </div>
      </form>
    </template>
  </UModal>
</template>
