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
  ClipboardCheck,
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

// ── The hourly round ────────────────────────────────────────────────────────
// BOTH of these were on the wire from the day the dashboard shipped and were
// rendered NOWHERE. They feed the bell at severity CRITICAL, and module 1 calls
// unaccounted-for "the record's loudest fact" — so the screen that greets every
// unlock was silent about the loudest thing the facility can be told.
//
// DO NOT RE-DERIVE MEMBERSHIP HERE. /checks re-filters its full apartment list
// through checkState(); this page receives the already-filtered subset, so
// re-filtering could only shorten it and would let the two screens disagree
// about who is overdue. Only the elapsed LABEL ticks — an apartment crossing
// into overdue between refetches surfaces on the next realtime event or the
// next 30-second tick, which is the same staleness bound this page already
// accepts for the roll queue.
const notAccounted = computed(() =>
  // Longest missing first — the same rule checksOverdue.since already follows.
  [...(data.value?.attention?.notAccounted ?? [])].sort((a, b) => new Date(a.at) - new Date(b.at)),
)
const checksOverdue = computed(() => data.value?.attention?.checksOverdue ?? [])

// The qualifier under the round figure. `lastCheckAt` is legitimately NULL for
// an apartment nobody has ever walked — module 4: "an apartment never checked
// reads OVERDUE, not blank" — so it is branched on, never defaulted into a
// formatter.
const roundQualifier = computed(() => {
  const [first, ...rest] = checksOverdue.value
  if (!first) return null
  // The last-checked time is stated only when ONE apartment is overdue. With
  // several it belongs to just the first, and a time sitting beside "and 2
  // more" reads as describing all of them. The count is the fact; /checks has
  // the per-apartment detail, which is what the link is for.
  if (rest.length) return `${first.apartment.name} and ${rest.length} more`
  return first.lastCheckAt
    ? `${first.apartment.name} · last checked ${formatFacilityTime(first.lastCheckAt)}`
    : `${first.apartment.name} · never checked`
})

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

  // FIRST, above everything. This panel is ordered by urgency and an overdue
  // pass is a resident nobody can account for — the same class as the census's
  // unaccounted-for red, and louder than a bed or a repair. Never capped:
  // it is structurally small, and hiding a person is the one thing the cap
  // rule already refuses to do.
  const passRows = (a.passOverdue ?? []).map((p) => ({
    key: `pass:${p.id}`,
    kind: 'Pass',
    title: p.fullName,
    chip: 'Overdue back',
    // The destination, as on an overdue sign-out row: this is a work queue and
    // whoever goes after them needs somewhere to start.
    meta: `Due back ${formatFacilityTime(p.returnBy)} · ${p.destination}`,
    to: '/passes',
    tone: 'destructive',
  }))

  return [
    ...passRows,
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
    (a.passOverdue?.length ?? 0) +
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

// Every queue empty — INCLUDING the round. Without the last two clauses this
// sentence prints directly above a box saying one apartment is overdue, which
// is the same self-contradiction module 15 records for the "$150 waiting /
// Send $250" card: two true figures on one screen that read as a disagreement.
const quietDay = computed(
  () =>
    !attention.value.length &&
    !signedOut.value.length &&
    !balances.value.owing.length &&
    !notAccounted.value.length &&
    !checksOverdue.value.length,
)

// Where the money figure takes you. /billing is the page that explains it, and
// it shipped the day AFTER the rule that says a card should take you where you
// act on its number — so /residents had quietly become the wrong answer.
//
// ROLE-AWARE, not a swap: /billing is manager-gated and its route guard
// redirects a tech to /, so sending one there would be a card that bounces.
const balancesTo = computed(() => (canManage.value ? '/billing' : '/residents'))
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
      <!-- ── Not accounted for ────────────────────────────────────────────
           THE PAGE'S ONE INSET, and it moved here (2026-08-08) off the overdue
           sign-out row. Module 1 settles the tie in its own words: "where
           anything ever needs a single answer, unaccounted-for outranks
           overdue, because one is a person nobody can find and the other is
           money." The sign-out row keeps its destructive badge and its red due
           time, so it loses styling and NO information — the same trade the
           balances panel and the overdue-pass row each made when they
           considered the inset and declined it.

           NEVER CAPPED. It is people, and the cap rule already refuses to hide
           one: "hiding either is hiding a person or a hazard." -->
      <Card
        v-if="notAccounted.length"
        as="section"
        class="border-destructive p-0 shadow-[inset_3px_0_0_var(--destructive)]"
      >
        <CardHeader>
          <span class="bg-destructive size-1.5 shrink-0 rounded-full" aria-hidden="true" />
          <CardTitle as="h2" class="text-destructive">Not accounted for</CardTitle>
          <span class="text-xs font-semibold tabular-nums">{{ notAccounted.length }}</span>
          <NuxtLink
            to="/checks"
            class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
          >
            Apartment checks →
          </NuxtLink>
        </CardHeader>
        <NuxtLink
          v-for="r in notAccounted"
          :key="r.stayId"
          :to="`/residents/${r.residentId}`"
          class="hover:bg-muted/50 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-4 py-2.5 transition-colors"
        >
          <span class="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{{ r.fullName }}</span>
          <Badge
            variant="outline"
            class="border-destructive/40 bg-destructive/10 text-destructive text-[10px] tracking-wider uppercase"
          >
            Not found
          </Badge>
          <span class="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
            {{ r.apartmentName }} · {{ formatFacilityTime(r.at) }} round · {{ r.byName }}
          </span>
        </NuxtLink>
      </Card>

      <!-- ── Status strip ─────────────────────────────────────────────────
           Four boxes since 2026-08-08, not three. Each is a LINK to the page
           that explains its figure — a card that names a number should take
           you to where you act on it. The shape lives in AppStatCard; this
           block only says what the numbers are and where each one goes.

           The HOURLY ROUND box is new, and it is the only place on this page
           that states a POSITIVE. "Everyone accounted for" is the answer this
           facility most wants, and the absence of an alarm is not the same as
           its presence — on the screen that greets every unlock, saying so is
           worth a box. -->
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <!-- THE FIGURE ALWAYS MEANS ONE THING: apartments past their round.
             It is deliberately not overloaded with the unaccounted count — two
             different facts sharing one number is how a reader learns to
             distrust it, and the people have their own band above. Not hidden
             at zero, /billing's rule: staff need to see that the answer IS
             zero. The qualifier carries the people fact when there is one,
             because "Everyone accounted for" while somebody is missing would
             be the page contradicting itself. -->
        <AppStatCard
          to="/checks"
          :icon="ClipboardCheck"
          :figure="checksOverdue.length"
          :tone="checksOverdue.length || notAccounted.length ? 'destructive' : 'default'"
        >
          <template #qualifier>
            <template v-if="checksOverdue.length">
              {{ checksOverdue.length === 1 ? 'round overdue' : 'rounds overdue' }} ·
              {{ roundQualifier }}
            </template>
            <template v-else-if="notAccounted.length">
              rounds current ·
              <span class="text-destructive font-semibold">
                {{ notAccounted.length }} not accounted for
              </span>
            </template>
            <template v-else>
              <span class="text-success font-medium">Everyone accounted for</span>
            </template>
          </template>
        </AppStatCard>

        <AppStatCard
          to="/sign-outs"
          :icon="DoorOpen"
          :figure="signedOut.length"
          :tone="overdueCount ? 'destructive' : 'default'"
        >
          <template #qualifier>
            signed out
            <template v-if="overdueCount">
              · <span class="text-destructive font-semibold">{{ overdueCount }} overdue</span>
            </template>
          </template>
        </AppStatCard>

        <AppStatCard to="/census" :icon="BedDouble" :figure="bedsFree.total">
          <template #qualifier>
            {{ bedsFree.total === 1 ? 'bed free' : 'beds free' }}
            <template v-if="bedsFree.total"> · {{ bedsFree.sub }}</template>
          </template>
        </AppStatCard>

        <AppStatCard :to="balancesTo" :icon="CircleDollarSign" :figure="money(balances.totalCents)">
          <!-- The beds-free card's split treatment: the total, then the part of
               it that is past due. A bare total hides the difference between
               owing and being late, which is the whole judgement. -->
          <template #qualifier>
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
          </template>
        </AppStatCard>
      </div>

      <p v-if="quietDay" class="text-muted-foreground text-sm">
        Nothing needs attention. Everyone is on property, every round is current, and
        everybody is paid up.
      </p>

          <!-- Needs attention: the bell's action items, priority-ordered.
               ONE amber signal, on the panel eyebrow — an inset rule on every
               row made urgency read as wallpaper, and a panel whose title
               already says "needs attention" does not need each row shouting
               it again. The destructive inset below keeps its meaning by
               being the only inset left on the page. -->
      <Card v-if="attention.length" as="section" class="p-0">
        <CardHeader>
          <span class="bg-warning size-1.5 shrink-0 rounded-full" aria-hidden="true" />
          <CardTitle as="h2">Needs attention</CardTitle>
          <span class="text-xs font-semibold tabular-nums">{{ attentionCount }}</span>
        </CardHeader>
        <!-- TWO-UP at xl (2026-08-08). The panel is full width now, and one
             file of rows across 1,150px left most of each row empty while the
             panel itself ran to 422px. Priority still reads left-to-right then
             down, which is the natural order — the rows' SEQUENCE is what makes
             this a queue rather than a list, so it is preserved rather than
             gridded into a serpentine.

             The cost, accepted: an odd number of situations leaves a hole at
             the end of the last row. -->
        <div class="xl:grid xl:grid-cols-2">
          <!-- flex-wrap + a basis on the title: on a phone the meta drops to
               its own line instead of crushing the title to one letter. -->
          <NuxtLink
            v-for="(row, i) in attention"
            :key="row.key"
            :to="row.to"
            class="hover:bg-muted/50 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-4 py-2.5 transition-colors"
            :class="i % 2 === 0 && 'xl:border-e'"
          >
              <span
                class="text-muted-foreground w-14 shrink-0 text-[10.5px] font-semibold tracking-[0.06em] uppercase"
              >
                {{ row.kind }}
              </span>
              <span class="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{{ row.title }}</span>
              <!-- A destructive BADGE, and deliberately not an inset — the
                   2026-08-06 polish pass left exactly one inset on this page
                   (the overdue sign-out card) so that inset means something,
                   and the balances panel took the same trade. The rows here
                   stay quiet; the badge is the whole signal. -->
              <Badge
                v-if="row.chip"
                variant="outline"
                class="text-[10px] tracking-wider uppercase"
                :class="row.tone === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive'"
              >
                {{ row.chip }}
              </Badge>
              <span class="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                {{ row.meta }}
              </span>
          </NuxtLink>
        </div>
      </Card>

      <!-- ── The foot ─────────────────────────────────────────────────────
           THREE panels in one row, and the number was measured rather than
           chosen. The old 1.55/1 split left the schedule alone in a rail
           beside three stacked panels and 537px of nothing; two-up here was
           better but still 138px ragged, and stretching the cells to fix that
           put 140px of blank inside the Today card, which reads as a bug
           rather than as breathing room. Three panels of their natural height
           come out within 78px of each other with no stretch at all — and the
           whole page then fits a 900px viewport, alarm band included.

           `items-start` is back for that reason: nothing needs to stretch when
           the heights already agree. -->
      <div class="grid items-start gap-4 lg:grid-cols-3">
        <Card as="section" class="min-w-0 p-0">
          <CardHeader class="items-baseline">
            <CardTitle as="h2">Today</CardTitle>
            <NuxtLink
              to="/schedule"
              class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
            >
              Schedule →
            </NuxtLink>
          </CardHeader>
          <!-- No border-t wrapper: the rows carry their own, exactly like the
               Signed out and Outstanding balances panels beside it. A wrapper
               would double the rule above the first row. -->
          <AppTodaySchedule :shared="data.upcoming.shared" :lanes="data.upcoming.lanes" />
        </Card>

          <!-- Signed out. Overdue re-derived each tick, so a row crosses the
               grace window without a refetch — the census tile's pattern. -->
          <Card v-if="signedOut.length" as="section" class="min-w-0 p-0">
            <CardHeader class="items-baseline">
              <CardTitle as="h2">Signed out</CardTitle>
              <span class="text-xs font-semibold tabular-nums">{{ signedOut.length }}</span>
              <NuxtLink
                to="/sign-outs"
                class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
              >
                Sign-outs →
              </NuxtLink>
            </CardHeader>
            <div
              v-for="s in signedOut"
              :key="s.id"
              class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5"
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
          </Card>

          <!-- Outstanding balances. The panel KEEPS its name now that invoicing
               exists — it is still the complete list, and overdue is a property
               of some rows, not a different list. Overdue sorts first and takes
               the Signed-out panel's destructive BADGE, deliberately not its
               inset rule: the 2026-08-06 polish pass left exactly one inset on
               this page so that inset means something. Considered, declined. -->
          <Card v-if="balances.owing.length" as="section" class="min-w-0 p-0">
            <CardHeader class="items-baseline">
              <CardTitle as="h2">Outstanding balances</CardTitle>
              <span class="text-xs font-semibold tabular-nums">{{ money(balances.totalCents) }}</span>
              <NuxtLink
                :to="balancesTo"
                class="text-primary ms-auto text-xs font-medium underline-offset-2 hover:underline"
              >
                {{ canManage ? 'Billing →' : 'Residents →' }}
              </NuxtLink>
            </CardHeader>
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
          </Card>
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
