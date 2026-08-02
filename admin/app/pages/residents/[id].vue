<script setup>
import { DISCHARGE_TYPES, isoDate } from '~/composables/useResidents.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const route = useRoute()
const { user } = useAuth()
const {
  getResident,
  dischargeResident,
  assignBed,
  releaseBed,
  availableBeds,
  addContact,
  removeContact,
} = useResidents()
const toast = useToast()

const resident = ref(null)
const pending = ref(true)

async function load() {
  pending.value = true
  resident.value = await getResident(route.params.id)
  pending.value = false
}
await load()

const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)
const isCurrent = computed(() => Boolean(resident.value?.current))
const cohortLabel = computed(() => (resident.value?.cohort === 'MEN' ? 'Men' : 'Women'))

// ── Bed ─────────────────────────────────────────────────────────────────────
const bedOpen = ref(false)
const beds = ref([])
const chosenBed = ref('')
const bedPending = ref(false)
const bedError = ref('')

async function openBed() {
  bedError.value = ''
  beds.value = await availableBeds(resident.value.cohort)
  chosenBed.value = beds.value[0]?.id ?? ''
  bedOpen.value = true
}

async function saveBed() {
  bedPending.value = true
  bedError.value = ''
  try {
    await assignBed(resident.value.id, chosenBed.value)
    toast.add({ title: 'Bed assigned', color: 'success', icon: 'i-lucide-check' })
    bedOpen.value = false
    await load()
  } catch (err) {
    bedError.value = err?.data?.error ?? 'Could not assign the bed.'
  } finally {
    bedPending.value = false
  }
}

async function freeBed() {
  try {
    await releaseBed(resident.value.id, 'released')
    toast.add({ title: 'Bed released', color: 'success' })
    await load()
  } catch (err) {
    toast.add({ title: err?.data?.error ?? 'Could not release the bed.', color: 'error' })
  }
}

// ── Discharge ───────────────────────────────────────────────────────────────
const dischargeOpen = ref(false)
const discharge = reactive({ dischargeType: 'SUCCESSFUL', dischargeReason: '' })
const dischargePending = ref(false)
const dischargeError = ref('')

async function submitDischarge() {
  dischargeError.value = ''
  if (!discharge.dischargeReason.trim()) {
    dischargeError.value = 'A discharge needs a reason.'
    return
  }
  dischargePending.value = true
  try {
    await dischargeResident(resident.value.id, { ...discharge })
    toast.add({ title: `${resident.value.fullName} discharged`, color: 'success' })
    dischargeOpen.value = false
    await load()
  } catch (err) {
    dischargeError.value = err?.data?.error ?? 'Could not complete the discharge.'
  } finally {
    dischargePending.value = false
  }
}

// ── Emergency contacts ──────────────────────────────────────────────────────
const contactOpen = ref(false)
const contact = reactive({ name: '', relationship: '', phone: '' })
const contactPending = ref(false)

async function submitContact() {
  contactPending.value = true
  try {
    await addContact(resident.value.id, { ...contact })
    Object.assign(contact, { name: '', relationship: '', phone: '' })
    contactOpen.value = false
    await load()
  } catch (err) {
    toast.add({ title: err?.data?.error ?? 'Could not add the contact.', color: 'error' })
  } finally {
    contactPending.value = false
  }
}

async function dropContact(id) {
  try {
    await removeContact(id)
    await load()
  } catch (err) {
    toast.add({ title: err?.data?.error ?? 'Could not remove the contact.', color: 'error' })
  }
}

const dischargeLabel = (t) => DISCHARGE_TYPES.find((d) => d.value === t)?.label ?? t
</script>

<template>
  <UDashboardPanel id="resident-detail">
    <template #header>
      <UDashboardNavbar
        :title="resident?.fullName ?? 'Resident'"
        :ui="{
          root: 'border-b border-[var(--color-hairline)] bg-[var(--color-elevated)]',
          title: 'text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]',
        }"
      >
        <template #leading>
          <UButton
            to="/residents"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Back to residents"
          />
        </template>

        <template #right>
          <div v-if="resident" class="flex items-center gap-3">
            <span
              class="rounded-[3px] border border-[var(--color-hairline)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-body)]"
            >
              {{ cohortLabel }}
            </span>
            <span
              v-if="!isCurrent"
              class="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-xs text-[var(--color-mute)]"
            >
              Discharged
            </span>
            <UButton
              v-if="canManage && isCurrent"
              color="neutral"
              variant="outline"
              size="sm"
              label="Discharge"
              @click="dischargeOpen = true"
            />
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="pending" class="text-sm text-[var(--color-mute)]">Loading…</div>

      <div v-else-if="resident" class="flex flex-col gap-7">
        <!-- Current stay -->
        <section v-if="resident.current">
          <div
            class="grid grid-cols-2 gap-x-6 gap-y-4 rounded-[var(--ui-radius)] border border-[var(--color-hairline)] bg-[var(--color-elevated)] p-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            <div class="flex flex-col">
              <span class="text-[11.5px] text-[var(--color-mute)]">Bed</span>
              <span v-if="resident.current.bed" class="font-mono text-[12.5px] text-[var(--color-ink)]">
                {{ resident.current.bed.apartmentName }} · {{ resident.current.bed.label }}
              </span>
              <span v-else class="text-[13px] font-medium text-[var(--color-warning-deep)]">
                Awaiting a bed
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[11.5px] text-[var(--color-mute)]">Program</span>
              <span class="text-[13.5px] font-medium text-[var(--color-ink)]">
                {{ resident.current.program?.name ?? '—' }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[11.5px] text-[var(--color-mute)]">Intake</span>
              <span class="font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">
                {{ isoDate(resident.current.intakeAt) }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[11.5px] text-[var(--color-mute)]">Expected out</span>
              <span class="font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">
                {{ isoDate(resident.current.expectedDischargeAt) ?? '—' }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[11.5px] text-[var(--color-mute)]">Day</span>
              <span class="font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">
                {{ resident.current.dayOfStay }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[11.5px] text-[var(--color-mute)]">Referral</span>
              <span class="text-[13.5px] text-[var(--color-ink)]">
                {{ resident.current.referralSource ?? '—' }}
              </span>
            </div>
          </div>

          <div v-if="canManage" class="mt-2 flex gap-2">
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              :label="resident.current.bed ? 'Move bed' : 'Assign a bed'"
              @click="openBed"
            />
            <UButton
              v-if="resident.current.bed"
              size="sm"
              color="neutral"
              variant="ghost"
              label="Release bed"
              @click="freeBed"
            />
          </div>
        </section>

        <!-- Emergency contacts -->
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mute)]">
              Emergency contacts
            </h2>
            <UButton
              v-if="canManage"
              icon="i-lucide-plus"
              size="sm"
              color="neutral"
              variant="outline"
              label="Add"
              @click="contactOpen = true"
            />
          </div>

          <div
            v-if="resident.emergencyContacts.length"
            class="overflow-hidden rounded-[var(--ui-radius)] border border-[var(--color-hairline)]"
          >
            <div
              v-for="c in resident.emergencyContacts"
              :key="c.id"
              class="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--color-hairline-soft)] bg-[var(--color-elevated)] px-3 py-2 last:border-b-0"
            >
              <div class="min-w-0">
                <span class="text-[13.5px] text-[var(--color-ink)]">{{ c.name }}</span>
                <span v-if="c.relationship" class="text-[12.5px] text-[var(--color-mute)]">
                  · {{ c.relationship }}
                </span>
                <span v-if="c.isPrimary" class="ms-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-mute)]">
                  Primary
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-mono text-[12.5px] text-[var(--color-body)]">{{ c.phone }}</span>
                <UButton
                  v-if="canManage"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Remove ${c.name}`"
                  @click="dropContact(c.id)"
                />
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-[var(--color-mute)]">No emergency contacts recorded.</p>
          <p class="text-xs text-[var(--color-mute)]">
            Being listed here does not authorise disclosure to that person.
          </p>
        </section>

        <!-- Stay history -->
        <section class="flex flex-col gap-3">
          <h2 class="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-mute)]">
            Stay history
          </h2>
          <div class="overflow-hidden rounded-[var(--ui-radius)] border border-[var(--color-hairline)]">
            <div class="overflow-x-auto">
              <table class="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    <th
                      v-for="h in ['Intake', 'Discharge', 'Type', 'Reason', 'Beds']"
                      :key="h"
                      class="whitespace-nowrap border-b border-[var(--color-hairline)] bg-[var(--color-elevated)] px-3 py-2 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-mute)]"
                    >
                      {{ h }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in resident.stays" :key="s.id" class="bg-[var(--color-elevated)]">
                    <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12.5px] tabular-nums">
                      {{ isoDate(s.intakeAt) }}
                    </td>
                    <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3">
                      <span v-if="s.dischargedAt" class="font-mono text-[12.5px] tabular-nums">
                        {{ isoDate(s.dischargedAt) }}
                      </span>
                      <span
                        v-else
                        class="inline-flex items-center rounded-full border border-dashed border-[var(--color-mute)] px-2 py-0.5 text-xs"
                      >
                        Current
                      </span>
                    </td>
                    <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3">
                      {{ s.dischargeType ? dischargeLabel(s.dischargeType) : '—' }}
                    </td>
                    <td class="h-12 max-w-[32ch] truncate border-b border-[var(--color-hairline-soft)] px-3 text-[var(--color-body)]">
                      {{ s.dischargeReason ?? '—' }}
                    </td>
                    <td class="h-12 whitespace-nowrap border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12px]">
                      {{ s.beds.map((b) => b.label).join(', ') || '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p v-if="resident.stays.length > 1" class="text-xs text-[var(--color-mute)]">
            A returning resident gets a new stay — this record is the person, and persists across all of them.
          </p>
        </section>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Assign / move bed -->
  <UModal v-model:open="bedOpen" :title="resident?.current?.bed ? 'Move bed' : 'Assign a bed'">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="saveBed">
        <UAlert v-if="bedError" color="error" variant="soft" :description="bedError" />
        <UFormField
          label="Bed"
          name="bed"
          description="Free beds in matching-cohort apartments only. Moving closes the current assignment and opens a new one — the history keeps both."
        >
          <USelect
            v-model="chosenBed"
            :items="beds.map((b) => ({ label: b.label, value: b.id }))"
            value-key="value"
            class="w-full"
          />
        </UFormField>
        <p v-if="!beds.length" class="text-sm text-[var(--color-warning-deep)]">
          No free beds in this cohort.
        </p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="bedOpen = false" />
          <UButton type="submit" color="primary" :loading="bedPending" :disabled="!beds.length" label="Save" />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Discharge -->
  <UModal v-model:open="dischargeOpen" :title="`Discharge ${resident?.fullName ?? ''}`">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submitDischarge">
        <UAlert v-if="dischargeError" color="error" variant="soft" :description="dischargeError" />

        <UFormField label="Type" name="dischargeType">
          <USelect
            v-model="discharge.dischargeType"
            :items="DISCHARGE_TYPES"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Reason"
          name="dischargeReason"
          description="Required. This is the record that explains the discharge to a referral source or an audit."
        >
          <UTextarea v-model="discharge.dischargeReason" :rows="3" class="w-full" />
        </UFormField>

        <p class="text-xs text-[var(--color-mute)]">
          This closes the stay and frees the bed, and cannot be undone. A mistake is
          corrected by a new intake, not by editing this one.
        </p>

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="dischargeOpen = false" />
          <UButton type="submit" color="primary" :loading="dischargePending" label="Discharge" />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Add contact -->
  <UModal v-model:open="contactOpen" title="Add emergency contact">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submitContact">
        <div class="flex gap-3">
          <UFormField label="Name" name="name" class="flex-1">
            <UInput v-model="contact.name" class="w-full" required />
          </UFormField>
          <UFormField label="Relationship" name="relationship" class="w-36">
            <UInput v-model="contact.relationship" placeholder="Parent" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Phone" name="phone">
          <UInput v-model="contact.phone" class="w-full" required />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="contactOpen = false" />
          <UButton type="submit" color="primary" :loading="contactPending" label="Add" />
        </div>
      </form>
    </template>
  </UModal>
</template>
