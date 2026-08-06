<script setup>
import { DoorOpen, Ellipsis, Undo2 } from '@lucide/vue'
import {
  facilityDateOf,
  formatFacilityTime,
  overdueLabel,
  presenceState,
} from '~/utils/facilityTime.js'

// Variant A of the sign-outs mocks: everyone off property is a card with one
// big button, the overdue card is the loudest thing on the page, and completed
// returns collapse to quiet history lines.
const { listSignOuts, acknowledgeReturn, removeSignOut } = useSignOuts()
const { listResidents } = useResidents()
const { refresh: refreshNotifications } = useNotifications()
const { refresh: refreshStatus } = useFacilityStatus()
const notify = useNotify()

const data = ref(null)
const residents = ref([])
const pending = ref(true)

async function load() {
  // First load only — a realtime refresh must not blank the list it updates.
  pending.value = !data.value
  ;[data.value, residents.value] = await Promise.all([
    listSignOuts(),
    listResidents().then((r) => r.residents),
  ])
  pending.value = false
  refreshNotifications()
  refreshStatus()
}
await load()
onRealtimeChanged(load)

// Overdue is a clock crossing, not a mutation — nothing signals it, so the
// page keeps its own time. Same pattern as the census board.
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

const isOverdue = (s) =>
  presenceState({ expectedReturnAt: s.expectedReturnAt }, now.value) === 'OVERDUE'

const counts = computed(() => {
  const open = data.value?.open ?? []
  return { out: open.length, overdue: open.filter(isOverdue).length }
})

/** Completed returns on today's facility date; the rest is for reports. */
const returnedToday = computed(() =>
  (data.value?.returned ?? []).filter(
    (s) => facilityDateOf(s.returnedAt) === facilityDateOf(new Date().toISOString()),
  ),
)

const outIds = computed(() => (data.value?.open ?? []).map((s) => s.resident.id))

// The dialog is shared with the dashboard's quick actions now, so it takes
// v-model:open and this page provides its own trigger.
const signOutOpen = ref(false)

const busy = ref(null)

async function markBack(s) {
  busy.value = s.id
  try {
    await acknowledgeReturn(s.id)
    notify.success(`${s.resident.fullName} is back`)
    await load()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not record the return.')
  } finally {
    busy.value = null
  }
}

async function remove(s) {
  busy.value = s.id
  try {
    await removeSignOut(s.id)
    notify.success('Sign-out removed')
    await load()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not remove the sign-out.')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <AppPage title="Sign-Outs">
    <template #description>
      <template v-if="counts.out">
        <span class="tabular-nums">{{ counts.out }}</span> out
        <template v-if="counts.overdue">
          · <span class="text-destructive font-medium tabular-nums">{{ counts.overdue }} overdue</span>
        </template>
      </template>
      <template v-else>Everyone is on property.</template>
    </template>
    <template #actions>
      <Button size="sm" @click="signOutOpen = true">
        <DoorOpen class="size-4" /> Sign someone out
      </Button>
    </template>

    <AppSignOutDialog
      v-model:open="signOutOpen"
      :residents="residents"
      :out-ids="outIds"
      @recorded="load"
    />

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Out now
        </h2>

        <p v-if="!data.open.length" class="text-muted-foreground text-sm">
          Nobody is signed out.
        </p>

        <div v-else class="flex flex-col gap-2.5">
          <!-- The API sorts most-overdue first, so the loudest card is on top. -->
          <div
            v-for="s in data.open"
            :key="s.id"
            class="bg-card flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-4 py-3"
            :class="isOverdue(s) && 'border-destructive shadow-[inset_3px_0_0_var(--destructive)]'"
          >
            <div class="min-w-0 flex-1 basis-52">
              <NuxtLink
                :to="`/residents/${s.resident.id}`"
                class="text-[15px] font-semibold underline-offset-2 hover:underline"
              >
                {{ s.resident.fullName }}
              </NuxtLink>
              <p class="text-muted-foreground mt-0.5 text-[13px]">
                {{ s.destination }}<template v-if="s.purpose"> · {{ s.purpose }}</template>
              </p>
              <p class="text-muted-foreground/80 mt-0.5 text-xs">
                Signed out {{ formatFacilityTime(s.outAt) }} by {{ s.recordedBy.fullName }}
              </p>
            </div>

            <div class="text-right text-xs">
              <p
                class="text-sm font-semibold tabular-nums"
                :class="isOverdue(s) ? 'text-destructive' : 'text-foreground'"
              >
                <template v-if="isOverdue(s)">Overdue {{ overdueLabel(s.expectedReturnAt, now) }}</template>
                <template v-else>Back by {{ formatFacilityTime(s.expectedReturnAt) }}</template>
              </p>
              <p v-if="isOverdue(s)" class="text-muted-foreground mt-0.5">
                expected {{ formatFacilityTime(s.expectedReturnAt) }}
              </p>
            </div>

            <!-- The page's whole job, thumb-sized. Overdue keeps the filled
                 style so the fix is as loud as the problem. -->
            <Button
              :variant="isOverdue(s) ? 'default' : 'outline'"
              :disabled="busy === s.id"
              @click="markBack(s)"
            >
              <Undo2 class="size-4" /> Back
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="sm" :aria-label="`Actions for ${s.resident.fullName}`">
                  <Ellipsis class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-56">
                <DropdownMenuItem as-child>
                  <NuxtLink :to="`/residents/${s.resident.id}`">Open record</NuxtLink>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="text-destructive" @select="remove(s)">
                  Remove — recorded in error
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Returned today
        </h2>

        <p v-if="!returnedToday.length" class="text-muted-foreground text-sm">No returns yet today.</p>

        <div v-else class="flex flex-col">
          <div
            v-for="s in returnedToday"
            :key="s.id"
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 py-2.5 text-sm"
          >
            <Badge variant="outline" class="border-success/40 bg-success/15 text-success text-[10px]">
              Returned
            </Badge>
            <NuxtLink
              :to="`/residents/${s.resident.id}`"
              class="font-semibold underline-offset-2 hover:underline"
            >
              {{ s.resident.fullName }}
            </NuxtLink>
            <span class="text-muted-foreground text-[13px]">
              {{ s.destination }} · out {{ formatFacilityTime(s.outAt) }} → back
              {{ formatFacilityTime(s.returnedAt) }} · seen by
              {{ s.returnAcknowledgedBy?.fullName }}
            </span>
          </div>
        </div>
      </section>
    </div>
  </AppPage>
</template>
