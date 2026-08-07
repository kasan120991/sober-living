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
const emit = defineEmits(['changed', 'close-request', 'reopen-request'])

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
</template>
