<script setup>
import { Ellipsis, RotateCcw, Trash2, Wrench } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'

defineProps({ beds: { type: Array, default: () => [] } })
const emit = defineEmits(['changed'])

const { user } = useAuth()
const { updateBed, removeBed } = useApartments()
const notify = useNotify()

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
    notify.warning(`${oosFor.value.label} marked out of service`)
    oosFor.value = null
    emit('changed')
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not update the bed.')
  } finally {
    pending.value = false
  }
}

async function restore(bed) {
  try {
    await updateBed(bed.id, { status: 'ACTIVE' })
    notify.success(`${bed.label} back in service`)
    emit('changed')
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not update the bed.')
  }
}

async function destroy(bed) {
  try {
    await removeBed(bed.id)
    notify.success(`${bed.label} removed`)
    emit('changed')
  } catch (err) {
    // The API refuses an occupied bed. Surface its reason rather than a generic
    // failure — "move or discharge the resident first" is the actual next step.
    notify.error(err?.data?.error ?? 'Could not remove the bed.')
  }
}
</script>

<template>
  <div class="overflow-hidden rounded-md border">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              v-for="h in ['Bed', 'Status', 'Resident', '']"
              :key="h"
              class="bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider"
            >
              {{ h }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bed in beds" :key="bed.id" class="bg-card">
            <td class="h-12 border-b px-3 font-semibold">{{ bed.label }}</td>

            <!-- Out of service and available are the two states a manager hunts
                 for, so they are the two that get a chip. -->
            <td class="h-12 border-b px-3">
              <Badge v-if="bed.status === 'OUT_OF_SERVICE'" variant="outline"
                     class="border-warning/40 bg-warning/15 text-warning">
                Out of service
              </Badge>
              <span v-else-if="bed.occupied" class="text-muted-foreground">Occupied</span>
              <Badge v-else variant="outline" class="border-dashed">Available</Badge>
            </td>

            <td class="h-12 border-b px-3">
              <span v-if="bed.resident">{{ bed.resident.fullName }}</span>
              <span v-else-if="bed.outOfServiceNote" class="text-muted-foreground">
                {{ bed.outOfServiceNote }}
              </span>
              <span v-else class="text-muted-foreground/60">—</span>
            </td>

            <td class="h-12 border-b px-3 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="sm" :aria-label="`Actions for bed ${bed.label}`">
                    <Ellipsis class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem v-if="bed.status === 'OUT_OF_SERVICE'" @select="restore(bed)">
                    <RotateCcw class="size-4" /> Return to service
                  </DropdownMenuItem>
                  <DropdownMenuItem v-else @select="openOos(bed)">
                    <Wrench class="size-4" /> Mark out of service
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="isAdmin" class="text-destructive" @select="destroy(bed)">
                    <Trash2 class="size-4" /> Remove bed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>

          <tr v-if="!beds.length">
            <td colspan="4" class="bg-card text-muted-foreground px-3 py-6 text-center text-sm">
              No beds yet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <Dialog :open="Boolean(oosFor)" @update:open="(v) => !v && (oosFor = null)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Mark {{ oosFor?.label }} out of service</DialogTitle>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="confirmOos">
        <AppField
          v-slot="{ id }"
          label="Reason"
          description="What is wrong with it. This is separate from a maintenance request — file one against the apartment if work is needed."
        >
          <Textarea :id="id" v-model="note" :rows="3" placeholder="Window latch broken" />
        </AppField>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="oosFor = null">Cancel</Button>
          <Button type="submit" :disabled="pending">Mark out of service</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
