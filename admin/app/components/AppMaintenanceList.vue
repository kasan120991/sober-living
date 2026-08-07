<script setup>
import { facilityDateOf } from '~/utils/facilityTime.js'
import { toneClass } from '~/utils/schedule.js'
import {
  ageLabel,
  eventLabel,
  isOpen,
  ownerLabel,
  priorityDisplay,
  requestStateDisplay,
} from '~/utils/maintenance.js'

/**
 * Requests as cards, for the apartment detail page.
 *
 * The house-wide queue at /maintenance is a dense table (variant C); this stays
 * cards because it sits inside a page about ONE apartment, alongside a bed
 * table, and a second table there would read as a continuation of the first.
 * Both surfaces share the same row menu and the same dialogs, so the two can
 * never disagree about what an action does.
 */
const props = defineProps({
  requests: { type: Array, default: () => [] },
  showApartment: { type: Boolean, default: false },
})
const emit = defineEmits(['changed'])

// One dialog each for the whole list, driven by a row ref.
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
function openDetail(request, editing = false) {
  active.value = request
  detailEditing.value = editing
  detailOpen.value = true
}
const openEdit = (request) => openDetail(request, true)

// The detail modal stays open after a save and holds the object it was given,
// which the parent's refetch replaces wholesale — so re-point it at whatever
// came back, or it sits there showing what you just changed away from.
watch(
  () => props.requests,
  (rows) => {
    if (!active.value) return
    const fresh = rows.find((x) => x.id === active.value.id)
    if (fresh) active.value = fresh
  },
)

function openAssign(request) {
  active.value = request
  assignOpen.value = true
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="!requests.length" class="text-muted-foreground text-sm">No maintenance requests.</p>

    <div
      v-for="r in requests"
      :key="r.id"
      class="bg-card rounded-md border p-3"
      :class="[
        !isOpen(r) && 'opacity-70',
        r.state === 'OVERDUE' && 'shadow-[inset_3px_0_0_var(--destructive)]',
      ]"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <!-- URGENT is the only coloured priority, and it is --warning, not
                 --destructive: red on this screen means past its target, and an
                 urgent request filed ten minutes ago is not late. -->
            <Badge
              v-if="r.priority === 'URGENT' && isOpen(r)"
              variant="outline"
              :class="['text-[10px] tracking-wider uppercase', toneClass(priorityDisplay(r.priority).tone)]"
            >
              Urgent
            </Badge>
            <button
              type="button"
              class="text-start text-sm font-medium underline-offset-2 hover:underline"
              @click="openDetail(r)"
            >
              {{ r.title }}
            </button>
            <Badge
              v-if="requestStateDisplay(r).tone !== 'none'"
              variant="outline"
              :class="['text-[10px] tracking-wider uppercase', toneClass(requestStateDisplay(r).tone)]"
            >
              {{ requestStateDisplay(r).label }}
            </Badge>
          </div>

          <p v-if="r.description" class="mt-1 max-w-[65ch] text-xs">{{ r.description }}</p>

          <p class="text-muted-foreground mt-1 text-xs">
            <template v-if="showApartment && r.apartmentName">{{ r.apartmentName }} · </template>
            <span class="tabular-nums">{{ ageLabel(r.reportedAt) }}</span> old
            <template v-if="r.reportedBy"> · reported by {{ r.reportedBy.fullName }}</template>
            <template v-if="ownerLabel(r)"> · {{ ownerLabel(r) }}</template>
          </p>

          <!-- The trail. Every closure survives a reopening, so a request
               closed twice shows both — which the old columns could not. -->
          <div v-if="r.events?.length" class="mt-1.5 flex flex-col gap-1 border-l-2 pl-2">
            <p v-for="e in r.events" :key="e.id" class="text-xs">
              <span class="font-medium">{{ eventLabel(e) }}</span>
              <span class="text-muted-foreground">
                by {{ e.actor?.fullName ?? 'unknown' }} ·
                <span class="tabular-nums">{{ facilityDateOf(e.at) }}</span>
              </span>
              — {{ e.note }}
            </p>
          </div>
        </div>

        <AppMaintenanceActions
          :request="r"
          @changed="emit('changed')"
          @close-request="openClose"
          @reopen-request="openReopen"
          @edit-request="openEdit"
          @assign-request="openAssign"
          @view-request="openDetail"
        />
      </div>
    </div>
  </div>

  <AppMaintenanceCloseDialog
    v-model:open="closeOpen"
    :request-id="active?.id"
    :request-title="active?.title"
    :mode="closeMode"
    @done="emit('changed')"
  />
  <AppMaintenanceReopenDialog
    v-model:open="reopenOpen"
    :request-id="active?.id"
    :request-title="active?.title"
    @done="emit('changed')"
  />
  <AppMaintenanceDetailDialog
    v-model:open="detailOpen"
    :request="active"
    :start-in-edit="detailEditing"
    @done="emit('changed')"
    @close-request="openClose"
    @reopen-request="openReopen"
    @assign-request="openAssign"
  />
  <AppMaintenanceAssignDialog v-model:open="assignOpen" :request="active" @done="emit('changed')" />
</template>
