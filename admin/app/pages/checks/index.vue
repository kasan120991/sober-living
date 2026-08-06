<script setup>
// The hourly round's home: the page IS the apartment picker on desktop, and
// the cards double as this hour's progress. On the hallway hardware — narrow
// OR coarse-pointer, the 44px tap-floor query — a Start round button opens the
// focused round mode at /checks/round instead.
import { ClipboardCheck, Ellipsis } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { COHORT_LABEL } from '~/utils/schedule.js'
import {
  checkOverdueLabel,
  checkState,
  formatFacilityTime,
  formatHourLabel,
} from '~/utils/facilityTime.js'

const { getChecks } = useChecks()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()

const data = ref(null)
const pending = ref(true)

async function load() {
  // First load only — a realtime refresh must not blank the page it updates.
  pending.value = !data.value
  data.value = await getChecks()
  pending.value = false
  refreshNotifications()
  refreshStatus()
}
await load()
onRealtimeChanged(load)

// DUE and OVERDUE are clock crossings, not mutations — nothing signals them,
// so the page keeps its own time. The census pattern.
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

const stateOf = (a) => checkState(a.lastCheck?.at ?? null, now.value)
const figures = computed(() => {
  const apartments = data.value?.apartments ?? []
  return {
    of: apartments.length,
    checked: apartments.filter((a) => stateOf(a) === 'CHECKED').length,
    overdue: apartments.filter((a) => stateOf(a) === 'OVERDUE').length,
  }
})

// The hallway query — width alone misses a tablet, pointer alone is invisible
// when testing by resizing a desktop browser. Same media the tap floor uses.
const isHallway = useMediaQuery('(max-width: 767px), (pointer: coarse)')

// One sheet for the whole page, driven by refs — the AppBedTable rule.
const sheetOpen = ref(false)
const sheetApartment = ref(null)
const sheetAmendId = ref(null)

function openCheck(a) {
  sheetAmendId.value = null
  sheetApartment.value = { id: a.id, name: a.name }
  sheetOpen.value = true
}
function openAmend(row) {
  sheetApartment.value = null
  sheetAmendId.value = row.id
  sheetOpen.value = true
}
</script>

<template>
  <AppPage title="Apartment Checks">
    <template #description>
      <template v-if="data">
        {{ formatHourLabel(data.hour.key) }} round ·
        <span class="tabular-nums">{{ figures.checked }} of {{ figures.of }}</span> checked
        <template v-if="figures.overdue">
          · <span class="text-destructive font-medium tabular-nums">{{ figures.overdue }} overdue</span>
        </template>
      </template>
    </template>
    <template #actions>
      <Button v-if="isHallway" size="sm" as-child>
        <NuxtLink to="/checks/round"><ClipboardCheck class="size-4" /> Start round</NuxtLink>
      </Button>
    </template>

    <AppCheckSheet
      v-model:open="sheetOpen"
      :apartment="sheetApartment"
      :amend-id="sheetAmendId"
      @saved="load"
    />

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          This hour
        </h2>

        <!-- Most overdue first (the API's order); every card is the way into
             its own check sheet. -->
        <div class="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="a in data.apartments"
            :key="a.id"
            type="button"
            class="bg-card hover:bg-accent/40 flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors"
            :class="stateOf(a) === 'OVERDUE' && 'border-destructive shadow-[inset_3px_0_0_var(--destructive)]'"
            @click="openCheck(a)"
          >
            <div class="flex w-full items-center gap-2">
              <span class="text-[15px] font-semibold">{{ a.name }}</span>
              <span class="text-muted-foreground text-xs">{{ COHORT_LABEL[a.cohort] }}</span>
              <Badge
                v-if="stateOf(a) === 'OVERDUE'"
                class="bg-destructive ms-auto shrink-0 text-[10px] text-white tabular-nums"
              >
                {{ a.lastCheck ? `Overdue ${checkOverdueLabel(a.lastCheck.at, now)}` : 'Overdue' }}
              </Badge>
              <Badge
                v-else-if="stateOf(a) === 'DUE'"
                variant="outline"
                class="border-warning/40 bg-warning/15 text-warning-foreground ms-auto shrink-0 text-[10px]"
              >
                Due
              </Badge>
              <span v-else class="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                ✓ {{ formatFacilityTime(a.lastCheck.at) }}
              </span>
            </div>
            <p class="text-muted-foreground text-[13px] tabular-nums">
              {{ a.onSite }} of {{ a.occupants }} on site
              <template v-if="a.lastCheck && a.lastCheck.accounted.notFound">
                · <span class="text-destructive font-medium">{{ a.lastCheck.accounted.notFound }} not found</span>
              </template>
            </p>
            <p class="text-muted-foreground/80 text-xs">
              <template v-if="a.lastCheck">
                Last checked {{ formatFacilityTime(a.lastCheck.at) }} by {{ a.lastCheck.byName }}
              </template>
              <template v-else>Never checked</template>
            </p>
          </button>
        </div>
      </section>

      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Today
        </h2>

        <p v-if="!data.log.length" class="text-muted-foreground text-sm">No checks recorded yet today.</p>

        <div v-else class="flex flex-col gap-3">
          <div v-for="bucket in data.log" :key="bucket.hourKey">
            <p class="text-muted-foreground mb-1 text-xs font-medium tabular-nums">
              {{ formatHourLabel(bucket.hourKey) }}
            </p>
            <div class="flex flex-col">
              <div
                v-for="c in bucket.checks"
                :key="c.id"
                class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 py-2 text-sm last:border-b-0"
              >
                <span class="font-semibold">{{ c.apartmentName }}</span>
                <span class="text-muted-foreground text-[13px] tabular-nums">
                  {{ formatFacilityTime(c.at) }} · {{ c.byName }} ·
                  {{ c.accounted.present }} present<template v-if="c.accounted.signedOut"
                    >, {{ c.accounted.signedOut }} out</template
                  ><template v-if="c.accounted.notFound"
                    >, <span class="text-destructive font-medium">{{ c.accounted.notFound }} not found</span></template
                  >
                </span>
                <Badge
                  v-if="c.amended"
                  variant="outline"
                  class="text-muted-foreground text-[10px]"
                  :title="c.amendmentReason ?? undefined"
                >
                  Amended
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="ms-auto"
                      :aria-label="`Actions for the ${c.apartmentName} check`"
                    >
                      <Ellipsis class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-52">
                    <DropdownMenuItem @select="openAmend(c)">Amend — correct a mistake…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p v-if="bucket.missing.length" class="text-warning-foreground bg-warning/10 mt-1 rounded-md px-2 py-1.5 text-xs">
                No check: {{ bucket.missing.join(', ') }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </AppPage>
</template>
