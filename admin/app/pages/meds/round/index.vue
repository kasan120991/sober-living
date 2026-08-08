<script setup>
// ROUND MODE — the hallway picker, /checks/round's twin.
//
// A drawer over a board on a 390px phone spends a third of the viewport on the
// thing you just left, so here the pass IS the screen: a progress track, big
// rows, tap → the resident's step → back to the picker. NO FORCED SEQUENCE, and
// a resident already recorded stays tappable — a second look is a legitimate
// act, and the sheet shows what was recorded.
//
// A live deep link at every width, deliberately: the route is not gated, only
// the Start round button on the board is. Someone sent this URL on a desktop
// should get the screen, not a redirect.
import { doseState, passState } from '~/utils/meds.js'

const { getMeds } = useMeds()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()
const router = useRouter()

const data = ref(null)
const pending = ref(true)

async function load() {
  pending.value = !data.value
  data.value = await getMeds()
  pending.value = false
  refreshNotifications()
  refreshStatus()
}
await load()
onRealtimeChanged(load)

const now = ref(Date.now())
let tick = null
onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})
onUnmounted(() => clearInterval(tick))

/** The pass being run: the one with doses due, else the most recent elapsed. */
const current = computed(() => {
  const passes = data.value?.passes ?? []
  const withState = passes.map((p) => ({ ...p, live: passState(p) }))
  return (
    withState.find((p) => p.due > 0) ??
    withState.filter((p) => doseState(p.startsAt, null, now.value) !== 'UPCOMING').at(-1) ??
    withState[0] ??
    null
  )
})

const people = computed(() => current.value?.residents ?? [])
const done = computed(() => people.value.filter((r) => r.marked === r.total).length)
</script>

<template>
  <AppPage title="Med pass round" :back="{ label: 'Med Pass', to: '/meds' }">
    <template #description>
      <template v-if="current">
        {{ current.label }} · <span class="tabular-nums">{{ done }}</span> of
        <span class="tabular-nums">{{ people.length }}</span> residents done
      </template>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <p v-else-if="!current" class="text-muted-foreground text-sm">
      No medications are scheduled today.
    </p>

    <div v-else class="flex flex-col gap-4">
      <!-- The track: one segment per resident, filled as each is recorded. -->
      <div class="flex gap-1" aria-hidden="true">
        <i
          v-for="r in people"
          :key="r.stayId"
          class="h-1 flex-1 rounded-full"
          :class="r.marked === r.total ? 'bg-primary' : 'bg-muted'"
        />
      </div>

      <div class="flex flex-col gap-2">
        <button
          v-for="r in people"
          :key="r.stayId"
          type="button"
          class="bg-card hover:bg-accent/40 flex min-h-16 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
          :class="[
            r.marked === r.total ? 'opacity-70' : '',
            r.missed > 0 ? 'border-destructive shadow-[inset_3px_0_0_var(--destructive)]' : '',
          ]"
          @click="router.push(`/meds/round/${r.stayId}`)"
        >
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-medium">{{ r.fullName }}</p>
            <p class="text-muted-foreground text-xs">
              {{ [r.apartmentName, r.bedLabel].filter(Boolean).join(' · ') || '—' }}
            </p>
          </div>
          <span
            v-if="r.marked === r.total"
            class="text-muted-foreground shrink-0 text-xs"
          >
            Recorded
          </span>
          <span v-else class="text-warning shrink-0 text-xs tabular-nums">
            {{ r.total - r.marked }} to mark
          </span>
        </button>
      </div>
    </div>
  </AppPage>
</template>
