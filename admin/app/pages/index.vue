<script setup>
// The landing page (decided 2026-08-05, from a rendered mock Kasan specified):
// a greeting header with quick actions, three status cards, then two columns —
// needs-attention, sign-outs and outstanding balances on the left, today's
// schedule on the right. The census board this replaced as home lives at
// /census, one tap away in the nav.
//
// Everything renders from ONE read (GET /dashboard), which composes the same
// derivations the bell, the pill and the module pages use — so a row here and
// its source page cannot disagree. The roster is fetched alongside it only to
// feed the quick-action dialogs' resident pickers.
//
// Names appear on this page (it is a work queue, like /service), and the
// overdue row carries its destination (the bell's rule: whoever acts on it
// needs to know where to start looking). Nothing clinical belongs here, ever —
// this screen greets every unlock.
import {
  BedDouble,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  ReceiptText,
  DoorOpen,
  HandHeart,
  Plus,
  UserPlus,
} from '@lucide/vue'
import {
  facilityDateNow,
  facilityTimeNow,
  formatFacilityTime,
  humanDate,
  overdueLabel,
  presenceState,
} from '~/utils/facilityTime.js'
import { money } from '~/utils/money.js'
import { cohortsLabel } from '~/utils/schedule.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const { getDashboard } = useDashboard()
const { listResidents } = useResidents()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()
const { user } = useAuth()

// Presentation only — intake and ledger posting are manager acts server-side.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const data = ref(null)
const residents = ref([])
const pending = ref(true)

async function load() {
  // First load only — a realtime refresh must not blank the page it updates.
  pending.value = !data.value
  ;[data.value, residents.value] = await Promise.all([
    getDashboard(),
    listResidents().then((r) => r.residents),
  ])
  pending.value = false
  refreshNotifications()
}
await load()
onRealtimeChanged(load)

// A sign-out becoming overdue mutates nothing — no write, no socket event —
// so the page keeps its own clock, like the census and sign-outs pages.
const now = ref(Date.now())
let tick = null
onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now()
    refreshStatus()
    refreshNotifications()
  }, 30_000)
})
onUnmounted(() => clearInterval(tick))

// ── The greeting ────────────────────────────────────────────────────────────
// On the FACILITY clock, not the browser's — a manager checking in from
// another timezone reads the house's time of day, consistent with every other
// clock in the app.
const greeting = computed(() => {
  const hour = Number(facilityTimeNow().slice(0, 2))
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const first = user.value?.fullName?.split(' ')[0]
  return first ? `Good ${part}, ${first}` : `Good ${part}`
})
const dateLine = computed(() => humanDate(facilityDateNow(), { relative: false }))

// ── Sign-outs, against the ticking clock ────────────────────────────────────
const signedOut = computed(() => data.value?.signedOut ?? [])
const isOverdue = (s) =>
  presenceState({ expectedReturnAt: s.expectedReturnAt }, now.value) === 'OVERDUE'
const overdueCount = computed(() => signedOut.value.filter(isOverdue).length)

const outIds = computed(() => signedOut.value.map((s) => s.resident.id))

// ── Status cards ────────────────────────────────────────────────────────────
const capacity = computed(() => data.value?.capacity ?? null)
// One figure with the split beside it — never a bare total, because a free
// women's bed cannot take a man. The sub-label is what keeps the cohort rule.
const bedsFree = computed(() => {
  const c = capacity.value
  if (!c) return { total: 0, sub: '' }
  return {
    total: c.MEN.free + c.WOMEN.free,
    sub: `${c.MEN.free} men · ${c.WOMEN.free} women`,
  }
})

const balances = computed(() => data.value?.balances ?? { totalCents: 0, owing: [] })

// ── Needs attention ─────────────────────────────────────────────────────────
// The bell's action items as a panel, in the pill's priority order — minus
// overdue sign-outs (the panel below carries them; one situation should not be
// two rows) and minus community service (left out by request; /service and the
// rail's amber dot carry it).
// Rolls are the one unbounded kind — a house that has never taken a roll owes
// a fortnight × two cohorts of them, and thirty roll rows would bury the one
// urgent repair beneath them. So rolls are capped IN PLACE (oldest first, the
// server's order) with an overflow row pointing at the schedule board, while
// unhoused residents and urgent repairs always all render — both are
// structurally small, and hiding either is hiding a person or a hazard.
// Three, chosen 2026-08-06 — below the schedule board's own queue of four,
// because this panel shares a column with two other kinds and the board does
// not. The badge above still counts every situation, so nothing is hidden,
// only deferred to the overflow row.
const ROLLS_SHOWN = 3
// Repairs took the same treatment on 2026-08-07, when the panel started
// carrying merely-AGED requests alongside urgent ones. An URGENT repair still
// always renders — hiding a hazard is not on, which is the rule stated above —
// but a house that has never worked its backlog can owe a dozen aged low
// ones, and twelve of those bury the urgent one just as thirty rolls did.
// Only the aged non-urgent tail is capped.
const AGED_REPAIRS_SHOWN = 3
const attention = computed(() => {
  const a = data.value?.attention
  if (!a) return []
  const rollRows = a.needsRoll.map((s) => ({
    key: `roll:${s.eventId}|${s.date}`,
    kind: 'Roll',
    title: s.title,
    chip: cohortsLabel(s.cohorts),
    meta: `${humanDate(s.date, { short: true })} · ${formatFacilityTime(s.startsAt)} · ${s.rosterCount} on roster`,
    to: '/schedule',
  }))
  const rollOverflow =
    rollRows.length > ROLLS_SHOWN
      ? [{
          key: 'roll:overflow',
          kind: 'Roll',
          title: `${rollRows.length - ROLLS_SHOWN} more rolls due`,
          chip: null,
          meta: 'Schedule →',
          to: '/schedule',
        }]
      : []
  // The Friday nag leads: a billing day that went past unbilled is money
  // nobody is being shown as owing, and it is one press to fix. Managers only,
  // because /billing is — an item a tech cannot act on is noise on the one
  // panel that greets every unlock.
  const billingRows =
    a.billingDue && canManage.value
      ? [{
          key: 'billing:friday',
          kind: 'Billing',
          title: 'Not billed since Friday',
          chip: null,
          meta: `${a.billingDue.waiting} ${a.billingDue.waiting === 1 ? 'resident has' : 'residents have'} charges waiting`,
          to: '/billing',
        }]
      : []

  // Urgent repairs first and in full; the merely-aged tail capped behind them.
  const repairRow = (r) => ({
    key: `urgent:${r.id}`,
    kind: 'Repair',
    title: r.title,
    chip: r.state === 'OVERDUE' ? 'Overdue' : null,
    // facilityDateOf, not isoDate — see the balances panel below.
    meta: `${r.apartment.name} · reported ${humanDate(facilityDateOf(r.reportedAt), { short: true })}`,
    // /maintenance, not /apartments/:id: the apartment page is manager-only,
    // and this panel greets every unlock including a tech's.
    to: '/maintenance',
  })
  const urgentRepairs = a.urgentMaintenance.filter((r) => r.priority === 'URGENT')
  const agedRepairs = a.urgentMaintenance.filter((r) => r.priority !== 'URGENT')
  const repairRows = [
    ...urgentRepairs.map(repairRow),
    ...agedRepairs.slice(0, AGED_REPAIRS_SHOWN).map(repairRow),
  ]
  const repairOverflow =
    agedRepairs.length > AGED_REPAIRS_SHOWN
      ? [{
          key: 'repair:overflow',
          kind: 'Repair',
          title: `${agedRepairs.length - AGED_REPAIRS_SHOWN} more repairs past their target`,
          chip: null,
          meta: 'Maintenance →',
          to: '/maintenance',
        }]
      : []

  return [
    ...billingRows,
    ...a.unhoused.map((r) => ({
      key: `unhoused:${r.id}`,
      kind: 'Bed',
      title: r.fullName,
      chip: r.cohort === 'MEN' ? 'Men' : 'Women',
      // freeBed.label already names the apartment ("Apt 14 · C").
      meta: r.freeBed ? `${r.freeBed.label} free` : 'No free bed',
      to: `/residents/${r.id}`,
    })),
    ...rollRows.slice(0, ROLLS_SHOWN),
    ...rollOverflow,
    ...repairRows,
    ...repairOverflow,
  ]
})

// The header badge counts situations, not rendered rows — the overflow row is
// navigation, and the capped rolls are still situations.
const attentionCount = computed(() => {
  const a = data.value?.attention
  if (!a) return 0
  return (
    a.unhoused.length +
    a.needsRoll.length +
    a.urgentMaintenance.length +
    (a.billingDue && canManage.value ? 1 : 0)
  )
})

// ── Quick actions ───────────────────────────────────────────────────────────
// One dialog per action, all siblings of the page — the dropdown only opens
// them. Intake and payment are hidden (not disabled) for techs: the server
// refuses either regardless, and a menu item that can never succeed teaches
// nothing.
const signOutOpen = ref(false)
const serviceOpen = ref(false)
const intakeOpen = ref(false)
const paymentOpen = ref(false)

const quietDay = computed(
  () => !attention.value.length && !signedOut.value.length && !balances.value.owing.length,
)
</script>

<template>
  <AppPage :title="greeting" :description="dateLine">
    <template #actions>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button size="sm">
            <Plus class="size-4" /> Quick actions <ChevronDown class="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-52">
          <DropdownMenuItem @click="signOutOpen = true">
            <DoorOpen class="size-4" /> New sign-out
          </DropdownMenuItem>
          <DropdownMenuItem @click="serviceOpen = true">
            <HandHeart class="size-4" /> Log service hours
          </DropdownMenuItem>
          <template v-if="canManage">
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="intakeOpen = true">
              <UserPlus class="size-4" /> Intake resident
            </DropdownMenuItem>
            <DropdownMenuItem @click="paymentOpen = true">
              <CreditCard class="size-4" /> Record payment
            </DropdownMenuItem>
            <!-- The Friday run MOVED to /billing (2026-08-07), where what it
                 will bill is the first thing on the screen. A bulk irreversible
                 money action pressed from a dropdown, with its preview inside
                 the confirm, was the wrong way round. -->
            <DropdownMenuItem as-child>
              <NuxtLink to="/billing">
                <ReceiptText class="size-4" /> Billing
              </NuxtLink>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-4">
      <!-- ── Status cards ─────────────────────────────────────────────────
           Each card is a LINK to the page that explains its figure — a card
           that names a number should take you to where you act on it. Hover
           and focus states say so; the border warms to primary rather than
           the card lifting, which is the preset's own idiom. -->
      <div class="grid gap-3 sm:grid-cols-3">
        <NuxtLink
          to="/sign-outs"
          class="bg-card hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-ring/30
            flex items-center gap-3.5 rounded-md border p-4 outline-none transition-colors
            focus-visible:ring-3"
        >
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            :class="overdueCount ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'"
          >
            <DoorOpen class="size-5" />
          </div>
          <div>
            <p class="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
              {{ signedOut.length }}
            </p>
            <p class="text-muted-foreground text-xs">
              signed out
              <template v-if="overdueCount">
                · <span class="text-destructive font-semibold">{{ overdueCount }} overdue</span>
              </template>
            </p>
          </div>
        </NuxtLink>

        <NuxtLink
          to="/census"
          class="bg-card hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-ring/30
            flex items-center gap-3.5 rounded-md border p-4 outline-none transition-colors
            focus-visible:ring-3"
        >
          <div class="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <BedDouble class="size-5" />
          </div>
          <div>
            <p class="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
              {{ bedsFree.total }}
            </p>
            <p class="text-muted-foreground text-xs">
              {{ bedsFree.total === 1 ? 'bed free' : 'beds free' }}
              <template v-if="bedsFree.total"> · {{ bedsFree.sub }}</template>
            </p>
          </div>
        </NuxtLink>

        <NuxtLink
          to="/residents"
          class="bg-card hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-ring/30
            flex items-center gap-3.5 rounded-md border p-4 outline-none transition-colors
            focus-visible:ring-3"
        >
          <div class="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <CircleDollarSign class="size-5" />
          </div>
          <div>
            <p class="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
              {{ money(balances.totalCents) }}
            </p>
            <!-- The beds-free card's split treatment: the total, then the part
                 of it that is past due. A bare total hides the difference
                 between owing and being late, which is the whole judgement. -->
            <p class="text-muted-foreground text-xs">
              <template v-if="balances.owing.length">
                outstanding ·
                <span v-if="balances.overdueCents > 0" class="text-destructive font-medium tabular-nums">
                  {{ money(balances.overdueCents) }} overdue
                </span>
                <template v-else>
                  <span class="tabular-nums">{{ balances.owing.length }}</span>
                  {{ balances.owing.length === 1 ? 'resident owes' : 'residents owe' }}
                </template>
              </template>
              <template v-else>outstanding · nobody owes</template>
            </p>
          </div>
        </NuxtLink>
      </div>

      <!-- ── Two columns, left wider ──────────────────────────────────────── -->
      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div class="flex min-w-0 flex-col gap-4">
          <p v-if="quietDay" class="text-muted-foreground text-sm">
            Nothing needs attention. Everyone is on property and paid up.
          </p>

          <!-- Needs attention: the bell's action items, priority-ordered.
               ONE amber signal, on the panel eyebrow — an inset rule on every
               row made urgency read as wallpaper, and a panel whose title
               already says "needs attention" does not need each row shouting
               it again. The destructive inset below keeps its meaning by
               being the only inset left on the page. -->
          <section v-if="attention.length" class="bg-card rounded-md border">
            <div class="flex items-center gap-2 px-4 pt-3 pb-2">
              <span class="bg-warning size-1.5 shrink-0 rounded-full" aria-hidden="true" />
              <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                Needs attention
              </h2>
              <span class="text-xs font-semibold tabular-nums">{{ attentionCount }}</span>
            </div>
            <!-- flex-wrap + a basis on the title: on a phone the meta drops to
                 its own line instead of crushing the title to one letter. -->
            <NuxtLink
              v-for="row in attention"
              :key="row.key"
              :to="row.to"
              class="hover:bg-muted/50 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-4 py-2.5 transition-colors"
            >
              <span
                class="text-muted-foreground w-14 shrink-0 text-[10.5px] font-semibold tracking-[0.06em] uppercase"
              >
                {{ row.kind }}
              </span>
              <span class="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{{ row.title }}</span>
              <Badge v-if="row.chip" variant="outline" class="text-[10px] tracking-wider uppercase">
                {{ row.chip }}
              </Badge>
              <span class="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                {{ row.meta }}
              </span>
            </NuxtLink>
          </section>

          <!-- Signed out. Overdue re-derived each tick, so a card crosses the
               grace window without a refetch — the census tile's pattern. -->
          <section v-if="signedOut.length" class="bg-card rounded-md border">
            <div class="flex items-baseline gap-2 px-4 pt-3 pb-2">
              <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                Signed out
              </h2>
              <span class="text-xs font-semibold tabular-nums">{{ signedOut.length }}</span>
              <NuxtLink
                to="/sign-outs"
                class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
              >
                Sign-outs →
              </NuxtLink>
            </div>
            <div
              v-for="s in signedOut"
              :key="s.id"
              class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5"
              :class="isOverdue(s) && 'border-s-destructive shadow-[inset_3px_0_0_var(--destructive)]'"
            >
              <div class="min-w-0 flex-1">
                <NuxtLink
                  :to="`/residents/${s.resident.id}`"
                  class="text-sm font-semibold underline-offset-2 hover:underline"
                >
                  {{ s.resident.fullName }}
                </NuxtLink>
                <p class="text-muted-foreground truncate text-xs">
                  {{ s.destination }} · out {{ formatFacilityTime(s.outAt) }}
                </p>
              </div>
              <Badge
                v-if="isOverdue(s)"
                variant="outline"
                class="border-destructive/40 bg-destructive/15 text-destructive text-[10px]"
              >
                Overdue {{ overdueLabel(s.expectedReturnAt, now) }}
              </Badge>
              <Badge
                v-else
                variant="outline"
                class="border-warning/40 bg-warning/15 text-warning text-[10px]"
              >
                Out
              </Badge>
              <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                {{ isOverdue(s) ? 'due' : 'back' }} {{ formatFacilityTime(s.expectedReturnAt) }}
              </span>
            </div>
          </section>

          <!-- Outstanding balances. The panel KEEPS its name now that invoicing
               exists — it is still the complete list, and overdue is a property
               of some rows, not a different list. Overdue sorts first and takes
               the Signed-out panel's destructive BADGE, deliberately not its
               inset rule: the 2026-08-06 polish pass left exactly one inset on
               this page so that inset means something. Considered, declined. -->
          <section v-if="balances.owing.length" class="bg-card rounded-md border">
            <div class="flex items-baseline gap-2 px-4 pt-3 pb-2">
              <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                Outstanding balances
              </h2>
              <span class="text-xs font-semibold tabular-nums">{{ money(balances.totalCents) }}</span>
              <NuxtLink
                to="/residents"
                class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
              >
                Residents →
              </NuxtLink>
            </div>
            <NuxtLink
              v-for="r in balances.owing"
              :key="r.residentId"
              :to="`/residents/${r.residentId}`"
              class="hover:bg-muted/50 flex min-h-14 items-center gap-3 border-t px-4 py-2.5"
            >
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2 text-sm font-semibold">
                  {{ r.residentName }}
                  <Badge v-if="r.overdue" variant="destructive" class="text-[10px]">
                    {{ r.overdue.daysPastDue }}d overdue
                  </Badge>
                </p>
                <p class="text-muted-foreground truncate text-xs">
                  {{ r.programName ?? 'No program' }} ·
                  <template v-if="r.lastPaymentAt">
                    <!-- facilityDateOf, NOT isoDate. isoDate slices UTC, so a
                         payment taken at the desk after 8pm ET reads as
                         "Tomorrow" — a last payment that has not happened yet.
                         Any instant shown as a DATE has to cross the facility
                         zone first; CLAUDE.md's rule, and this is what it
                         looks like when it is broken. -->
                    last payment {{ humanDate(facilityDateOf(r.lastPaymentAt), { short: true }) }}
                  </template>
                  <template v-else>no payments yet</template>
                </p>
              </div>
              <span class="text-sm font-semibold tabular-nums">{{ money(r.balanceCents) }}</span>
            </NuxtLink>
          </section>
        </div>

        <!-- ── Today's schedule ───────────────────────────────────────────── -->
        <section class="bg-card min-w-0 rounded-md border">
          <div class="flex items-baseline gap-2 px-4 pt-3 pb-2">
            <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
              Today
            </h2>
            <NuxtLink
              to="/schedule"
              class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
            >
              Schedule →
            </NuxtLink>
          </div>
          <div class="border-t">
            <AppTodaySchedule :shared="data.upcoming.shared" :lanes="data.upcoming.lanes" />
          </div>
        </section>
      </div>
    </div>

    <!-- Quick-action dialogs: siblings of the page, one each, driven by refs.
         The service and ledger dialogs get the roster so their in-form resident
         picker works; the sign-out dialog always had one. -->
    <AppSignOutDialog
      v-model:open="signOutOpen"
      :residents="residents"
      :out-ids="outIds"
      @recorded="load"
    />
    <AppServiceEntryDialog v-model:open="serviceOpen" :residents="residents" @saved="load" />
    <AppResidentIntake v-if="canManage" v-model:open="intakeOpen" @intaken="load" />
    <AppLedgerEntryDialog
      v-if="canManage"
      v-model:open="paymentOpen"
      :residents="residents"
      default-type="PAYMENT"
      @posted="load"
    />
  </AppPage>
</template>
