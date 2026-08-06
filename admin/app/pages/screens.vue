<script setup>
// Drug screens — variant A: action bands over a quiet history.
//
// Ordered by what has a clock on it (the /service reasoning): an offer with no
// recorded answer is the evidence gap this module exists to close, so it
// leads. A negative never enters a band — nothing is owed on it, the same
// "absence means fine" rule the census tiles and the rail follow.
//
// TWO privacy rules live on this page and neither is decoration:
//   1. Results are never on screen unbidden. The queue payload carries no
//      outcomes at all; AppScreenResult fetches one when asked, and hides it
//      again after 30 seconds. See that component's header.
//   2. Band headings are NEUTRAL NOUNS. "Confirmation returned", never
//      "Refunds due" or "Positives" — a heading that announces the class of
//      outcome for everybody under it is the ambient disclosure the reveal is
//      there to prevent. The bands still imply a non-negative and this is
//      accepted knowingly; what the reveal protects is the SPECIFIC outcome,
//      which is the damaging part over a shoulder.
import { FlaskConical } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { money } from '~/utils/money.js'
import { humanEnum, SCREEN_REASONS } from '~/utils/screens.js'
import { formatFacilityTime, humanDate, facilityDateOf } from '~/utils/facilityTime.js'

const { getScreens, listStaff } = useScreens()
const { listResidents } = useResidents()
const { user } = useAuth()

const data = ref(null)
const residents = ref([])
const staff = ref([])
const pending = ref(true)

async function load() {
  // First load only — a realtime refresh must not blank the queue.
  pending.value = !data.value
  ;[data.value, residents.value, staff.value] = await Promise.all([
    getScreens(),
    listResidents().then((r) => r.residents.filter((x) => x.status === 'ACTIVE')),
    listStaff(),
  ])
  pending.value = false
}
await load()
onRealtimeChanged(load)

// No clock tick: nothing here crosses a threshold on time alone. A specimen at
// the lab for a fortnight is old, not overdue — the facility has no SLA with
// the lab to measure it against.

const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const sheetOpen = ref(false)
const decisionOpen = ref(false)
const labOpen = ref(false)
const subject = ref(null)

function openDecision(s) {
  subject.value = s
  decisionOpen.value = true
}
function openLab(s) {
  subject.value = s
  labOpen.value = true
}

const reasonLabel = (v) => SCREEN_REASONS.find((r) => r.value === v)?.label ?? humanEnum(v)
const whenLabel = (iso) =>
  `${humanDate(facilityDateOf(iso), { short: true })} ${formatFacilityTime(iso)}`
</script>

<template>
  <AppPage title="Drug Screens">
    <template #description>
      <template v-if="data">
        <span class="tabular-nums">{{ data.figures.awaitingDecision }}</span> awaiting a decision ·
        <span class="tabular-nums">{{ data.figures.awaitingLab }}</span> at the lab
      </template>
    </template>
    <template #actions>
      <Button size="sm" @click="sheetOpen = true">
        <FlaskConical class="size-4" /> Record a screen
      </Button>
    </template>

    <AppScreenSheet v-model:open="sheetOpen" :residents="residents" :staff="staff" @recorded="load" />
    <AppScreenDecisionDialog
      v-model:open="decisionOpen"
      :screen="subject"
      :fee-cents="data?.feeCents ?? 0"
      @decided="load"
    />
    <AppScreenLabDialog v-model:open="labOpen" :screen="subject" @recorded="load" />

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <!-- ── 1. The evidence gap: an offer with no recorded answer ──────── -->
      <section>
        <h2 class="text-muted-foreground mb-2 flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          <span v-if="data.bands.awaitingDecision.length" class="bg-warning size-1.5 rounded-full" aria-hidden="true" />
          Awaiting the resident's decision
        </h2>
        <p v-if="!data.bands.awaitingDecision.length" class="text-muted-foreground text-sm">
          Nothing waiting on an answer.
        </p>
        <div v-else class="flex flex-col gap-2.5">
          <div
            v-for="s in data.bands.awaitingDecision"
            :key="s.id"
            class="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3"
          >
            <div class="min-w-0 flex-1 basis-52">
              <NuxtLink
                :to="`/residents/${s.resident.id}`"
                class="text-[15px] font-semibold underline-offset-2 hover:underline"
              >
                {{ s.resident.fullName }}
              </NuxtLink>
              <p class="text-muted-foreground mt-0.5 text-[13px]">
                {{ reasonLabel(s.reason) }} · {{ humanEnum(s.method) }} · {{ whenLabel(s.collectedAt) }}
              </p>
              <p class="text-muted-foreground/80 mt-0.5 text-xs">
                Witness {{ s.witnessedBy.fullName }}<template v-if="s.specimenId"> · {{ s.specimenId }}</template>
              </p>
            </div>
            <AppScreenResult :screen-id="s.id" />
            <Button size="sm" @click="openDecision(s)">Record their decision</Button>
          </div>
        </div>
      </section>

      <!-- ── 2. At the lab ──────────────────────────────────────────────── -->
      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          At the lab
        </h2>
        <p v-if="!data.bands.awaitingLab.length" class="text-muted-foreground text-sm">
          Nothing at the lab.
        </p>
        <div v-else class="flex flex-col gap-2.5">
          <div
            v-for="s in data.bands.awaitingLab"
            :key="s.id"
            class="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3"
          >
            <div class="min-w-0 flex-1 basis-52">
              <NuxtLink
                :to="`/residents/${s.resident.id}`"
                class="text-[15px] font-semibold underline-offset-2 hover:underline"
              >
                {{ s.resident.fullName }}
              </NuxtLink>
              <p class="text-muted-foreground mt-0.5 text-[13px]">
                {{ s.labName }}<template v-if="s.labReference"> · {{ s.labReference }}</template> ·
                sent {{ whenLabel(s.labSentAt) }}
              </p>
              <p class="text-muted-foreground/80 mt-0.5 text-xs">
                Collected {{ whenLabel(s.collectedAt) }}<template v-if="s.specimenId"> · {{ s.specimenId }}</template>
              </p>
            </div>
            <AppScreenResult :screen-id="s.id" />
            <Button size="sm" @click="openLab(s)">Record lab result</Button>
          </div>
        </div>
      </section>

      <!-- ── 3. Returned — where a refund gets reviewed, by hand ─────────── -->
      <section v-if="data.bands.returned.length">
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Confirmation returned
          <template v-if="canManage && data.figures.toReview">
            · <span class="text-foreground tabular-nums">{{ data.figures.toReview }} to review</span>
          </template>
        </h2>
        <div class="flex flex-col gap-2.5">
          <div
            v-for="s in data.bands.returned"
            :key="s.id"
            class="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3"
          >
            <div class="min-w-0 flex-1 basis-52">
              <NuxtLink
                :to="`/residents/${s.resident.id}`"
                class="text-[15px] font-semibold underline-offset-2 hover:underline"
              >
                {{ s.resident.fullName }}
              </NuxtLink>
              <p class="text-muted-foreground mt-0.5 text-[13px]">
                {{ s.labName }} · returned {{ whenLabel(s.labReturnedAt) }}
              </p>
            </div>
            <AppScreenResult :screen-id="s.id" />
            <!-- Money only: whether a refund is owed is a ledger fact, and a
                 manager cannot review what they cannot see is waiting. The
                 credit itself is posted through the manager-gated ledger. -->
            <Button
              v-if="canManage && s.refundDue"
              variant="outline"
              size="sm"
              as-child
            >
              <NuxtLink :to="`/residents/${s.residentId}?s=ledger`">Review the {{ money(data.feeCents) }} fee</NuxtLink>
            </Button>
          </div>
        </div>
      </section>

      <!-- ── 4. The reference band ──────────────────────────────────────── -->
      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Recent screens
        </h2>
        <p v-if="!data.bands.recent.length" class="text-muted-foreground text-sm">
          No screens in the last 30 days.
        </p>
        <div v-else class="flex flex-col">
          <div
            v-for="s in data.bands.recent"
            :key="s.id"
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 py-2 text-sm last:border-b-0"
          >
            <NuxtLink
              :to="`/residents/${s.resident.id}`"
              class="font-semibold underline-offset-2 hover:underline"
            >
              {{ s.resident.fullName }}
            </NuxtLink>
            <span class="text-muted-foreground text-[13px] tabular-nums">
              {{ whenLabel(s.collectedAt) }} · {{ reasonLabel(s.reason) }} · witness
              {{ s.witnessedBy.fullName }}
            </span>
            <Badge v-if="s.amended" variant="outline" class="text-muted-foreground text-[10px]" :title="s.amendmentReason ?? undefined">
              Amended
            </Badge>
            <span class="ms-auto"><AppScreenResult :screen-id="s.id" compact /></span>
          </div>
        </div>
      </section>
    </div>
  </AppPage>
</template>
