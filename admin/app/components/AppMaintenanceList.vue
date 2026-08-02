<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

defineProps({
  requests: { type: Array, default: () => [] },
  showApartment: { type: Boolean, default: false },
})
const emit = defineEmits(['changed'])

const { user } = useAuth()
const { updateRequest } = useApartments()
const notify = useNotify()

const canClose = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const OPEN_STATES = ['OPEN', 'IN_PROGRESS']
const isOpen = (r) => OPEN_STATES.includes(r.status)

const closing = ref(null)
const note = ref('')
const pending = ref(false)
const error = ref('')

async function confirmClose() {
  error.value = ''
  if (!note.value.trim()) {
    // The API refuses this too; saying so here avoids a pointless round trip.
    error.value = 'Say what was done before closing.'
    return
  }
  pending.value = true
  try {
    await updateRequest(closing.value.id, { status: 'RESOLVED', resolutionNote: note.value.trim() })
    notify.success('Request resolved')
    closing.value = null
    note.value = ''
    emit('changed')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not close the request.'
  } finally {
    pending.value = false
  }
}

const fmt = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="!requests.length" class="text-muted-foreground text-sm">No maintenance requests.</p>

    <div
      v-for="r in requests"
      :key="r.id"
      class="bg-card rounded-md border p-3"
      :class="!isOpen(r) && 'opacity-70'"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <!-- URGENT is the only coloured thing here. Normal and low priority
                 are the ordinary case and stay achromatic. -->
            <Badge v-if="r.priority === 'URGENT' && isOpen(r)" variant="destructive"
                   class="text-[10px] uppercase tracking-wider">
              Urgent
            </Badge>
            <span class="text-sm font-medium">{{ r.title }}</span>
            <span v-if="!isOpen(r)" class="text-muted-foreground text-[10px] uppercase tracking-wider">
              {{ r.status === 'RESOLVED' ? 'Resolved' : 'Cancelled' }}
            </span>
          </div>

          <p v-if="r.description" class="mt-1 max-w-[65ch] text-xs">{{ r.description }}</p>

          <p class="text-muted-foreground mt-1 text-xs">
            <template v-if="showApartment && r.apartmentName">{{ r.apartmentName }} · </template>
            Reported by {{ r.reportedBy?.fullName ?? 'unknown' }} on
            <span class="tabular-nums">{{ fmt(r.reportedAt) }}</span>
            <template v-if="r.resolvedAt">
              · Closed by {{ r.resolvedBy?.fullName }} on
              <span class="tabular-nums">{{ fmt(r.resolvedAt) }}</span>
            </template>
          </p>

          <p v-if="r.resolutionNote" class="mt-1.5 border-l-2 pl-2 text-xs">
            {{ r.resolutionNote }}
          </p>
        </div>

        <Button v-if="isOpen(r) && canClose" size="sm" variant="outline"
                @click="((closing = r), (note = ''), (error = ''))">
          Resolve
        </Button>
      </div>
    </div>
  </div>

  <Dialog :open="Boolean(closing)" @update:open="(v) => !v && (closing = null)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader><DialogTitle>Resolve request</DialogTitle></DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="confirmClose">
        <p class="text-sm">{{ closing?.title }}</p>
        <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
        <AppField
          v-slot="{ id }"
          label="What was done"
          description="Required. A request that just disappears leaves no record of what was fixed."
        >
          <Textarea :id="id" v-model="note" :rows="3" placeholder="Replaced the latch." />
        </AppField>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="closing = null">Cancel</Button>
          <Button type="submit" :disabled="pending">Resolve</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
