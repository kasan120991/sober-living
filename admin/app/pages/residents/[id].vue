<script setup>
import { Plus, X } from '@lucide/vue'
import { DISCHARGE_TYPES, isoDate } from '~/composables/useResidents.js'
import { STAFF_ROLE } from '~/utils/roles.js'
import { money } from '~/utils/money.js'
import { hours } from '~/utils/serviceHours.js'
import {
  facilityDateOf,
  formatFacilityTime,
  overdueLabel,
  presenceState,
} from '~/utils/facilityTime.js'
import { sectionByKey, sectionDots } from '~/utils/residentSections.js'

const route = useRoute()
const router = useRouter()
const { user } = useAuth()
const { getResident, addContact, removeContact } = useResidents()
const { listSignOuts } = useSignOuts()
const notify = useNotify()

const resident = ref(null)
const signOuts = ref([])
const pending = ref(true)

const { refresh: refreshNotifications } = useNotifications()

async function load() {
  // First load only — a realtime refresh must not blank the record it updates.
  pending.value = !resident.value
  // The sign-outs endpoint returns the whole house and is filtered to this
  // resident below. Wasteful rather than unsafe: it is staff-only, it is the
  // same read the sign-outs page already does, and the audit log records it.
  // A `?residentId=` filter on the endpoint is the follow-up.
  const [record, outs] = await Promise.all([getResident(route.params.id), listSignOuts()])
  resident.value = record
  signOuts.value = [...outs.open, ...outs.returned].filter((s) => s.resident.id === record.id)
  pending.value = false
  // Same reason as the roster: releasing a bed here creates a notification and
  // assigning one clears it, and nothing else would tell the bell.
  refreshNotifications()
}
await load()
onRealtimeChanged(load)

// Crossing into overdue mutates nothing server-side — no write, no socket event
// — so presence is re-derived here against a ticking clock, the same pattern the
// census and sign-outs pages use.
const nowMs = ref(Date.now())
let tick
onMounted(() => {
  tick = setInterval(() => (nowMs.value = Date.now()), 30_000)
})
onUnmounted(() => clearInterval(tick))

const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)
const isCurrent = computed(() => Boolean(resident.value?.current))
const cohortLabel = computed(() => (resident.value?.cohort === 'MEN' ? 'Men' : 'Women'))
const dischargeLabel = (t) => DISCHARGE_TYPES.find((d) => d.value === t)?.label ?? t

// ── The rail ────────────────────────────────────────────────────────────────
// The section lives in the URL so a link can point at one and the back button
// behaves. A section key is not resident data — unlike the search query, which
// CLAUDE.md keeps out of URLs because it is somebody's name.
const section = computed({
  get: () => (sectionByKey(route.query.s) ? route.query.s : 'overview'),
  set: (s) => router.replace({ query: { ...route.query, s: s === 'overview' ? undefined : s } }),
})
const currentSection = computed(() => sectionByKey(section.value))

const openSignOut = computed(() => signOuts.value.find((s) => !s.returnedAt) ?? null)
const presence = computed(() =>
  presenceState(openSignOut.value ? { expectedReturnAt: openSignOut.value.expectedReturnAt } : null, nowMs.value),
)

const counts = computed(() => ({
  signOuts: signOuts.value.length || undefined,
  contacts: resident.value?.emergencyContacts.length || undefined,
  stays: resident.value?.stays.length || undefined,
}))
const dots = computed(() => sectionDots(resident.value))

// ── Row-level actions ───────────────────────────────────────────────────────
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
  // facilityDateOf for the instants, isoDate for `sobrietyDate` — that one is
  // a @db.Date column, where Postgres keeps only the date part and reading it
  // on the facility clock would shift it a day the wrong way.
  { k: 'Intake', v: (r) => facilityDateOf(r.current.intakeAt), num: true },
  { k: 'Sober since', v: (r) => isoDate(r.current.sobrietyDate) ?? '—', num: true },
  { k: 'Day', v: (r) => r.current.dayOfStay, num: true },
  { k: 'Expected out', v: (r) => facilityDateOf(r.current.expectedDischargeAt) ?? '—', num: true },
  {
    // Verified hours only — the figure the target is actually measured against.
    // Pending hours are deliberately not folded in here: a number on the
    // overview that counts unsigned hours would say somebody is further along
    // than the record supports. They are one click away in the section.
    k: 'Service hours',
    v: (r) => {
      const s = r.current.service
      if (!s?.requiredMinutes) return s?.verifiedMinutes ? hours(s.verifiedMinutes) : '—'
      return `${hours(s.verifiedMinutes)} of ${hours(s.requiredMinutes)}`
    },
    num: true,
    // Amber when behind, matching the rail's dot and the "Awaiting a bed"
    // treatment beside it. A fact with nothing wrong stays the default colour.
    tone: (r) => (r.current.service?.behind ? 'text-warning' : null),
  },
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

  <div class="flex min-w-0 flex-1 flex-col gap-5 p-4">
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
          <!-- Presence, never the destination: where somebody went belongs on
               the sign-outs page, not on a record glanced at with residents
               around. Same rule the census tile follows. -->
          <Badge v-if="presence === 'OVERDUE'" variant="destructive" class="tabular-nums">
            Overdue {{ overdueLabel(openSignOut.expectedReturnAt, nowMs) }}
          </Badge>
          <Badge
            v-else-if="presence === 'OUT'"
            class="border-warning/45 bg-warning/12 text-warning tabular-nums"
            variant="outline"
          >
            Out · back {{ formatFacilityTime(openSignOut.expectedReturnAt) }}
          </Badge>
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

    <div v-else-if="resident" class="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <AppResidentRail v-model="section" :counts="counts" :dots="dots">
        <template #summary>
          <div v-if="resident.current" class="flex flex-col">
            <span class="text-muted-foreground text-[11px]">Balance</span>
            <span class="text-[13.5px] font-medium tabular-nums">
              {{ money(resident.current.balanceCents) }}
            </span>
          </div>
          <div v-if="resident.current" class="flex flex-col">
            <span class="text-muted-foreground text-[11px]">Day of stay</span>
            <span class="text-[13.5px] font-medium tabular-nums">
              {{ resident.current.dayOfStay }}
            </span>
          </div>
          <div class="flex flex-col">
            <span class="text-muted-foreground text-[11px]">Sober since</span>
            <span class="text-[13.5px] font-medium tabular-nums">
              {{ isoDate(resident.current?.sobrietyDate) ?? '—' }}
            </span>
          </div>
        </template>
      </AppResidentRail>

      <div class="flex min-w-0 flex-1 flex-col gap-5">
        <!-- ── Overview ──────────────────────────────────────────────────── -->
        <template v-if="section === 'overview'">
          <section v-if="resident.current" class="flex flex-col gap-2">
            <div
              class="bg-card grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border p-4 sm:grid-cols-3 lg:grid-cols-4"
            >
              <div class="flex flex-col">
                <span class="text-muted-foreground text-[11.5px]">Bed</span>
                <span v-if="resident.current.bed" class="text-[13.5px] font-medium">
                  {{ resident.current.bed.apartmentName }} · {{ resident.current.bed.label }}
                </span>
                <span v-else class="text-warning text-[13px] font-medium">Awaiting a bed</span>
              </div>
              <div v-for="f in FACTS" :key="f.k" class="flex flex-col">
                <span class="text-muted-foreground text-[11.5px]">{{ f.k }}</span>
                <span
                  class="text-[13.5px] font-medium"
                  :class="[f.num && 'tabular-nums', f.tone?.(resident)]"
                >
                  {{ f.v(resident) }}
                </span>
              </div>
            </div>

            <div v-if="canManage" class="flex gap-2">
              <Button size="sm" variant="outline" @click="bedOpen = true">
                {{ resident.current.bed ? 'Move bed' : 'Assign a bed' }}
              </Button>
              <Button
                v-if="resident.current.bed"
                size="sm"
                variant="ghost"
                @click="releaseOpen = true"
              >
                Release bed
              </Button>
            </div>
          </section>

          <!-- Needs attention. Amber (service) and red (unaccounted at the last
               check — the loudest thing a record can say) are live; red gains
               balance-overdue when invoicing lands. An empty state that explains
               what would appear beats a panel that quietly never does. -->
          <section class="flex flex-col gap-2">
            <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Needs attention
            </h2>
            <div class="bg-card flex flex-col gap-1 rounded-md border p-4">
              <button
                v-if="resident.current?.checks?.notAccounted"
                type="button"
                class="hover:bg-accent/40 focus-visible:ring-ring/30 -m-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-md p-2 text-left outline-none transition-colors focus-visible:ring-3"
                @click="section = 'checks'"
              >
                <span class="bg-destructive size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                <span class="min-w-0">
                  <span class="block text-sm">Not found at the last apartment check</span>
                  <span class="text-muted-foreground block text-xs">
                    {{ resident.current.checks.notAccounted.apartmentName }} ·
                    {{ formatFacilityTime(resident.current.checks.notAccounted.checkedAt) }} ·
                    flagged until a later check or a sign-out accounts for them
                  </span>
                </span>
                <span class="text-muted-foreground ms-auto shrink-0 text-xs">Open →</span>
              </button>

              <button
                v-if="resident.current?.service?.behind"
                type="button"
                class="hover:bg-accent/40 focus-visible:ring-ring/30 -m-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-md p-2 text-left outline-none transition-colors focus-visible:ring-3"
                @click="section = 'service'"
              >
                <span class="bg-warning size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                <span class="min-w-0">
                  <span class="block text-sm">Behind on community service</span>
                  <span class="text-muted-foreground block text-xs">
                    {{ hours(resident.current.service.behindMinutes) }} short of the
                    {{ hours(resident.current.service.expectedMinutes) }} due by day
                    <span class="tabular-nums">{{ resident.current.dayOfStay }}</span>
                  </span>
                </span>
                <span class="text-muted-foreground ms-auto shrink-0 text-xs">Open →</span>
              </button>

              <template
                v-if="!resident.current?.service?.behind && !resident.current?.checks?.notAccounted"
              >
                <p class="text-sm">Nothing flagged.</p>
                <p class="text-muted-foreground mt-1 max-w-[70ch] text-xs">
                  Amber marks a resident behind on service hours — 20 hours a month, accruing
                  in whole months. Red marks the loudest fact: today, a resident the last
                  apartment check could not find; an overdue balance joins it once invoices
                  give a charge a due date.
                </p>
              </template>
            </div>
          </section>

          <!-- Identity and cover. Two blocks that are usually empty on day one
               and get filled in as paperwork arrives, so neither renders until
               it has something to say. -->
          <section
            v-if="maskedSsn || resident.insurance || resident.current?.intakeNotes"
            class="flex flex-col gap-2"
          >
            <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Intake detail
            </h2>

            <div class="bg-card flex flex-col gap-4 rounded-md border p-4">
              <div
                v-if="maskedSsn || resident.insurance"
                class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4"
              >
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
                    <!-- Blank in the database means the resident holds it, so
                         say that rather than showing a dash. -->
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

          <!-- Recent activity. Sign-outs only for now: this is the one place the
               modules interleave in time, and doing it properly needs a
               GET /residents/:id/events that unions six tables with one shape,
               paging and RLS. Labelled rather than faked. -->
          <section class="flex flex-col gap-2">
            <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Recent activity
            </h2>
            <div v-if="signOuts.length" class="overflow-hidden rounded-md border">
              <div
                v-for="s in signOuts.slice(0, 5)"
                :key="s.id"
                class="bg-card flex min-h-12 items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <div class="min-w-0">
                  <span class="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">
                    Sign-out
                  </span>
                  <span class="ms-2 text-sm">
                    {{ s.returnedAt ? 'Returned' : 'Out' }} ·
                    <span class="tabular-nums">
                      {{ formatFacilityTime(s.returnedAt ?? s.expectedReturnAt) }}
                    </span>
                  </span>
                </div>
                <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {{ facilityDateOf(s.outAt) }}
                </span>
              </div>
            </div>
            <p v-else class="text-muted-foreground text-sm">No activity recorded yet.</p>
            <p class="text-muted-foreground text-xs">
              Sign-outs only. The cross-module stream — screens, checks, meds, passes, ledger
              in one timeline — arrives with the modules that produce them.
            </p>
          </section>
        </template>

        <!-- ── Community service ─────────────────────────────────────────── -->
        <template v-else-if="section === 'service'">
          <Suspense>
            <AppServiceEntries
              :resident-id="resident.id"
              :resident-name="resident.fullName"
              :service="resident.current?.service"
              :can-log="isCurrent"
              @changed="load"
            />
            <template #fallback>
              <p class="text-muted-foreground text-sm">Loading service hours…</p>
            </template>
          </Suspense>
        </template>

        <!-- ── Schedule ──────────────────────────────────────────────────── -->
        <template v-else-if="section === 'schedule'">
          <!-- Fetches on open, like the ledger, and needs its own Suspense for
               the same reason: it awaits in setup and mounts on a click, outside
               Nuxt's own boundary. -->
          <Suspense>
            <AppResidentSchedule :resident-id="resident.id" />
            <template #fallback>
              <p class="text-muted-foreground text-sm">Loading the schedule…</p>
            </template>
          </Suspense>
        </template>

        <!-- ── Apartment checks ──────────────────────────────────────────── -->
        <template v-else-if="section === 'checks'">
          <!-- Same Suspense reasoning as the schedule arm above. -->
          <Suspense>
            <AppResidentChecks :resident-id="resident.id" />
            <template #fallback>
              <p class="text-muted-foreground text-sm">Loading apartment checks…</p>
            </template>
          </Suspense>
        </template>

        <!-- ── Drug screens ──────────────────────────────────────────────── -->
        <template v-else-if="section === 'screens'">
          <!-- Same Suspense reasoning as the schedule and checks arms. -->
          <Suspense>
            <AppResidentScreens :resident-id="resident.id" />
            <template #fallback>
              <p class="text-muted-foreground text-sm">Loading drug screens…</p>
            </template>
          </Suspense>
        </template>

        <!-- ── Sign-outs ─────────────────────────────────────────────────── -->
        <template v-else-if="section === 'signOuts'">
          <section class="flex flex-col gap-2">
            <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Sign-outs
            </h2>
            <div v-if="signOuts.length" class="overflow-hidden rounded-md border">
              <div class="overflow-x-auto">
                <table class="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th
                        v-for="h in ['Out', 'Destination', 'Expected back', 'Returned', 'Recorded by']"
                        :key="h"
                        class="bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-wider whitespace-nowrap uppercase"
                      >
                        {{ h }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in signOuts" :key="s.id" class="bg-card">
                      <td class="h-12 border-b px-3 whitespace-nowrap tabular-nums">
                        {{ facilityDateOf(s.outAt) }} · {{ formatFacilityTime(s.outAt) }}
                      </td>
                      <td class="h-12 max-w-[24ch] truncate border-b px-3">{{ s.destination }}</td>
                      <td class="h-12 border-b px-3 whitespace-nowrap tabular-nums">
                        {{ formatFacilityTime(s.expectedReturnAt) }}
                      </td>
                      <td class="h-12 border-b px-3 whitespace-nowrap">
                        <span v-if="s.returnedAt" class="tabular-nums">
                          {{ formatFacilityTime(s.returnedAt) }}
                        </span>
                        <Badge v-else-if="s.overdue" variant="destructive">Overdue</Badge>
                        <Badge v-else variant="outline" class="border-dashed">Still out</Badge>
                      </td>
                      <td class="text-muted-foreground h-12 border-b px-3 whitespace-nowrap">
                        {{ s.recordedBy?.fullName ?? '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p v-else class="text-muted-foreground text-sm">No sign-outs on record.</p>
            <p class="text-muted-foreground text-xs">
              Recording a departure and acknowledging a return both happen on the sign-outs
              page, where the tech at the door is already standing.
            </p>
          </section>
        </template>

        <!-- ── Ledger ────────────────────────────────────────────────────── -->
        <template v-else-if="section === 'ledger'">
          <!-- AppLedger awaits its own fetch in setup. It used to mount with the
               page, inside Nuxt's own boundary; now it mounts on a click, and
               without a boundary here the pane would sit on the previous section
               until the ledger resolved. -->
          <Suspense v-if="resident.current">
            <AppLedger
              :resident-id="resident.id"
              :can-post="isCurrent"
              :resident-name="`${resident.firstName} ${resident.lastName}`"
              :resident-email="resident.email ?? ''"
              @posted="load"
            />
            <template #fallback>
              <p class="text-muted-foreground text-sm">Loading the ledger…</p>
            </template>
          </Suspense>
          <p v-else class="text-muted-foreground text-sm">
            No active stay. Ledger entries hang off a stay, so a discharged resident's money
            belongs to the episode it was billed in — see stay history.
          </p>
        </template>

        <!-- ── Contacts ──────────────────────────────────────────────────── -->
        <template v-else-if="section === 'contacts'">
          <section class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
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
                  <span v-if="c.relationship" class="text-muted-foreground text-xs">
                    · {{ c.relationship }}
                  </span>
                  <span
                    v-if="c.isPrimary"
                    class="text-muted-foreground ms-2 text-[10px] tracking-wider uppercase"
                  >
                    Primary
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="tabular-nums">{{ c.phone }}</span>
                  <Button
                    v-if="canManage"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Remove ${c.name}`"
                    @click="dropContact(c.id)"
                  >
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
        </template>

        <!-- ── Stay history ──────────────────────────────────────────────── -->
        <template v-else-if="section === 'stays'">
          <section class="flex flex-col gap-2">
            <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Stay history
            </h2>
            <div class="overflow-hidden rounded-md border">
              <div class="overflow-x-auto">
                <table class="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th
                        v-for="h in ['Intake', 'Discharge', 'Type', 'Reason', 'Beds']"
                        :key="h"
                        class="bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-wider whitespace-nowrap uppercase"
                      >
                        {{ h }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in resident.stays" :key="s.id" class="bg-card">
                      <td class="h-12 border-b px-3 whitespace-nowrap tabular-nums">
                        {{ facilityDateOf(s.intakeAt) }}
                      </td>
                      <td class="h-12 border-b px-3 whitespace-nowrap">
                        <span v-if="s.dischargedAt" class="tabular-nums">
                          {{ facilityDateOf(s.dischargedAt) }}
                        </span>
                        <Badge v-else variant="outline" class="border-dashed">Current</Badge>
                      </td>
                      <td class="h-12 border-b px-3 whitespace-nowrap">
                        {{ s.dischargeType ? dischargeLabel(s.dischargeType) : '—' }}
                      </td>
                      <td class="text-muted-foreground h-12 max-w-[32ch] truncate border-b px-3">
                        {{ s.dischargeReason ?? '—' }}
                      </td>
                      <td class="h-12 border-b px-3 whitespace-nowrap">
                        {{ s.beds.map((b) => b.label).join(', ') || '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p v-if="resident.stays.length > 1" class="text-muted-foreground text-xs">
              A returning resident gets a new stay — this record is the person, and persists
              across all of them.
            </p>
          </section>
        </template>

        <!-- ── Everything not built yet ──────────────────────────────────── -->
        <AppStub
          v-else-if="currentSection"
          :module="currentSection.module"
          :summary="currentSection.summary"
        />
      </div>
    </div>
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
    :bed-label="
      resident?.current?.bed
        ? `${resident.current.bed.apartmentName} · ${resident.current.bed.label}`
        : ''
    "
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
