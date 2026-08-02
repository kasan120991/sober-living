<script setup>
import { UserPlus } from '@lucide/vue'

const emit = defineEmits(['intaken'])
const { intakeResident, availableBeds } = useResidents()
const notify = useNotify()

const open = ref(false)
const pending = ref(false)
const error = ref('')
const NO_BED = 'none'

const blank = () => ({
  firstName: '', lastName: '', cohort: 'MEN', dateOfBirth: '', phone: '',
  intakeAt: new Date().toISOString().slice(0, 10), expectedDischargeAt: '',
  referralSource: '', bedId: NO_BED,
  contactName: '', contactRelationship: '', contactPhone: '',
})
const form = reactive(blank())

// Only beds in matching-cohort apartments are offered — the composite foreign
// keys would refuse anything else, so filtering here saves a pointless error
// rather than being the enforcement.
const beds = ref([])
async function loadBeds() {
  beds.value = await availableBeds(form.cohort)
  if (!beds.value.some((b) => b.id === form.bedId)) form.bedId = NO_BED
}
watch(() => form.cohort, loadBeds)
watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  Object.assign(form, blank())
  loadBeds()
})

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
        ? { name: form.contactName, relationship: form.contactRelationship || null, phone: form.contactPhone }
        : undefined,
    })
    notify.success(`${form.firstName} ${form.lastName} intaken`)
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
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button size="sm"><UserPlus class="size-4" /> Intake</Button>
    </DialogTrigger>
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
      <DialogHeader><DialogTitle>Intake a resident</DialogTitle></DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div class="flex gap-3">
          <AppField v-slot="{ id }" label="First name" class="flex-1">
            <Input :id="id" v-model="form.firstName" required />
          </AppField>
          <AppField v-slot="{ id }" label="Last name" class="flex-1">
            <Input :id="id" v-model="form.lastName" required />
          </AppField>
        </div>

        <div class="flex gap-3">
          <AppField label="Cohort" class="flex-1" description="Decides which apartments they can be housed in.">
            <Select v-model="form.cohort">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEN">Men</SelectItem>
                <SelectItem value="WOMEN">Women</SelectItem>
              </SelectContent>
            </Select>
          </AppField>
          <AppField v-slot="{ id }" label="Date of birth" class="flex-1">
            <Input :id="id" v-model="form.dateOfBirth" type="date" />
          </AppField>
        </div>

        <AppField
          label="Bed"
          description="Only free beds in matching-cohort apartments are listed. A resident can be intaken without one."
        >
          <Select v-model="form.bedId">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_BED">No bed yet</SelectItem>
              <SelectItem v-for="b in beds" :key="b.id" :value="b.id">{{ b.label }}</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <div class="flex gap-3">
          <AppField v-slot="{ id }" label="Intake date" class="flex-1">
            <Input :id="id" v-model="form.intakeAt" type="date" />
          </AppField>
          <AppField v-slot="{ id }" label="Expected out" class="flex-1">
            <Input :id="id" v-model="form.expectedDischargeAt" type="date" />
          </AppField>
        </div>

        <AppField v-slot="{ id }" label="Referral source">
          <Input :id="id" v-model="form.referralSource" placeholder="Travis County drug court" />
        </AppField>

        <div class="border-t pt-4">
          <p class="text-muted-foreground mb-3 text-[11px] uppercase tracking-wider">
            Emergency contact
          </p>
          <div class="flex flex-col gap-3">
            <div class="flex gap-3">
              <AppField v-slot="{ id }" label="Name" class="flex-1">
                <Input :id="id" v-model="form.contactName" />
              </AppField>
              <AppField v-slot="{ id }" label="Relationship" class="w-36">
                <Input :id="id" v-model="form.contactRelationship" placeholder="Parent" />
              </AppField>
            </div>
            <AppField v-slot="{ id }" label="Phone">
              <Input :id="id" v-model="form.contactPhone" />
            </AppField>
          </div>
          <!-- 42 CFR Part 2: being listed here does not authorise telling this
               person anything. Consent is separate and not built yet. -->
          <p class="text-muted-foreground mt-2 text-xs">
            Listing a contact does not authorise disclosure to them.
          </p>
        </div>

        <DialogFooter class="border-t pt-4">
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="pending">Complete intake</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
