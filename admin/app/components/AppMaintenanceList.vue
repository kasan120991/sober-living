<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

const props = defineProps({
  requests: { type: Array, default: () => [] },
  showApartment: { type: Boolean, default: false },
})
const emit = defineEmits(['changed'])

const { user } = useAuth()
const { updateRequest } = useApartments()
const toast = useToast()

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
    toast.add({ title: 'Request resolved', color: 'success', icon: 'i-lucide-check' })
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
    <p v-if="!requests.length" class="text-sm text-[var(--color-mute)]">No maintenance requests.</p>

    <div
      v-for="r in requests"
      :key="r.id"
      class="rounded-[var(--ui-radius)] border border-[var(--color-hairline)] bg-[var(--color-elevated)] p-3"
      :class="!isOpen(r) && 'opacity-70'"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <!-- URGENT is the only coloured thing here. Normal and low priority
                 are the ordinary case and stay achromatic. -->
            <span
              v-if="r.priority === 'URGENT' && isOpen(r)"
              class="rounded-full border border-[rgba(238,0,0,.25)] bg-[var(--color-error-soft)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#a30000]"
            >
              Urgent
            </span>
            <span class="text-[13.5px] font-medium text-[var(--color-ink)]">{{ r.title }}</span>
            <span
              v-if="!isOpen(r)"
              class="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-mute)]"
            >
              {{ r.status === 'RESOLVED' ? 'Resolved' : 'Cancelled' }}
            </span>
          </div>

          <p v-if="r.description" class="mt-1 max-w-[65ch] text-xs text-[var(--color-body)]">
            {{ r.description }}
          </p>

          <p class="mt-1 text-xs text-[var(--color-mute)]">
            <template v-if="showApartment && r.apartmentName">
              {{ r.apartmentName }} ·
            </template>
            Reported by {{ r.reportedBy?.fullName ?? 'unknown' }} on
            <span class="font-mono">{{ fmt(r.reportedAt) }}</span>
            <template v-if="r.resolvedAt">
              · Closed by {{ r.resolvedBy?.fullName }} on
              <span class="font-mono">{{ fmt(r.resolvedAt) }}</span>
            </template>
          </p>

          <p
            v-if="r.resolutionNote"
            class="mt-1.5 border-l-2 border-[var(--color-hairline)] pl-2 text-xs text-[var(--color-body)]"
          >
            {{ r.resolutionNote }}
          </p>
        </div>

        <UButton
          v-if="isOpen(r) && canClose"
          size="sm"
          color="neutral"
          variant="outline"
          label="Resolve"
          @click="((closing = r), (note = ''), (error = ''))"
        />
      </div>
    </div>
  </div>

  <UModal
    :open="Boolean(closing)"
    title="Resolve request"
    @update:open="(v) => !v && (closing = null)"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="confirmClose">
        <p class="text-sm text-[var(--color-body)]">{{ closing?.title }}</p>
        <UAlert v-if="error" color="error" variant="soft" :description="error" />
        <UFormField
          label="What was done"
          name="resolutionNote"
          description="Required. A request that just disappears leaves no record of what was fixed."
        >
          <UTextarea v-model="note" :rows="3" class="w-full" placeholder="Replaced the latch." />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="closing = null" />
          <UButton type="submit" color="primary" :loading="pending" label="Resolve" />
        </div>
      </form>
    </template>
  </UModal>
</template>
