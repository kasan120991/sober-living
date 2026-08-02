<script setup>
const emit = defineEmits(['intaken'])

const { intakeResident, availableBeds } = useResidents()
const toast = useToast()

const open = ref(false)
const pending = ref(false)
const error = ref('')

const blank = () => ({
  firstName: '',
  lastName: '',
  cohort: 'MEN',
  dateOfBirth: '',
  phone: '',
  intakeAt: new Date().toISOString().slice(0, 10),
  expectedDischargeAt: '',
  referralSource: '',
  bedId: '',
  contactName: '',
  contactRelationship: '',
  contactPhone: '',
})
const form = reactive(blank())

const cohorts = [
  { label: 'Men', value: 'MEN' },
  { label: 'Women', value: 'WOMEN' },
]

// Only beds in matching-cohort apartments can be offered — the composite
// foreign keys would refuse anything else, so filtering here saves the user a
// pointless error rather than being the enforcement.
const beds = ref([])
const NO_BED = 'none'

async function loadBeds() {
  beds.value = await availableBeds(form.cohort)
  if (!beds.value.some((b) => b.id === form.bedId)) form.bedId = NO_BED
}
watch(() => form.cohort, loadBeds)
watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  Object.assign(form, blank())
  form.bedId = NO_BED
  loadBeds()
})

const bedItems = computed(() => [
  { label: 'No bed yet', value: NO_BED },
  ...beds.value.map((b) => ({ label: b.label, value: b.id })),
])

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await intakeResident({
      firstName: form.firstName,
      lastName: form.lastName,
      cohort: form.cohort,
      dateOfBirth: form.dateOfBirth || null,
      phone: form.phone || null,
      intakeAt: form.intakeAt || null,
      expectedDischargeAt: form.expectedDischargeAt || null,
      referralSource: form.referralSource || null,
      bedId: form.bedId === NO_BED ? null : form.bedId,
      emergencyContact: form.contactName
        ? {
            name: form.contactName,
            relationship: form.contactRelationship || null,
            phone: form.contactPhone,
          }
        : undefined,
    })
    toast.add({
      title: `${form.firstName} ${form.lastName} intaken`,
      color: 'success',
      icon: 'i-lucide-check',
    })
    open.value = false
    emit('intaken')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not complete the intake.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Intake a resident">
    <UButton icon="i-lucide-user-plus" size="sm" color="primary" label="Intake" />

    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <div class="flex gap-3">
          <UFormField label="First name" name="firstName" class="flex-1">
            <UInput v-model="form.firstName" class="w-full" required />
          </UFormField>
          <UFormField label="Last name" name="lastName" class="flex-1">
            <UInput v-model="form.lastName" class="w-full" required />
          </UFormField>
        </div>

        <div class="flex gap-3">
          <UFormField
            label="Cohort"
            name="cohort"
            class="flex-1"
            description="Decides which apartments they can be housed in."
          >
            <USelect v-model="form.cohort" :items="cohorts" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Date of birth" name="dateOfBirth" class="flex-1">
            <UInput v-model="form.dateOfBirth" type="date" class="w-full" />
          </UFormField>
        </div>

        <UFormField
          label="Bed"
          name="bedId"
          description="Only free beds in matching-cohort apartments are listed. A resident can be intaken without one."
        >
          <USelect v-model="form.bedId" :items="bedItems" value-key="value" class="w-full" />
        </UFormField>

        <div class="flex gap-3">
          <UFormField label="Intake date" name="intakeAt" class="flex-1">
            <UInput v-model="form.intakeAt" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Expected out" name="expectedDischargeAt" class="flex-1">
            <UInput v-model="form.expectedDischargeAt" type="date" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Referral source" name="referralSource">
          <UInput v-model="form.referralSource" placeholder="Travis County drug court" class="w-full" />
        </UFormField>

        <div class="border-t border-[var(--color-hairline)] pt-4">
          <p class="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-mute)]">
            Emergency contact
          </p>
          <div class="flex flex-col gap-3">
            <div class="flex gap-3">
              <UFormField label="Name" name="contactName" class="flex-1">
                <UInput v-model="form.contactName" class="w-full" />
              </UFormField>
              <UFormField label="Relationship" name="contactRelationship" class="w-36">
                <UInput v-model="form.contactRelationship" placeholder="Parent" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Phone" name="contactPhone">
              <UInput v-model="form.contactPhone" class="w-full" />
            </UFormField>
          </div>
          <!-- 42 CFR Part 2: being listed here does not authorise telling this
               person anything. Consent is separate and not built yet. -->
          <p class="mt-2 text-xs text-[var(--color-mute)]">
            Listing a contact does not authorise disclosure to them.
          </p>
        </div>

        <div class="flex justify-end gap-2 border-t border-[var(--color-hairline)] pt-4">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" color="primary" :loading="pending" label="Complete intake" />
        </div>
      </form>
    </template>
  </UModal>
</template>
