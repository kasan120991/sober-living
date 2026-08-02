<script setup>
import { STAFF_ROLE } from '~/utils/roles.js'

const props = defineProps({
  beds: { type: Array, default: () => [] },
})
const emit = defineEmits(['changed'])

const { user } = useAuth()
const { updateBed, removeBed } = useApartments()
const toast = useToast()

const isAdmin = computed(() => user.value?.role === STAFF_ROLE.ADMIN)

// Out-of-service needs a reason, so it goes through a small dialog rather than
// a bare toggle. Returning a bed to service does not.
const oosFor = ref(null)
const note = ref('')
const pending = ref(false)

function openOos(bed) {
  oosFor.value = bed
  note.value = bed.outOfServiceNote ?? ''
}

async function confirmOos() {
  pending.value = true
  try {
    await updateBed(oosFor.value.id, {
      status: 'OUT_OF_SERVICE',
      outOfServiceNote: note.value.trim() || null,
    })
    toast.add({ title: `${oosFor.value.label} marked out of service`, color: 'warning' })
    oosFor.value = null
    emit('changed')
  } catch (err) {
    toast.add({ title: err?.data?.error ?? 'Could not update the bed.', color: 'error' })
  } finally {
    pending.value = false
  }
}

async function restore(bed) {
  try {
    await updateBed(bed.id, { status: 'ACTIVE' })
    toast.add({ title: `${bed.label} back in service`, color: 'success' })
    emit('changed')
  } catch (err) {
    toast.add({ title: err?.data?.error ?? 'Could not update the bed.', color: 'error' })
  }
}

async function destroy(bed) {
  try {
    await removeBed(bed.id)
    toast.add({ title: `${bed.label} removed`, color: 'success' })
    emit('changed')
  } catch (err) {
    // The API refuses an occupied bed. Surface its reason rather than a generic
    // failure — "move or discharge the resident first" is the actual next step.
    toast.add({ title: err?.data?.error ?? 'Could not remove the bed.', color: 'error' })
  }
}

function actionsFor(bed) {
  const items = []
  if (bed.status === 'OUT_OF_SERVICE') {
    items.push({ label: 'Return to service', icon: 'i-lucide-rotate-ccw', onSelect: () => restore(bed) })
  } else {
    items.push({ label: 'Mark out of service', icon: 'i-lucide-wrench', onSelect: () => openOos(bed) })
  }
  if (isAdmin.value) {
    items.push({ label: 'Remove bed', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => destroy(bed) })
  }
  return [items]
}
</script>

<template>
  <div class="overflow-hidden rounded-[var(--ui-radius)] border border-[var(--color-hairline)]">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[13.5px]">
        <thead>
          <tr>
            <th
              v-for="h in ['Bed', 'Status', 'Resident', '']"
              :key="h"
              class="border-b border-[var(--color-hairline)] bg-[var(--color-elevated)] px-3 py-2 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-mute)]"
            >
              {{ h }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bed in beds" :key="bed.id" class="bg-[var(--color-elevated)]">
            <td
              class="h-12 border-b border-[var(--color-hairline-soft)] px-3 font-mono text-[12.5px] font-semibold text-[var(--color-ink)]"
            >
              {{ bed.label }}
            </td>

            <!-- design.md §4: occupied is the NORMAL state and gets no colour.
                 Most beds are full most of the time, so colouring them would
                 drown the two states a manager is actually hunting for. -->
            <td class="h-12 border-b border-[var(--color-hairline-soft)] px-3">
              <span
                v-if="bed.status === 'OUT_OF_SERVICE'"
                class="inline-flex items-center gap-1.5 rounded-full border border-[rgba(245,166,35,.35)] bg-[var(--color-warning-soft)] px-2 py-0.5 text-xs text-[var(--color-warning-deep)]"
              >
                Out of service
              </span>
              <span v-else-if="bed.occupied" class="text-[var(--color-body)]">Occupied</span>
              <span
                v-else
                class="inline-flex items-center rounded-full border border-dashed border-[var(--color-mute)] px-2 py-0.5 text-xs text-[var(--color-body)]"
              >
                Available
              </span>
            </td>

            <td class="h-12 border-b border-[var(--color-hairline-soft)] px-3">
              <span v-if="bed.resident" class="text-[var(--color-ink)]">
                {{ bed.resident.fullName }}
              </span>
              <span v-else-if="bed.outOfServiceNote" class="text-[var(--color-mute)]">
                {{ bed.outOfServiceNote }}
              </span>
              <span v-else class="text-[var(--color-faint)]">—</span>
            </td>

            <td class="h-12 border-b border-[var(--color-hairline-soft)] px-3 text-right">
              <UDropdownMenu :items="actionsFor(bed)">
                <UButton
                  icon="i-lucide-ellipsis"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="`Actions for bed ${bed.label}`"
                />
              </UDropdownMenu>
            </td>
          </tr>

          <tr v-if="!beds.length">
            <td colspan="4" class="bg-[var(--color-elevated)] px-3 py-6 text-center text-sm text-[var(--color-mute)]">
              No beds yet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <UModal
    :open="Boolean(oosFor)"
    :title="`Mark ${oosFor?.label} out of service`"
    @update:open="(v) => !v && (oosFor = null)"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="confirmOos">
        <UFormField
          label="Reason"
          name="note"
          description="What is wrong with it. This is separate from a maintenance request — file one against the apartment if work is needed."
        >
          <UTextarea v-model="note" :rows="3" class="w-full" placeholder="Window latch broken" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="oosFor = null" />
          <UButton type="submit" color="primary" :loading="pending" label="Mark out of service" />
        </div>
      </form>
    </template>
  </UModal>
</template>
