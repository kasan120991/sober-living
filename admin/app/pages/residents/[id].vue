<script setup>
import { Plus, X } from '@lucide/vue'
import { DISCHARGE_TYPES, isoDate } from '~/composables/useResidents.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const route = useRoute()
const { user } = useAuth()
const { getResident, addContact, removeContact } = useResidents()
const notify = useNotify()

const resident = ref(null)
const pending = ref(true)

const { refresh: refreshNotifications } = useNotifications()

async function load() {
  pending.value = true
  resident.value = await getResident(route.params.id)
  pending.value = false
  // Same reason as the roster: releasing a bed here creates a notification and
  // assigning one clears it, and nothing else would tell the bell.
  refreshNotifications()
}
await load()

const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)
const isCurrent = computed(() => Boolean(resident.value?.current))
const cohortLabel = computed(() => (resident.value?.cohort === 'MEN' ? 'Men' : 'Women'))
const dischargeLabel = (t) => DISCHARGE_TYPES.find((d) => d.value === t)?.label ?? t

// ── Row-level actions ───────────────────────────────────────────────────────
// The dialogs are components now, shared with the roster's row menu, so this
// page holds only which one is open.
const bedOpen = ref(false)
const releaseOpen = ref(false)
const dischargeOpen = ref(false)

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
    notify.error(err?.data?.error ?? 'Could not add the contact.')
  } finally {
    contactPending.value = false
  }
}

async function dropContact(id) {
  try {
    await removeContact(id)
    await load()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not remove the contact.')
  }
}

const FACTS = [
  { k: 'Program', v: (r) => r.current.program?.name ?? '—' },
  { k: 'Intake', v: (r) => isoDate(r.current.intakeAt), num: true },
  { k: 'Sober since', v: (r) => isoDate(r.current.sobrietyDate) ?? '—', num: true },
  { k: 'Day', v: (r) => r.current.dayOfStay, num: true },
  { k: 'Expected out', v: (r) => isoDate(r.current.expectedDischargeAt) ?? '—', num: true },
  { k: 'Referral', v: (r) => r.current.referralSource ?? '—' },
]

// Shown only when the server sent it, which it does only for admins and house
// managers. The mask is presentation; the omission upstream is the protection.
const maskedSsn = computed(() =>
  resident.value?.ssnLast4 ? `•••• ${resident.value.ssnLast4}` : null,
)
</script>

<template>
  <AppPageHeader />

  <div class="flex min-w-0 flex-1 flex-col gap-7 p-4">
    <!-- The back link lives with the title now. It used to be the breadcrumb in
         the app bar, which the bar gave up when every page gained a heading. -->
    <AppPageHeading
      :title="resident?.fullName ?? 'Resident'"
      :back="{ label: 'Residents', to: '/residents' }"
    >
      <template v-if="resident" #description>
        {{ cohortLabel }}
        <template v-if="resident.current?.bed">
          · {{ resident.current.bed.apartmentName }} · {{ resident.current.bed.label }}
        </template>
        <template v-if="resident.current">
          · {{ resident.current.program?.name ?? 'No program' }} · day
          <span class="tabular-nums">{{ resident.current.dayOfStay }}</span>
        </template>
      </template>
      <template #actions>
        <template v-if="resident">
          <Badge v-if="!isCurrent" variant="secondary">Discharged</Badge>
          <Button
            v-if="canManage && isCurrent"
            size="sm"
            variant="outline"
            @click="dischargeOpen = true"
          >
            Discharge
          </Button>
        </template>
      </template>
    </AppPageHeading>

    <div v-if="pending" class="text-muted-foreground text-sm">Loading…</div>

    <template v-else-if="resident">
      <!-- Current stay -->
      <section v-if="resident.current">
        <div class="bg-card grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border p-4 sm:grid-cols-3 lg:grid-cols-6">
          <div class="flex flex-col">
            <span class="text-muted-foreground text-[11.5px]">Bed</span>
            <span v-if="resident.current.bed" class="text-[13.5px] font-medium">
              {{ resident.current.bed.apartmentName }} · {{ resident.current.bed.label }}
            </span>
            <span v-else class="text-warning text-[13px] font-medium">Awaiting a bed</span>
          </div>
          <div v-for="f in FACTS" :key="f.k" class="flex flex-col">
            <span class="text-muted-foreground text-[11.5px]">{{ f.k }}</span>
            <span class="text-[13.5px] font-medium" :class="f.num && 'tabular-nums'">
              {{ f.v(resident) }}
            </span>
          </div>
        </div>

        <div v-if="canManage" class="mt-2 flex gap-2">
          <Button size="sm" variant="outline" @click="bedOpen = true">
            {{ resident.current.bed ? 'Move bed' : 'Assign a bed' }}
          </Button>
          <Button v-if="resident.current.bed" size="sm" variant="ghost" @click="releaseOpen = true">
            Release bed
          </Button>
        </div>
      </section>

      <!-- Identity and cover. Two blocks that are usually empty on day one and
           get filled in as paperwork arrives, so neither renders until it has
           something to say. -->
      <section
        v-if="maskedSsn || resident.insurance || resident.current?.intakeNotes"
        class="flex flex-col gap-3"
      >
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Intake detail
        </h2>

        <div class="bg-card flex flex-col gap-4 rounded-md border p-4">
          <div v-if="maskedSsn || resident.insurance" class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div v-if="maskedSsn" class="flex flex-col">
              <span class="text-muted-foreground text-[11.5px]">SSN</span>
              <span class="text-[13.5px] font-medium tabular-nums">{{ maskedSsn }}</span>
            </div>
            <template v-if="resident.insurance">
              <div class="flex flex-col">
                <span class="text-muted-foreground text-[11.5px]">Insurance</span>
                <span class="text-[13.5px] font-medium">{{ resident.insurance.provider }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-muted-foreground text-[11.5px]">Policy</span>
                <span class="text-[13.5px] font-medium tabular-nums">
                  {{ resident.insurance.policyNumber }}
                </span>
              </div>
              <div class="flex flex-col">
                <span class="text-muted-foreground text-[11.5px]">Policy holder</span>
                <!-- Blank in the database means the resident holds it, so say
                     that rather than showing a dash. -->
                <span class="text-[13.5px] font-medium">
                  {{ resident.insurance.policyHolder ?? resident.fullName }}
                </span>
              </div>
            </template>
          </div>

          <div v-if="resident.current?.intakeNotes" class="border-t pt-3">
            <span class="text-muted-foreground text-[11.5px]">Intake notes</span>
            <p class="mt-1 max-w-[75ch] text-[13.5px] whitespace-pre-line">
              {{ resident.current.intakeNotes }}
            </p>
          </div>
        </div>
      </section>

      <!-- The lines behind the balance shown on the roster. A total nobody can
           break down is not defensible to a resident who disputes it. -->
      <AppLedger
        v-if="resident.current"
        :resident-id="resident.id"
        :can-post="isCurrent"
        @posted="load"
      />

      <!-- Emergency contacts -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            Emergency contacts
          </h2>
          <Button v-if="canManage" size="sm" variant="outline" @click="contactOpen = true">
            <Plus class="size-4" /> Add
          </Button>
        </div>

        <div v-if="resident.emergencyContacts.length" class="overflow-hidden rounded-md border">
          <div
            v-for="c in resident.emergencyContacts"
            :key="c.id"
            class="bg-card flex min-h-12 items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
          >
            <div class="min-w-0">
              <span class="text-sm">{{ c.name }}</span>
              <span v-if="c.relationship" class="text-muted-foreground text-xs"> · {{ c.relationship }}</span>
              <span v-if="c.isPrimary" class="text-muted-foreground ms-2 text-[10px] uppercase tracking-wider">
                Primary
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="tabular-nums">{{ c.phone }}</span>
              <Button v-if="canManage" variant="ghost" size="sm" :aria-label="`Remove ${c.name}`"
                      @click="dropContact(c.id)">
                <X class="size-4" />
              </Button>
            </div>
          </div>
        </div>
        <p v-else class="text-muted-foreground text-sm">No emergency contacts recorded.</p>
        <p class="text-muted-foreground text-xs">
          Being listed here does not authorise disclosure to that person.
        </p>
      </section>

      <!-- Stay history -->
      <section class="flex flex-col gap-3">
        <h2 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
          Stay history
        </h2>
        <div class="overflow-hidden rounded-md border">
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th v-for="h in ['Intake', 'Discharge', 'Type', 'Reason', 'Beds']" :key="h"
                      class="bg-card text-muted-foreground whitespace-nowrap border-b px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider">
                    {{ h }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in resident.stays" :key="s.id" class="bg-card">
                  <td class="h-12 whitespace-nowrap border-b px-3 tabular-nums">
                    {{ isoDate(s.intakeAt) }}
                  </td>
                  <td class="h-12 whitespace-nowrap border-b px-3">
                    <span v-if="s.dischargedAt" class="tabular-nums">
                      {{ isoDate(s.dischargedAt) }}
                    </span>
                    <Badge v-else variant="outline" class="border-dashed">Current</Badge>
                  </td>
                  <td class="h-12 whitespace-nowrap border-b px-3">
                    {{ s.dischargeType ? dischargeLabel(s.dischargeType) : '—' }}
                  </td>
                  <td class="text-muted-foreground h-12 max-w-[32ch] truncate border-b px-3">
                    {{ s.dischargeReason ?? '—' }}
                  </td>
                  <td class="h-12 whitespace-nowrap border-b px-3">
                    {{ s.beds.map((b) => b.label).join(', ') || '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="resident.stays.length > 1" class="text-muted-foreground text-xs">
          A returning resident gets a new stay — this record is the person, and persists across all of them.
        </p>
      </section>
    </template>
  </div>

  <AppResidentBedDialog
    v-model:open="bedOpen"
    :resident-id="resident?.id"
    :resident-name="resident?.fullName"
    :cohort="resident?.cohort"
    :has-bed="Boolean(resident?.current?.bed)"
    @assigned="load"
  />

  <AppResidentReleaseBedDialog
    v-model:open="releaseOpen"
    :resident-id="resident?.id"
    :resident-name="resident?.fullName"
    :bed-label="resident?.current?.bed ? `${resident.current.bed.apartmentName} · ${resident.current.bed.label}` : ''"
    @released="load"
  />

  <AppResidentDischargeDialog
    v-model:open="dischargeOpen"
    :resident-id="resident?.id"
    :resident-name="resident?.fullName"
    @discharged="load"
  />

  <!-- Add contact -->
  <Dialog v-model:open="contactOpen">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader><DialogTitle>Add emergency contact</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submitContact">
        <div class="flex gap-3">
          <AppField v-slot="{ id }" label="Name" class="flex-1">
            <Input :id="id" v-model="contact.name" required />
          </AppField>
          <AppField v-slot="{ id }" label="Relationship" class="w-36">
            <Input :id="id" v-model="contact.relationship" placeholder="Parent" />
          </AppField>
        </div>
        <AppField v-slot="{ id }" label="Phone">
          <Input :id="id" v-model="contact.phone" required />
        </AppField>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="contactOpen = false">Cancel</Button>
          <Button type="submit" :disabled="contactPending">Add</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
