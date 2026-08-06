<script setup>
// Round mode — the focused flow Kasan chose for phones and tablets: Start
// round → pick an apartment → check sheet → save → back to this picker, with
// no forced sequence. A live deep link at every width (route convention);
// desktop just isn't pointed at it, because there the /checks page is the
// picker itself.
import { Check, ChevronRight } from '@lucide/vue'
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
  pending.value = !data.value
  data.value = await getChecks()
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

const stateOf = (a) => checkState(a.lastCheck?.at ?? null, now.value)
const checkedCount = computed(
  () => (data.value?.apartments ?? []).filter((a) => stateOf(a) === 'CHECKED').length,
)
const total = computed(() => data.value?.apartments.length ?? 0)
const allChecked = computed(() => total.value > 0 && checkedCount.value === total.value)

const sheetOpen = ref(false)
const sheetApartment = ref(null)
function openCheck(a) {
  sheetApartment.value = { id: a.id, name: a.name }
  sheetOpen.value = true
}
</script>

<template>
  <AppPage title="Round" :back="{ label: 'Apartment Checks', to: '/checks' }">
    <template #description>
      <template v-if="data">
        {{ formatHourLabel(data.hour.key) }} ·
        <span class="tabular-nums">{{ checkedCount }} of {{ total }}</span> checked
      </template>
    </template>

    <AppCheckSheet v-model:open="sheetOpen" :apartment="sheetApartment" @saved="load" />

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="mx-auto flex w-full max-w-md flex-col gap-4">
      <div class="flex gap-1" aria-hidden="true">
        <i
          v-for="a in data.apartments"
          :key="a.id"
          class="h-1 flex-1 rounded-full"
          :class="stateOf(a) === 'CHECKED' ? 'bg-primary' : 'bg-muted'"
        />
      </div>

      <div class="flex flex-col gap-2.5">
        <!-- Big tappable rows, most overdue first; a checked apartment quiets
             down but stays tappable — a second walk is a second check. -->
        <button
          v-for="a in data.apartments"
          :key="a.id"
          type="button"
          class="bg-card hover:bg-accent/40 flex min-h-16 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
          :class="[
            stateOf(a) === 'OVERDUE' && 'border-destructive shadow-[inset_3px_0_0_var(--destructive)]',
            stateOf(a) === 'CHECKED' && 'opacity-70',
          ]"
          @click="openCheck(a)"
        >
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-semibold">
              {{ a.name }}
              <span class="text-muted-foreground ms-1 text-xs font-normal">{{ COHORT_LABEL[a.cohort] }}</span>
            </p>
            <p class="text-muted-foreground text-[13px] tabular-nums">
              {{ a.onSite }} of {{ a.occupants }} on site
              <template v-if="a.lastCheck"> · last {{ formatFacilityTime(a.lastCheck.at) }}</template>
            </p>
          </div>

          <Badge
            v-if="stateOf(a) === 'OVERDUE'"
            class="bg-destructive shrink-0 text-[10px] text-white tabular-nums"
          >
            {{ a.lastCheck ? `Overdue ${checkOverdueLabel(a.lastCheck.at, now)}` : 'Overdue' }}
          </Badge>
          <span v-else-if="stateOf(a) === 'CHECKED'" class="text-success shrink-0 text-sm font-medium">
            <Check class="inline size-4" /> Done
          </span>
          <Badge
            v-else
            variant="outline"
            class="border-warning/40 bg-warning/15 text-warning-foreground shrink-0 text-[10px]"
          >
            Due
          </Badge>
          <ChevronRight class="text-muted-foreground size-4 shrink-0" />
        </button>
      </div>

      <Button v-if="allChecked" as-child>
        <NuxtLink to="/checks"><Check class="size-4" /> Round done — back to checks</NuxtLink>
      </Button>
    </div>
  </AppPage>
</template>
