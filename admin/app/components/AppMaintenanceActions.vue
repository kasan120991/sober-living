<script setup>
import { Ellipsis } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { isOpen, priorityDisplay } from '~/utils/maintenance.js'

/**
 * The row menu for one request.
 *
 * Actions that need no dialog — taking a job, changing a priority — are
 * performed here and reported with `changed`. Anything that needs a note is
 * EMITTED instead, so the list above renders one dialog for the whole table
 * rather than one per row (the AppBedTable rule).
 */
const props = defineProps({
  request: { type: Object, required: true },
})
const emit = defineEmits([
  'changed',
  'close-request',
  'reopen-request',
  'edit-request',
  'assign-request',
])

const { user } = useAuth()
const { startWork, setPriority } = useMaintenance()
const notify = useNotify()

const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

// Raising is all-staff, lowering is managers. Disabling rather than hiding, so
// the rule is visible to whoever cannot use it. The server refuses it either
// way — this is presentation.
const RANK = { LOW: 0, NORMAL: 1, URGENT: 2 }
const maySet = (p) => canManage.value || RANK[p] > RANK[props.request.priority]

/**
 * The one action most likely to be next, surfaced as a real button so the row
 * reads as actionable — everything behind an ellipsis made the page look like
 * it had no actions at all.
 *
 * ROLE-AWARE, because a button that always 403s is worse than no button: a tech
 * sees Start work on unowned open work and nothing on a row only a manager can
 * move. The ellipsis still carries the full set, including this one.
 */
const primary = computed(() => {
  const r = props.request
  if (isOpen(r)) {
    const owned = r.assignedTo || r.vendorName
    if (!owned) return { label: 'Start work', run: () => startWork(r.id), toast: 'You are on it' }
    if (canManage.value) return { label: 'Resolve', emit: 'close-request' }
    return null
  }
  if (canManage.value) return { label: 'Reopen', emit: 'reopen-request' }
  return null
})

function firePrimary() {
  const p = primary.value
  if (!p) return
  if (p.emit === 'close-request') return emit('close-request', { request: props.request, status: 'RESOLVED' })
  if (p.emit === 'reopen-request') return emit('reopen-request', props.request)
  return run(p.run, p.toast)
}

const busy = ref(false)
async function run(fn, message) {
  busy.value = true
  try {
    await fn()
    notify.success(message)
    emit('changed')
  } catch (err) {
    notify.error(err?.data?.error ?? 'That did not go through.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-end gap-1">
    <Button
      v-if="primary"
      size="sm"
      variant="outline"
      :disabled="busy"
      @click="firePrimary()"
    >
      {{ primary.label }}
    </Button>

  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button size="icon" variant="ghost" :disabled="busy" aria-label="Actions">
        <Ellipsis class="size-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        v-if="isOpen(request)"
        @select="run(() => startWork(request.id), 'You are on it')"
      >
        {{ request.status === 'IN_PROGRESS' ? 'Take it over' : 'Start work' }}
      </DropdownMenuItem>

      <!-- Assign and Edit are absent on a closed request: the server refuses
           both with a 409, and a menu should not offer what will fail. -->
      <DropdownMenuItem v-if="isOpen(request)" @select="emit('assign-request', request)">
        Assign…
      </DropdownMenuItem>
      <DropdownMenuItem v-if="isOpen(request)" @select="emit('edit-request', request)">
        Edit…
      </DropdownMenuItem>

      <DropdownMenuSeparator v-if="isOpen(request) && canManage" />

      <DropdownMenuItem
        v-if="isOpen(request) && canManage"
        @select="emit('close-request', { request, status: 'RESOLVED' })"
      >
        Resolve…
      </DropdownMenuItem>
      <DropdownMenuItem
        v-if="isOpen(request) && canManage"
        @select="emit('close-request', { request, status: 'CANCELLED' })"
      >
        Cancel…
      </DropdownMenuItem>
      <DropdownMenuItem
        v-if="!isOpen(request) && canManage"
        @select="emit('reopen-request', request)"
      >
        Reopen…
      </DropdownMenuItem>

      <template v-if="isOpen(request)">
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-muted-foreground text-[11px] font-normal">
          Priority
        </DropdownMenuLabel>
        <DropdownMenuItem
          v-for="p in ['URGENT', 'NORMAL', 'LOW']"
          :key="p"
          :disabled="p === request.priority || !maySet(p)"
          @select="run(() => setPriority(request.id, p), 'Priority changed')"
        >
          {{ priorityDisplay(p).label }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
  </div>
</template>
