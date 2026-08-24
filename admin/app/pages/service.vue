<script setup>
// Community service, house-wide.
//
// Chosen from three rendered variants (2026-08-05): two bands, the verification
// queue over the progress list — the shape sign-outs already proves, with
// different nouns. The reasoning is that verification is the only thing on this
// page with a clock on it: an unsigned slip is hours that do not count toward a
// target, and hours that do not count are hours the facility cannot show an
// auditor. So it goes first, and it is one tap.
//
// The rejected pair are worth remembering. A single filterable table reads
// better as a reference view but buries the time-sensitive action behind a
// filter chip, and its default tab is the least actionable one. A card per
// resident is prettier but puts a "Verify 3.5 h" button on a person — which is
// a lie the moment somebody has two slips pending.
import { STAFF_ROLE } from '~/utils/roles.js'
import { hours } from '~/utils/serviceHours.js'
import { isoDate } from '~/composables/useResidents.js'

const { getHouseService, verifyEntry } = useServiceHours()
const { user } = useAuth()
const notify = useNotify()

// Verifying is all-staff, deliberately — see routes/service.js. Only the target
// dialog is manager-gated, and that lives on the resident record.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const data = ref(null)
const pending = ref(true)
const busy = ref(null)

async function load() {
  // First load only — a realtime refresh must not blank the queue it updates.
  pending.value = !data.value
  data.value = await getHouseService()
  pending.value = false
}
await load()
onRealtimeChanged(load)

const queue = computed(() => data.value?.pending ?? [])
const figures = computed(() => data.value?.figures ?? {})

// Residents with no target at all sit in their own quiet group rather than
// reading "0 of 0" among the rest — nothing is owed, so nothing is wrong.
const tracked = computed(() => (data.value?.progress ?? []).filter((p) => p.requiredMinutes != null))
const untracked = computed(() =>
  (data.value?.progress ?? []).filter((p) => p.requiredMinutes == null),
)

async function verify(entry) {
  busy.value = entry.id
  try {
    await verifyEntry(entry.id)
    notify.success(`${hours(entry.minutes)} verified for ${entry.residentName}`)
    await load()
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not verify the entry.')
  } finally {
    busy.value = null
  }
}

const COLUMNS = [
  { key: 'resident', label: 'Resident' },
  { key: 'program', label: 'Phase' },
  { key: 'progress', label: 'Progress' },
  { key: 'hours', label: 'Hours' },
  { key: 'status', label: '' },
]
</script>

<template>
  <AppPage title="Community Service">
    <template #description>
      <template v-if="figures.awaitingVerification || figures.behind">
        <span class="tabular-nums">{{ figures.awaitingVerification }}</span> awaiting
        verification · <span class="tabular-nums">{{ figures.behind }}</span> behind
      </template>
      <template v-else>Hours owed and worked off.</template>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <!-- ── Awaiting verification ──────────────────────────────────────────
           Derived on every read, so an entry leaves the moment it is signed —
           nothing is stored, nothing can be dismissed into a lie. The same
           reasoning as the bell and the schedule board's roll queue.

           Not capped: unlike the roll queue, which can hold weeks of stale
           history, every row here is a slip somebody is waiting on. A queue
           that hides work is worse than a long one. -->
      <section v-if="queue.length">
        <div class="mb-2 flex items-center justify-between gap-3">
          <h2 class="text-muted-foreground text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            Awaiting verification
          </h2>
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ hours(figures.awaitingMinutes) }} in total
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="e in queue"
            :key="e.id"
            class="bg-card flex min-h-16 flex-wrap items-center gap-3 rounded-md border px-3 py-2.5 shadow-[inset_3px_0_0_var(--warning)]"
          >
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13.5px] font-medium">
                <NuxtLink
                  :to="`/residents/${e.residentId}?s=service`"
                  class="underline-offset-2 hover:underline"
                >
                  {{ e.residentName }}
                </NuxtLink>
                <span class="tabular-nums">· {{ hours(e.minutes) }}</span>
                <Badge v-if="e.supersedes" variant="outline" class="border-dashed text-[10px]">
                  Amendment
                </Badge>
              </p>
              <p class="text-muted-foreground text-xs">
                {{ e.location }}
                <template v-if="e.supervisorName"> · {{ e.supervisorName }}</template>
                · worked <span class="tabular-nums">{{ isoDate(e.workedOn) }}</span>
                <template v-if="e.recordedBy"> · logged by {{ e.recordedBy.fullName }}</template>
              </p>
              <p v-if="e.supersedes" class="text-muted-foreground text-xs">
                was <span class="tabular-nums">{{ hours(e.supersedes.minutes) }}</span> —
                “{{ e.amendmentReason }}”
              </p>
            </div>

            <Button class="ms-auto" :disabled="busy === e.id" @click="verify(e)">Verify</Button>
          </div>
        </div>
      </section>

      <!-- ── Progress ───────────────────────────────────────────────────── -->
      <section>
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Progress
        </h2>

        <div v-if="tracked.length" class="overflow-hidden rounded-md border">
          <Table class="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead
                  v-for="c in COLUMNS"
                  :key="c.key"
                >
                  {{ c.label }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="p in tracked" :key="p.residentId" class="bg-card">
                <TableCell class="whitespace-nowrap">
                  <NuxtLink
                    :to="`/residents/${p.residentId}?s=service`"
                    class="underline-offset-2 hover:underline"
                  >
                    {{ p.residentName }}
                  </NuxtLink>
                </TableCell>
                <TableCell class="text-muted-foreground text-xs whitespace-nowrap">
                  {{ p.programName ?? '—' }}
                </TableCell>
                <TableCell class="w-[28%] min-w-[140px]">
                  <AppServiceProgress :service="p" compact />
                </TableCell>
                <TableCell class="whitespace-nowrap tabular-nums">
                  {{ hours(p.verifiedMinutes) }} of {{ hours(p.requiredMinutes) }}
                  <span v-if="p.pendingMinutes" class="text-muted-foreground text-xs">
                    · {{ hours(p.pendingMinutes) }} pending
                  </span>
                </TableCell>
                <TableCell class="text-right whitespace-nowrap">
                  <Badge
                    v-if="p.behind"
                    variant="outline"
                    class="border-warning/45 bg-warning/15 text-warning text-[10px]"
                  >
                    Behind {{ hours(p.behindMinutes) }}
                  </Badge>
                  <Badge
                    v-else-if="p.verifiedMinutes >= p.requiredMinutes"
                    variant="outline"
                    class="border-success/40 bg-success/15 text-success text-[10px]"
                  >
                    Met
                  </Badge>
                  <span v-else-if="p.monthsElapsed === 0" class="text-muted-foreground text-xs">
                    day <span class="tabular-nums">{{ p.dayOfStay }}</span> — none due
                  </span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <p v-else class="text-muted-foreground text-sm">
          Nobody has a service target yet. A phase carries a default, and a stay can override
          it — set one from a resident's record.
        </p>
      </section>

      <!-- Quiet, at the bottom, and only when it is not empty: a resident who
           owes nothing is not a problem to be solved. -->
      <section v-if="untracked.length">
        <h2 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          No target set
        </h2>
        <div class="overflow-hidden rounded-md border">
          <div
            v-for="p in untracked"
            :key="p.residentId"
            class="bg-card flex min-h-12 items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
          >
            <NuxtLink
              :to="`/residents/${p.residentId}?s=service`"
              class="text-sm underline-offset-2 hover:underline"
            >
              {{ p.residentName }}
            </NuxtLink>
            <span class="text-muted-foreground text-xs">
              {{ p.programName ?? 'No program' }}
              <template v-if="p.verifiedMinutes">
                · {{ hours(p.verifiedMinutes) }} logged
              </template>
            </span>
          </div>
        </div>
        <p class="text-muted-foreground mt-2 text-xs">
          Their phase carries no default and no figure is set for the stay, so nothing is
          owed and no progress is tracked.
          <template v-if="canManage">Set one from the resident's record.</template>
        </p>
      </section>
    </div>
  </AppPage>
</template>
