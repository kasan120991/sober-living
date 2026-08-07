<script setup>
import { UserPlus } from '@lucide/vue'
import {
  facilityDateOf,
  formatFacilityTime,
  overdueLabel,
  presenceState,
} from '~/utils/facilityTime.js'
import { STAFF_ROLE } from '~/utils/roles.js'

// The bed board — variant A of the census mocks. Chosen over a table because
// this screen replaces a whiteboard, and a whiteboard's virtue is that absence
// is visible: an empty tile and an out-of-service hole read at a glance, which
// a thin table row does not.
//
// Occupied tiles will grow a presence chip (in house / out until / OVERDUE /
// on pass) when sign-outs and passes exist. Until then a chip on every tile
// would say "In house" seven times, so there is none.
const { getCensus } = useCensus()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()
const { user } = useAuth()

// Presentation only. Every staff role reads this board, but only these two may
// place anyone — `managers` on POST /residents/:id/bed is the real boundary,
// asserted in verify-residents.js.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const data = ref(null)
const pending = ref(true)

// A sign-out becoming overdue mutates nothing — no write, no socket event —
// so the board keeps its own clock. Each tick re-derives every chip from
// expectedReturnAt, and nudges the pill and bell so all three cross the
// threshold together.
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

/** Chip for an occupied tile, or null — in-house tiles stay quiet. */
function chipFor(bed) {
  if (!bed.presence || !bed.presence.expectedReturnAt) return null
  return presenceState(bed.presence, now.value) === 'OVERDUE'
    ? { state: 'OVERDUE', text: `Overdue ${overdueLabel(bed.presence.expectedReturnAt, now.value)}` }
    : { state: 'OUT', text: `Out · back ${formatFacilityTime(bed.presence.expectedReturnAt)}` }
}

async function load() {
  // First load only — a realtime refresh must not blank the board it updates.
  pending.value = !data.value
  data.value = await getCensus()
  pending.value = false

  // Same reasoning as the roster: assigning a bed from this screen must not
  // leave a stale "no bed" notification. Not awaited — the board never waits
  // on the bell.
  refreshNotifications()
}
await load()

// The census is the screen most worth keeping live: another device assigning
// a bed, an intake, a discharge — all land here without a navigation.
onRealtimeChanged(load)

// Out and overdue are re-counted client-side against the ticking clock, so
// the figures always agree with the chips below them.
const liveCounts = computed(() => {
  const counts = { out: 0, overdue: 0 }
  for (const a of data.value?.apartments ?? []) {
    for (const b of a.beds) {
      const chip = chipFor(b)
      if (chip?.state === 'OUT') counts.out += 1
      if (chip?.state === 'OVERDUE') counts.overdue += 1
    }
  }
  return counts
})

// ── Assigning from a free tile ──────────────────────────────────────────────
// `unhoused` has been in the census response all along and rendered nowhere.
// The tile is what uses it: a free bed becomes a button exactly when someone of
// its cohort is waiting, so clickability itself says where they can go. There is
// still no unhoused list on this page — see the note above the apartments.
const unhousedByCohort = computed(() => {
  const by = {}
  for (const r of data.value?.unhoused ?? []) (by[r.cohort] ??= []).push(r)
  return by
})

/** Scalars only — the dialog is a sibling and takes no objects. */
const assignFor = ref(null)

// A computed, not a snapshot taken when the dialog opened. That is what makes
// the list shrink under an open dialog when another device places someone, and
// it is half of the guard against assign-or-move quietly becoming a move.
const candidates = computed(() => unhousedByCohort.value[assignFor.value?.cohort] ?? [])

const assignable = (apartment) =>
  canManage.value && (unhousedByCohort.value[apartment.cohort]?.length ?? 0) > 0

// Quiet figures only get colour (or pixels) when they are the thing to act
// on. A quiet house costs no pixels.
const figures = computed(() => {
  const f = data.value?.figures
  if (!f) return []
  const live = liveCounts.value
  return [
    { key: 'occupied', value: f.occupied, of: f.beds, label: 'beds occupied' },
    { key: 'free', value: f.free, label: f.free === 1 ? 'bed free' : 'beds free', tone: f.free === 0 ? 'text-warning' : 'text-success' },
    live.overdue
      ? { key: 'overdue', value: live.overdue, label: 'overdue', tone: 'text-destructive' }
      : null,
    live.out ? { key: 'out', value: live.out, label: live.out === 1 ? 'signed out' : 'signed out' } : null,
    f.outOfService
      ? { key: 'oos', value: f.outOfService, label: 'out of service' }
      : null,
    f.awaitingBed
      ? { key: 'awaiting', value: f.awaitingBed, label: 'awaiting a bed', tone: 'text-warning' }
      : null,
  ].filter(Boolean)
})
</script>

<template>
  <AppPage title="Census" description="Who is in which bed right now.">
    <div class="flex min-w-0 flex-col gap-4">
      <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

      <template v-else>
        <div class="flex flex-wrap items-end gap-x-7 gap-y-2">
          <div v-for="f in figures" :key="f.key">
            <p class="text-xl leading-tight font-semibold tabular-nums" :class="f.tone">
              {{ f.value }}<span v-if="f.of" class="text-muted-foreground text-sm font-normal">/{{ f.of }}</span>
            </p>
            <p class="text-muted-foreground text-xs">{{ f.label }}</p>
          </div>
        </div>

        <!-- No unhoused banner, by request: the figures row counts whoever is
             awaiting a bed, and the bell carries the names and the action. -->

        <div v-for="a in data.apartments" :key="a.id" class="bg-card rounded-md border p-4">
          <div class="mb-3 flex flex-wrap items-baseline gap-2">
            <span class="text-sm font-semibold">{{ a.name }}</span>
            <Badge variant="outline" class="tracking-wider text-[10px] uppercase">
              {{ a.cohort === 'MEN' ? 'Men' : 'Women' }}
            </Badge>
            <span class="text-muted-foreground ml-auto text-xs tabular-nums">
              {{ a.occupiedCount }} of {{ a.bedCount }} occupied
            </span>
          </div>

          <p v-if="!a.beds.length" class="text-muted-foreground text-sm">
            No beds in this apartment yet.
          </p>

          <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(205px,1fr))] gap-2.5">
            <template v-for="b in a.beds" :key="b.id">
              <!-- Occupied: the name is the tile. The chip is presence — and
                   only when it says something: no chip means in the house. -->
              <div
                v-if="b.resident"
                class="bg-background flex min-h-16 flex-col gap-0.5 rounded-md border px-3 py-2.5"
                :class="
                  chipFor(b)?.state === 'OVERDUE' &&
                  'border-destructive shadow-[inset_3px_0_0_var(--destructive)]'
                "
              >
                <span class="flex items-center justify-between gap-2">
                  <span class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                    Bed {{ b.label }}
                  </span>
                  <Badge
                    v-if="chipFor(b)"
                    variant="outline"
                    class="text-[10px]"
                    :class="
                      chipFor(b).state === 'OVERDUE'
                        ? 'border-destructive/40 bg-destructive/15 text-destructive'
                        : 'border-warning/40 bg-warning/15 text-warning'
                    "
                  >
                    {{ chipFor(b).text }}
                  </Badge>
                </span>
                <NuxtLink
                  :to="`/residents/${b.resident.id}`"
                  class="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {{ b.resident.fullName }}
                </NuxtLink>
                <p class="text-muted-foreground text-xs">
                  {{ b.resident.programName ?? 'No program' }} · since {{ facilityDateOf(b.since) }}
                </p>
              </div>

              <!-- Out of service: a hole, not an error — muted, with its note. -->
              <div
                v-else-if="b.status === 'OUT_OF_SERVICE'"
                class="bg-muted/50 flex min-h-16 flex-col gap-0.5 rounded-md border border-dashed px-3 py-2.5"
              >
                <span class="flex items-center justify-between gap-2">
                  <span class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                    Bed {{ b.label }}
                  </span>
                  <Badge variant="outline" class="text-muted-foreground text-[10px]">Out of service</Badge>
                </span>
                <p class="text-muted-foreground text-xs">
                  {{ b.outOfServiceNote || 'No note recorded' }}
                </p>
              </div>

              <!-- Free: visible as room, the way the whiteboard showed it.
                   And a button when somebody of this cohort is waiting, so the
                   board shows where they can go. One element rather than a
                   v-if/v-else pair — the inert branch is the same tile, just
                   without the affordance. No name goes on it: the census is
                   glanced at over a shoulder, so candidates appear only after a
                   deliberate click, inside the dialog. -->
              <component
                :is="assignable(a) ? 'button' : 'div'"
                v-else
                :type="assignable(a) ? 'button' : undefined"
                class="flex min-h-16 flex-col gap-0.5 rounded-md border border-dashed px-3 py-2.5 text-left"
                :class="
                  assignable(a) &&
                  'hover:border-success/50 hover:bg-success/5 focus-visible:border-ring focus-visible:ring-ring/30 cursor-pointer outline-none transition-colors focus-visible:ring-3'
                "
                :aria-label="
                  assignable(a) ? `Assign a resident to bed ${b.label}, ${a.name}` : undefined
                "
                @click="
                  assignable(a) &&
                  (assignFor = {
                    bedId: b.id,
                    bedLabel: `${a.name} · Bed ${b.label}`,
                    cohort: a.cohort,
                  })
                "
              >
                <span class="flex items-center justify-between gap-2">
                  <span class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                    Bed {{ b.label }}
                  </span>
                  <Badge variant="outline" class="border-success/40 bg-success/15 text-success text-[10px]">
                    Free
                  </Badge>
                </span>
                <p class="text-success flex items-center gap-1.5 text-sm font-medium">
                  Available
                  <!-- Hover does not exist on a manager's phone, so the cue has
                       to be visible at rest. -->
                  <UserPlus v-if="assignable(a)" class="size-3.5 opacity-70" aria-hidden="true" />
                </p>
              </component>
            </template>
          </div>
        </div>

        <p v-if="!data.apartments.length" class="text-muted-foreground text-sm">
          No apartments yet. Set up the facility under
          <NuxtLink to="/apartments" class="underline underline-offset-2">Apartments &amp; Beds</NuxtLink>.
        </p>
      </template>
    </div>

    <!-- Sibling of the board, never inside a tile: one dialog driven by a ref,
         the same rule the roster's row actions follow. -->
    <AppBedAssignDialog
      :open="Boolean(assignFor)"
      :bed-id="assignFor?.bedId"
      :bed-label="assignFor?.bedLabel"
      :cohort="assignFor?.cohort"
      :candidates="candidates"
      @update:open="(v) => !v && (assignFor = null)"
      @assigned="load"
    />
  </AppPage>
</template>
