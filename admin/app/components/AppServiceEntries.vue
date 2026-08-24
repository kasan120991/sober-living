<script setup>
// The resident record's Community service section.
//
// Progress on top, entries underneath. Nothing here edits an entry: the table
// refuses UPDATE except for verification, so a correction opens the log dialog
// in amend mode and writes a NEW row. That is why a row's menu says "Amend"
// rather than "Edit" — the wording is the model.
import { MoreHorizontal } from '@lucide/vue'
import { STAFF_ROLE } from '~/utils/roles.js'
import { hours } from '~/utils/serviceHours.js'
import { isoDate } from '~/composables/useResidents.js'

const props = defineProps({
  residentId: { type: String, required: true },
  residentName: { type: String, default: '' },
  /** `current.service` — the summary the rail's dot is derived from. */
  service: { type: Object, default: null },
  /** False once discharged: hours still show, they just cannot be added. */
  canLog: { type: Boolean, default: false },
})
const emit = defineEmits(['changed'])

const { user } = useAuth()
const { listEntries, verifyEntry } = useServiceHours()
const notify = useNotify()

// Logging and verifying are all-staff, matching sign-outs: the person handed
// the signed slip is the one at the door. Setting the target is not.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const entries = ref([])
const pending = ref(true)
const busy = ref(null)

async function load() {
  pending.value = !entries.value.length
  entries.value = (await listEntries(props.residentId)).entries
  pending.value = false
}
await load()
onRealtimeChanged(load)

async function verify(entry) {
  busy.value = entry.id
  try {
    await verifyEntry(entry.id)
    notify.success(`${hours(entry.minutes)} verified`)
    await load()
    emit('changed')
  } catch (err) {
    notify.error(err?.data?.error ?? 'Could not verify the entry.')
  } finally {
    busy.value = null
  }
}

// One dialog per table, driven by a row ref — never one per row.
const entryOpen = ref(false)
const amending = ref(null)
const targetOpen = ref(false)

function openLog() {
  amending.value = null
  entryOpen.value = true
}
function openAmend(entry) {
  amending.value = entry
  entryOpen.value = true
}

async function onSaved() {
  await load()
  emit('changed')
}

const COLUMNS = [
  { key: 'workedOn', label: 'Date' },
  { key: 'hours', label: 'Hours' },
  { key: 'location', label: 'Location' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'verified', label: 'Verified' },
  { key: 'actions', label: '' },
]
</script>

<template>
  <div class="flex flex-col gap-5">
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Progress
        </h2>
        <div class="flex gap-2">
          <Button v-if="canManage" size="sm" variant="outline" @click="targetOpen = true">
            Set target
          </Button>
          <Button v-if="canLog" size="sm" @click="openLog">Log hours</Button>
        </div>
      </div>

      <Card>
        <AppServiceProgress :service="service" />
      </Card>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
        Hours logged
      </h2>

      <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

      <div v-else-if="entries.length" class="overflow-hidden rounded-md border">
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
            <template v-for="e in entries" :key="e.id">
              <TableRow class="bg-card">
                <TableCell class="whitespace-nowrap tabular-nums">
                  {{ isoDate(e.workedOn) }}
                </TableCell>
                <TableCell class="whitespace-nowrap tabular-nums">
                  {{ hours(e.minutes) }}
                </TableCell>
                <TableCell class="max-w-[24ch] truncate">{{ e.location }}</TableCell>
                <TableCell class="text-muted-foreground whitespace-nowrap">
                  {{ e.supervisorName ?? '—' }}
                </TableCell>
                <TableCell class="whitespace-nowrap">
                  <Badge
                    v-if="e.verifiedAt"
                    variant="outline"
                    class="border-success/40 bg-success/15 text-success text-[10px]"
                  >
                    {{ e.verifiedBy?.fullName ?? 'Verified' }}
                  </Badge>
                  <Badge v-else variant="outline" class="text-muted-foreground border-dashed text-[10px]">
                    Pending
                  </Badge>
                </TableCell>
                <TableCell class="text-right whitespace-nowrap">
                  <Button
                    v-if="!e.verifiedAt"
                    size="sm"
                    variant="outline"
                    :disabled="busy === e.id"
                    @click="verify(e)"
                  >
                    Verify
                  </Button>
                  <DropdownMenu v-if="canLog">
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="sm" :aria-label="`Actions for ${isoDate(e.workedOn)}`">
                        <MoreHorizontal class="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-52">
                      <!-- Amend, not Edit. Nothing here is editable — a
                           correction is a new row and the original stays. -->
                      <DropdownMenuItem @select="openAmend(e)">Amend this entry…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
              <!-- The predecessor, when this row is a correction. Same
                   treatment AppLedger gives a corrected line. -->
              <TableRow v-if="e.supersedes" class="bg-card">
                <TableCell colspan="6" class="text-muted-foreground pb-2 text-xs">
                  was <span class="tabular-nums">{{ hours(e.supersedes.minutes) }}</span> ·
                  amended{{ e.recordedBy ? ` by ${e.recordedBy.fullName}` : '' }} —
                  “{{ e.amendmentReason }}”
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </div>

      <p v-else class="text-muted-foreground text-sm">No hours logged yet.</p>

      <p class="text-muted-foreground text-xs">
        Only verified hours count toward the target. Nothing here is edited or deleted — a
        mistake is corrected by an amendment, and the original stays on the record.
      </p>
    </section>

    <AppServiceEntryDialog
      v-model:open="entryOpen"
      :resident-id="residentId"
      :resident-name="residentName"
      :amending="amending"
      @saved="onSaved"
    />

    <AppServiceTargetDialog
      v-model:open="targetOpen"
      :resident-id="residentId"
      :resident-name="residentName"
      :service="service"
      @saved="onSaved"
    />
  </div>
</template>
