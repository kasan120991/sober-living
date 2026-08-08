<script setup>
// The travel passes board — REVIEW QUEUE FIRST (variant A, chosen 2026-08-08
// from three rendered variants; a fortnight calendar and a filterable table
// were the others).
//
// A request is the only thing in this module with somebody waiting on it — a
// resident who does not yet know whether they can go to their sister's wedding
// — so it leads the page even on the days it is empty. The same argument
// /service makes for its verification queue.
//
// What that costs, accepted knowingly: the page says nothing about OVERLAP.
// Four residents away the same weekend looks identical to four spread across a
// month, and that is a real staffing question. The calendar variant is the
// fallback once passes are frequent enough for it to matter; with five
// residents there is not enough to draw.
import { Plane } from '@lucide/vue'
import { toneClass } from '~/utils/schedule.js'
import { nightsLabel, passDisplay, passOverdue } from '~/utils/passes.js'
import { STAFF_ROLE } from '~/utils/roles.js'
import { facilityDateOf, formatFacilityTime, humanDate } from '~/utils/facilityTime.js'

const { getPasses, reviewPass, returnPass } = usePasses()
const { user } = useAuth()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()
const notify = useNotify()

const data = ref(null)
const pending = ref(true)
const busy = ref(null)

async function load() {
  // First load only — a realtime refresh must not blank the page it updates.
  pending.value = !data.value
  data.value = await getPasses()
  pending.value = false
  refreshNotifications()
  refreshStatus()
}
await load()
onRealtimeChanged(load)

// A pass crossing into overdue is no write, so no socket event will come — the
// page keeps its own clock. The census and /checks pattern, at the same 30s.
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

// Presentation only — the routes refuse a tech regardless.
const canReview = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const awaiting = computed(() => data.value?.awaitingReview ?? [])
// Re-derived against the live clock rather than trusting what the server sent,
// which ages between refetches. Same knob, mirrored in utils/passes.js.
const away = computed(() =>
  (data.value?.away ?? [])
    .map((p) => ({ ...p, overdue: passOverdue(p, now.value) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || new Date(a.returnBy) - new Date(b.returnBy)),
)
const recent = computed(() => data.value?.recent ?? [])

const requestOpen = ref(false)
const reviewOpen = ref(false)
const reviewMode = ref('deny')
const subject = ref(null)

// One dialog per page driven by a row ref, never one per row — the AppBedTable
// rule. `mode` is what lets the deny and cancel refusals share it.
function openReview(p, mode = 'deny') {
  subject.value = p
  reviewMode.value = mode
  reviewOpen.value = true
}

/**
 * Has this pass actually STARTED? An approved pass for next Friday is not an
 * absence yet, and the distinction is not cosmetic: offering "Mark returned" on
 * one would let a tech record a return for a journey nobody has made, which the
 * service happily accepts because RETURNED is a legal move from APPROVED.
 * Departed passes get Mark returned; upcoming ones get Cancel, which is the
 * only thing that can truthfully be done to a trip that has not happened.
 */
const departed = (p) => new Date(p.departAt).getTime() <= now.value

async function approve(p) {
  busy.value = p.id
  try {
    await reviewPass(p.id, { approve: true })
    notify.success(`Pass approved for ${p.fullName}`)
    await load()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not approve this pass.')
  } finally {
    busy.value = null
  }
}

async function markReturned(p) {
  busy.value = p.id
  try {
    await returnPass(p.id)
    notify.success(`${p.fullName} marked back`)
    await load()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not record the return.')
  } finally {
    busy.value = null
  }
}

/** "Fri 14 Aug, 6:00 PM → Sun 16 Aug, 8:00 PM" */
const window = (p) =>
  `${humanDate(facilityDateOf(p.departAt), { short: true })}, ${formatFacilityTime(p.departAt)} → ` +
  `${humanDate(facilityDateOf(p.returnBy), { short: true })}, ${formatFacilityTime(p.returnBy)}`
</script>

<template>
  <AppPage title="Travel Passes">
    <template #description>
      <template v-if="pending">Loading…</template>
      <template v-else>
        <span class="tabular-nums">{{ awaiting.length }}</span> awaiting review ·
        <span class="tabular-nums">{{ away.filter(departed).length }}</span> away now<template
          v-if="away.some((p) => p.overdue)"
        >
          · <span class="text-destructive tabular-nums">
            {{ away.filter((p) => p.overdue).length }} overdue
          </span>
        </template>
      </template>
    </template>

    <template #actions>
      <Button @click="requestOpen = true"><Plane class="size-4" /> Request a pass</Button>
    </template>

    <AppPassRequestDialog v-model:open="requestOpen" @saved="load" />
    <AppPassReviewDialog v-model:open="reviewOpen" :pass="subject" :mode="reviewMode" @saved="load" />

    <p v-if="pending" class="text-muted-foreground text-sm">Loading passes…</p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <!-- ── Awaiting review ────────────────────────────────────────────── -->
      <section>
        <p class="text-muted-foreground mb-2 flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          <span v-if="awaiting.length" class="bg-warning size-1.5 rounded-full" aria-hidden="true" />
          Awaiting review
        </p>

        <p v-if="!awaiting.length" class="text-muted-foreground text-sm">
          Nothing waiting on a decision.
        </p>

        <div v-else class="flex flex-col gap-2">
          <div
            v-for="p in awaiting"
            :key="p.id"
            class="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 shadow-[inset_3px_0_0_var(--warning)]"
          >
            <div class="min-w-0 flex-1 basis-52">
              <NuxtLink :to="`/residents/${p.residentId}`" class="text-[14px] font-medium hover:underline">
                {{ p.fullName }}
              </NuxtLink>
              <p class="text-muted-foreground text-xs tabular-nums">
                {{ window(p) }} · {{ nightsLabel(p.nights) }}
              </p>
              <p class="text-muted-foreground text-xs">
                {{ p.destination }}<template v-if="p.purpose"> · {{ p.purpose }}</template>
              </p>
            </div>
            <template v-if="canReview">
              <Button variant="outline" size="sm" @click="openReview(p)">Deny…</Button>
              <Button size="sm" :disabled="busy === p.id" @click="approve(p)">Approve</Button>
            </template>
            <Badge
              v-else
              variant="outline"
              class="border-transparent text-[10px]"
              :class="toneClass('warning')"
            >
              Awaiting a manager
            </Badge>
          </div>
        </div>
      </section>

      <!-- ── Approved ───────────────────────────────────────────────────
           Away AND upcoming, in one band under one honest heading. It said
           "Away" and listed both, so a pass approved for next Friday sat under
           a word that was not yet true — beside a figures line reading "0 away
           now", which made the page look as though it disagreed with itself.
           One band rather than two because the count of each is usually one or
           zero, and the row already says which it is. -->
      <section v-if="away.length">
        <p class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Approved
        </p>
        <div class="flex flex-col gap-2">
          <div
            v-for="p in away"
            :key="p.id"
            class="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3"
            :class="p.overdue ? 'border-destructive shadow-[inset_3px_0_0_var(--destructive)]' : ''"
          >
            <div class="min-w-0 flex-1 basis-52">
              <NuxtLink :to="`/residents/${p.residentId}`" class="text-[14px] font-medium hover:underline">
                {{ p.fullName }}
              </NuxtLink>
              <!-- The destination DOES appear here, unlike the census tile:
                   this is a work queue, and whoever chases an overdue return
                   needs to know where to start looking. -->
              <p class="text-muted-foreground text-xs">{{ p.destination }}</p>
              <p v-if="departed(p)" class="text-muted-foreground text-xs tabular-nums">
                Back {{ humanDate(facilityDateOf(p.returnBy), { short: true }) }},
                {{ formatFacilityTime(p.returnBy) }} · bed held
              </p>
              <p v-else class="text-muted-foreground text-xs tabular-nums">
                Leaves {{ humanDate(facilityDateOf(p.departAt), { short: true }) }},
                {{ formatFacilityTime(p.departAt) }} · {{ nightsLabel(p.nights) }} · bed held
              </p>
            </div>
            <Badge
              variant="outline"
              class="shrink-0 border-transparent text-[10px]"
              :class="toneClass(p.overdue ? 'destructive' : 'success')"
            >
              {{ p.overdue ? 'Overdue back' : departed(p) ? 'Away' : 'Upcoming' }}
            </Badge>
            <Button
              v-if="departed(p)"
              size="sm"
              :variant="p.overdue ? 'default' : 'ghost'"
              :disabled="busy === p.id"
              @click="markReturned(p)"
            >
              Mark returned
            </Button>
            <!-- Calling off a pass nobody has left on. Managers, with a reason
                 — the denial's twin, and the same CHECK behind it. -->
            <Button
              v-else-if="canReview"
              size="sm"
              variant="ghost"
              @click="openReview(p, 'cancel')"
            >
              Cancel…
            </Button>
          </div>
        </div>
      </section>

      <!-- ── Recent ─────────────────────────────────────────────────────── -->
      <section v-if="recent.length">
        <p class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Recent
        </p>
        <div class="overflow-hidden rounded-md border">
          <div
            v-for="p in recent"
            :key="p.id"
            class="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 last:border-b-0"
          >
            <span class="min-w-0 flex-1 basis-40 text-[13.5px]">{{ p.fullName }}</span>
            <span class="text-muted-foreground text-xs tabular-nums">
              {{ humanDate(facilityDateOf(p.departAt), { short: true, relative: false }) }}
            </span>
            <Badge
              variant="outline"
              class="shrink-0 border-transparent text-[10px]"
              :class="toneClass(passDisplay(p.status).tone)"
            >
              {{ passDisplay(p.status).label }}
            </Badge>
            <!-- The reason a request was refused, which is the part a resident
                 asks about and the facility has to be able to answer. -->
            <span v-if="p.reviewNote" class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {{ p.reviewNote }}
            </span>
          </div>
        </div>
      </section>
    </div>
  </AppPage>
</template>
