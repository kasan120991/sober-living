<script setup>
// Maintenance, house-wide. ALL STAFF — a tech who finds a broken latch during
// an apartment check files it here, which is why this page and not
// /apartments/:id is where the bell now points.
//
// ── ONE WORK QUEUE (variant C, chosen by Kasan 2026-08-07 from three rendered
// variants). The other two were overdue-first bands and a group-per-apartment
// list, and both lost on the same axis: this is a reference view that gets
// sorted and filtered, not a queue with one urgent act at the top the way
// /service and /billing have. There is no single button to press here — the
// work is picking the right row — so promoting a band would be choosing for
// the reader.
//
// What that costs, accepted knowingly: urgency is a chip in a column rather
// than a position on the page, so it can be skimmed past. Two things pay for
// it — the destructive inset on an overdue row, which is the page's only
// inset, and the figures above, where the overdue count is the one number in
// destructive. If the house ever outgrows a screenful, the fallback is variant
// A's bands; the figures row carries over unchanged.
import { Plus } from '@lucide/vue'
import { facilityDateOf } from '~/utils/facilityTime.js'
import { toneClass } from '~/utils/schedule.js'
import {
  ageLabel,
  isOpen,
  ownerLabel,
  priorityDisplay,
  requestStateDisplay,
} from '~/utils/maintenance.js'

const { houseMaintenance } = useMaintenance()
const { listApartments } = useApartments()

// Reka's Select reserves the empty string for "selection cleared".
const ALL = 'all'

const data = ref(null)
const apartments = ref([])
const pending = ref(true)
const filter = ref('open')
const apartmentId = ref(ALL)
const fileOpen = ref(false)

async function load() {
  // First load only — a realtime refresh must not blank the queue it updates.
  pending.value = !data.value
  data.value = await houseMaintenance()
  pending.value = false
}
apartments.value = await listApartments()
await load()
onRealtimeChanged(load)

const figures = computed(() => data.value?.figures ?? {})

// Filtering is CLIENT-SIDE over the one composed read, deliberately. The
// figures above count the whole house, and a server round-trip per chip would
// let a count and its rows disagree for as long as the request took.
//
// No clock tick: a request crosses into overdue at 24 hours at the soonest, so
// the next page load is soon enough. The census ticks because presence changes
// within the hour — do not add a timer here by analogy with it.
const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'closed', label: 'Closed' },
  { key: ALL, label: 'All' },
]

const rows = computed(() => {
  const all = data.value?.requests ?? []
  const byApartment =
    apartmentId.value === ALL ? all : all.filter((r) => r.apartmentId === apartmentId.value)
  if (filter.value === ALL) return byApartment
  if (filter.value === 'open') return byApartment.filter(isOpen)
  if (filter.value === 'overdue') return byApartment.filter((r) => r.state === 'OVERDUE')
  if (filter.value === 'inProgress')
    return byApartment.filter((r) => r.status === 'IN_PROGRESS')
  return byApartment.filter((r) => !isOpen(r))
})

/**
 * "2 days / 24h" — the age beside the target it is being judged against.
 *
 * A one-day target reads "24h", not "1d": the facility says "urgent is a
 * twenty-four hour job", and "1d" beside an age of "3 hours" invites reading
 * it as a date rather than a budget.
 */
function targetLabel(r) {
  const ms = data.value?.targetMs?.[r.priority]
  if (!ms) return ''
  const days = ms / 86_400_000
  return days <= 1 ? `${Math.round(ms / 3_600_000)}h` : `${days}d`
}

// One dialog each for the whole table, driven by a row ref.
const active = ref(null)
const closeOpen = ref(false)
const closeMode = ref('RESOLVED')
const reopenOpen = ref(false)
const detailOpen = ref(false)
const detailEditing = ref(false)
const assignOpen = ref(false)

function openClose({ request, status }) {
  active.value = request
  closeMode.value = status
  closeOpen.value = true
}
function openReopen(request) {
  active.value = request
  reopenOpen.value = true
}
/**
 * Refetch, then re-point `active` at the row that came back.
 *
 * The detail modal stays OPEN after a save, and `active` holds the object it
 * was given — which `load()` replaces wholesale. Without this the modal would
 * sit there showing the title you just changed away from.
 */
async function reloadAndSync() {
  await load()
  if (!active.value) return
  const fresh = (data.value?.requests ?? []).find((x) => x.id === active.value.id)
  if (fresh) active.value = fresh
}

/** Clicking the row, or "Open…" — the detail modal in view mode. */
function openDetail(request, editing = false) {
  active.value = request
  detailEditing.value = editing
  detailOpen.value = true
}
/** "Edit…" is the same modal, opened straight into its form. */
const openEdit = (request) => openDetail(request, true)

function openAssign(request) {
  active.value = request
  assignOpen.value = true
}

const COLUMNS = [
  { key: 'priority', label: 'Priority' },
  { key: 'title', label: 'Request' },
  { key: 'apartment', label: 'Apartment' },
  { key: 'age', label: 'Age', align: 'right' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  // An object with a key, never '' in a string array — an empty header is
  // falsy and filter(Boolean) silently drops the actions column, leaving the
  // empty-state colspan off by one.
  { key: 'actions', label: '' },
]
</script>

<template>
  <AppPage title="Maintenance">
    <template #description>
      <template v-if="figures.open">
        <span class="tabular-nums">{{ figures.open }}</span> open<template v-if="figures.overdue">
          · <span class="text-destructive tabular-nums">{{ figures.overdue }}</span> overdue</template
        ><template v-if="figures.inProgress">
          · <span class="tabular-nums">{{ figures.inProgress }}</span> in progress</template
        >
      </template>
      <template v-else>Nothing outstanding across the facility.</template>
    </template>

    <template #actions>
      <Button size="sm" @click="fileOpen = true">
        <Plus class="size-4" /> File request
      </Button>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-4">
      <!-- No figure cards. They were built from the variant C mock and then
           dropped again on request (2026-08-07): the description line already
           states open / overdue / in progress, and four cards restating it
           pushed the queue itself below the fold on a laptop. The one figure
           the cards added, `closedThisMonth`, is still on the wire — a filter
           chip reaches the same rows, and a card that only ever says "3" is
           not worth a quarter of the screen above a work queue. -->
      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-for="f in FILTERS"
          :key="f.key"
          :variant="filter === f.key ? 'default' : 'outline'"
          size="sm"
          class="rounded-full"
          @click="filter = f.key"
        >
          {{ f.label }}
        </Button>

        <Select v-model="apartmentId">
          <SelectTrigger class="ms-auto w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">All apartments</SelectItem>
            <SelectItem v-for="a in apartments" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Wide content scrolls inside its own container; the page never
           scrolls sideways. -->
      <div class="overflow-hidden rounded-md border">
        <Table class="text-[13.5px]">
          <TableHeader>
            <TableRow class="bg-muted/40">
              <TableHead
                v-for="c in COLUMNS"
                :key="c.key"
                class="h-9"
                :class="c.align === 'right' ? 'text-right' : 'text-left'"
              >
                {{ c.label }}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!rows.length">
              <TableCell :colspan="COLUMNS.length" class="text-muted-foreground">
                Nothing here.
              </TableCell>
            </TableRow>
            <TableRow
              v-for="r in rows"
              :key="r.id"
              class="bg-card"
              :class="!isOpen(r) && 'opacity-70'"
            >
              <!-- The page's ONLY inset, so it means something. -->
              <TableCell
                class="whitespace-nowrap"
                :class="r.state === 'OVERDUE' && 'shadow-[inset_3px_0_0_var(--destructive)]'"
              >
                <Badge
                  v-if="priorityDisplay(r.priority).tone !== 'none'"
                  variant="outline"
                  :class="['text-[10px] tracking-wider uppercase', toneClass(priorityDisplay(r.priority).tone)]"
                >
                  {{ priorityDisplay(r.priority).label }}
                </Badge>
                <span v-else class="text-muted-foreground text-xs">
                  {{ priorityDisplay(r.priority).label }}
                </span>
              </TableCell>

              <!-- The title OPENS the request. A row you cannot open is what
                   buried Edit in an ellipsis nobody found, and the table has
                   nowhere to show a description or a trail anyway. -->
              <TableCell>
                <button
                  type="button"
                  class="text-start font-medium underline-offset-2 hover:underline"
                  @click="openDetail(r)"
                >
                  {{ r.title }}
                </button>
                <span
                  v-if="r.events?.length"
                  class="text-muted-foreground ms-2 text-[11px] whitespace-nowrap"
                >
                  {{ r.events.length }} {{ r.events.length === 1 ? 'entry' : 'entries' }}
                </span>
              </TableCell>

              <TableCell class="text-muted-foreground whitespace-nowrap">
                {{ r.apartmentName ?? '—' }}
              </TableCell>

              <!-- Age against the target it is judged by. The bare age would
                   make a 10-day NORMAL and a 10-day LOW look identical when
                   one is late and the other has three weeks left. -->
              <TableCell class="text-right tabular-nums whitespace-nowrap">
                {{ ageLabel(r.reportedAt) }}
                <span v-if="isOpen(r)" class="text-muted-foreground">/ {{ targetLabel(r) }}</span>
              </TableCell>

              <TableCell class="text-muted-foreground whitespace-nowrap">
                {{ ownerLabel(r) ?? '—' }}
              </TableCell>

              <TableCell class="whitespace-nowrap">
                <Badge
                  variant="outline"
                  :class="['text-[10px] tracking-wider uppercase', toneClass(requestStateDisplay(r).tone)]"
                >
                  {{ requestStateDisplay(r).label }}
                </Badge>
              </TableCell>

              <TableCell class="text-right">
                <AppMaintenanceActions
                  :request="r"
                  @changed="load"
                  @close-request="openClose"
                  @reopen-request="openReopen"
                  @edit-request="openEdit"
                  @assign-request="openAssign"
                  @view-request="openDetail"
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p class="text-muted-foreground text-[12.5px]">
        Urgent is due in 24 hours, normal in 7 days, low in 30. A request past its own
        target reads Overdue here, in the bell and on the dashboard — one rule, derived
        on read.
      </p>
    </div>

    <!-- ONE of each dialog for the whole table, driven by a row ref — never
         one per row. The AppBedTable rule. -->
    <AppMaintenanceRequestDialog v-model:open="fileOpen" @created="load" />
    <AppMaintenanceCloseDialog
      v-model:open="closeOpen"
      :request-id="active?.id"
      :request-title="active?.title"
      :mode="closeMode"
      @done="load"
    />
    <AppMaintenanceReopenDialog
      v-model:open="reopenOpen"
      :request-id="active?.id"
      :request-title="active?.title"
      @done="load"
    />
    <!-- The detail modal hands off anything needing a note or a picker, so the
         parent closes it before opening the next — never two stacked modals. -->
    <AppMaintenanceDetailDialog
      v-model:open="detailOpen"
      :request="active"
      :start-in-edit="detailEditing"
      @done="reloadAndSync"
      @close-request="openClose"
      @reopen-request="openReopen"
      @assign-request="openAssign"
    />
    <AppMaintenanceAssignDialog v-model:open="assignOpen" :request="active" @done="load" />
  </AppPage>
</template>
