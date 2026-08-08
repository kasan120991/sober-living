<script setup>
// The med pass board — PASS-FIRST (variant A, chosen 2026-08-07 from three
// rendered variants; resident-first and a day timeline were the others).
//
// The facility has no cron: nothing runs a pass but a person deciding to, so
// this screen's job is to make the next act obvious. Variant A is the only one
// of the three with a single thing to press, and it matches the shape /service
// and /billing already use — an act at the top, the reference beneath it.
//
// What that costs, accepted knowingly: a resident on a morning and an evening
// dose appears in two bands, so "how is Marcus doing on his meds" is NOT
// answered here. That question belongs to the record's Medications section, and
// it is answered there. If the house outgrows a screenful of passes the
// fallback is the resident-first variant, and the figures line carries over.
//
// NO MEDICATION IS NAMED ON THIS PAGE. The payload does not carry one — a drug
// arrives only from GET /meds/pass/:stayId, when somebody opens a sheet. That is
// a server boundary, not a client decision; see services/meds.js.
import { Check, Pill } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { toneClass } from '~/utils/schedule.js'
import { doseState, medStateDisplay, passState } from '~/utils/meds.js'

const { getMeds } = useMeds()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()

const data = ref(null)
const pending = ref(true)

async function load() {
  // First load only — a realtime refresh must not blank the page it updates.
  pending.value = !data.value
  data.value = await getMeds()
  pending.value = false
  refreshNotifications()
  refreshStatus()
}
await load()
onRealtimeChanged(load)

// DUE crossing into MISSED is no write, so no socket event will come — the page
// keeps its own clock. The census and /checks pattern, at the same 30 seconds.
// (/screens deliberately has none: nothing there crosses on time alone.)
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

/**
 * Re-derive each pass against the live clock rather than trusting the states
 * the server sent, which age between refetches. Same knob, mirrored in
 * utils/meds.js.
 */
const passes = computed(() =>
  (data.value?.passes ?? []).map((p) => {
    const residents = p.residents.map((r) => {
      // The server sends per-resident counts; only the split between due and
      // missed can move on the clock, so that is all that is re-derived.
      const stillOpen = r.total - r.marked
      const due = r.upcoming
        ? r.due
        : doseState(p.startsAt, null, now.value) === 'DUE'
          ? stillOpen
          : 0
      return { ...r, due, missed: stillOpen - due - r.upcoming }
    })
    const due = residents.reduce((n, r) => n + r.due, 0)
    const missed = residents.reduce((n, r) => n + Math.max(r.missed, 0), 0)
    const next = { ...p, residents, due, missed }
    return { ...next, state: passState(next) }
  }),
)

const current = computed(() => passes.value.find((p) => p.state === 'DUE') ?? null)
const rest = computed(() => passes.value.filter((p) => p !== current.value))

const figures = computed(() => {
  const f = data.value?.figures ?? { scheduled: 0, marked: 0 }
  return {
    scheduled: f.scheduled,
    marked: f.marked,
    due: passes.value.reduce((n, p) => n + p.due, 0),
    missed: passes.value.reduce((n, p) => n + p.missed, 0),
  }
})

// Width alone misses a tablet; pointer alone is invisible when you test mobile
// by resizing a desktop browser. The 44px tap-floor query, and the same gate
// /checks uses to choose between a drawer and a full-screen round.
const isHallway = useMediaQuery('(max-width: 767px), (pointer: coarse)')

const sheetOpen = ref(false)
const sheetStay = ref(null)
function openPass(r) {
  sheetStay.value = { stayId: r.stayId, fullName: r.fullName }
  sheetOpen.value = true
}
</script>

<template>
  <AppPage title="Med Pass">
    <template #description>
      <template v-if="pending">Loading…</template>
      <template v-else-if="!figures.scheduled">Nobody is on scheduled medication.</template>
      <template v-else>
        <span class="tabular-nums">{{ figures.marked }}</span> of
        <span class="tabular-nums">{{ figures.scheduled }}</span> doses recorded today<template
          v-if="figures.missed"
        >
          · <span class="text-destructive tabular-nums">{{ figures.missed }} missed</span>
        </template>
      </template>
    </template>

    <template v-if="current" #actions>
      <Button v-if="isHallway" as-child>
        <NuxtLink to="/meds/round">
          <Pill class="size-4" /> Start {{ current.label }} pass
        </NuxtLink>
      </Button>
    </template>

    <AppMedPassSheet v-model:open="sheetOpen" :stay="sheetStay" @saved="load" />

    <p v-if="pending" class="text-muted-foreground text-sm">Loading the pass…</p>

    <p v-else-if="!passes.length" class="text-muted-foreground text-sm">
      No medications are scheduled today. Medications are added from a resident’s record.
    </p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <!-- ── The pass happening now ─────────────────────────────────────── -->
      <section v-if="current">
        <p class="text-muted-foreground mb-2 flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          <span class="bg-warning size-1.5 rounded-full" aria-hidden="true" />
          Happening now
        </p>

        <!-- The page's ONLY inset, which is what makes it mean something —
             the 2026-08-06 polish-pass rule. -->
        <div class="bg-card rounded-lg border p-4 shadow-[inset_3px_0_0_var(--warning)]">
          <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="text-[17px] font-semibold tabular-nums">{{ current.label }}</span>
            <Badge variant="outline" class="border-transparent text-[10px]" :class="toneClass('warning')">
              {{ current.due }} still to mark
            </Badge>
            <span class="text-muted-foreground ms-auto text-xs tabular-nums">
              {{ current.marked }} of {{ current.total }} recorded
            </span>
          </div>

          <!-- The h-2 flex track AppServiceProgress uses, deliberately not
               shadcn's Progress. -->
          <div class="bg-muted mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            <i class="bg-success block" :style="{ flex: current.marked || 0.0001 }" />
            <i class="bg-warning/55 block" :style="{ flex: current.total - current.marked || 0.0001 }" />
          </div>

          <div
            v-for="r in current.residents"
            :key="r.stayId"
            class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t py-2.5 first:border-t-0"
          >
            <div class="min-w-0 flex-1 basis-40">
              <!-- Names appear because this is a WORK QUEUE, like /service —
                   you cannot run a pass without knowing whose it is. -->
              <p class="text-[14px] font-medium">{{ r.fullName }}</p>
              <p class="text-muted-foreground text-xs">
                {{ [r.apartmentName, r.bedLabel].filter(Boolean).join(' · ') || '—' }}
              </p>
            </div>
            <Badge
              v-if="r.due"
              variant="outline"
              class="shrink-0 border-transparent text-[10px]"
              :class="toneClass('warning')"
            >
              {{ r.due }} due
            </Badge>
            <Badge
              v-else
              variant="outline"
              class="shrink-0 border-transparent text-[10px]"
              :class="toneClass('success')"
            >
              Recorded
            </Badge>
            <Button v-if="r.due" size="sm" @click="openPass(r)">Record</Button>
            <Button v-else variant="ghost" size="sm" @click="openPass(r)">View</Button>
          </div>
        </div>
      </section>

      <!-- ── The rest of today ──────────────────────────────────────────── -->
      <section v-if="rest.length">
        <p class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          {{ current ? 'Rest of today' : 'Today' }}
        </p>

        <div class="flex flex-wrap gap-3">
          <div
            v-for="p in rest"
            :key="p.time"
            class="bg-card min-w-0 flex-1 basis-56 rounded-lg border px-4 py-3"
            :class="p.missed ? 'shadow-[inset_3px_0_0_var(--destructive)]' : ''"
          >
            <div class="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span class="text-[14.5px] font-semibold tabular-nums">{{ p.label }}</span>
              <Badge
                variant="outline"
                class="border-transparent text-[10px]"
                :class="toneClass(medStateDisplay(p.state).tone)"
              >
                <template v-if="p.missed">{{ p.missed }} missed</template>
                <template v-else-if="p.state === 'GIVEN'">All recorded</template>
                <template v-else>Not due yet</template>
              </Badge>
            </div>

            <button
              v-for="r in p.residents"
              :key="r.stayId"
              type="button"
              class="hover:bg-accent/50 -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors max-md:min-h-11 pointer-coarse:min-h-11"
              @click="openPass(r)"
            >
              <span class="min-w-0 flex-1 truncate text-[13px]">{{ r.fullName }}</span>
              <Badge
                v-if="r.missed > 0"
                variant="outline"
                class="shrink-0 border-transparent text-[10px]"
                :class="toneClass('destructive')"
              >
                Missed
              </Badge>
              <span v-else-if="r.marked === r.total" class="text-muted-foreground shrink-0 text-[11px]">
                Recorded
              </span>
              <span v-else class="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                {{ r.total }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <p v-if="!current && figures.scheduled" class="text-muted-foreground flex items-center gap-2 text-sm">
        <Check class="text-success size-4" /> Nothing is due right now.
      </p>
    </div>
  </AppPage>
</template>
