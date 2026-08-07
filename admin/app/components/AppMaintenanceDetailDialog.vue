<script setup>
import { facilityDateOf, formatFacilityTime } from '~/utils/facilityTime.js'
import { toneClass } from '~/utils/schedule.js'
import { STAFF_ROLE } from '~/utils/roles.js'
import {
  ageLabel,
  eventLabel,
  isOpen,
  ownerLabel,
  priorityDisplay,
  requestStateDisplay,
} from '~/utils/maintenance.js'

/**
 * One request, opened by clicking its row.
 *
 * This exists because the queue could not be opened (2026-08-07). Every action
 * lived behind a ghost ellipsis, so "Edit…" was unfindable — and the table has
 * nowhere to put the two things that most need reading: the **description**,
 * which it never showed at all, and the **trail**, which it reduced to
 * "3 entries". A row you can open is where both belong.
 *
 * VIEW AND EDIT ARE ONE MODAL IN TWO MODES, not two stacked dialogs. CLAUDE.md's
 * rule from the roll sheet — "two stacked modals is never the answer" — and it
 * also means there is exactly one edit form for a request rather than a second
 * one that can drift from this.
 *
 * Everything needing a NOTE (resolve, cancel, reopen) or its own picker
 * (assign) is EMITTED instead, so the parent closes this first and opens that.
 * Same reasoning: never stack.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  request: { type: Object, default: null },
  /** Open straight into the form — the menu's "Edit…" entry. */
  startInEdit: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update:open',
  'done',
  'close-request',
  'reopen-request',
  'assign-request',
])

const { editRequest } = useMaintenance()
const { listApartments } = useApartments()
const { user } = useAuth()
const notify = useNotify()

// Closing and reopening are manager acts; editing and assigning are not.
// Presentation only — the API refuses either way.
const canManage = computed(() =>
  [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

const mode = ref('view')
const apartments = ref([])
const form = reactive({ title: '', description: '', apartmentId: '' })
const pending = ref(false)
const error = ref('')

const r = computed(() => props.request)
const editable = computed(() => isOpen(r.value))

watch(
  () => props.open,
  async (v) => {
    if (!v || !r.value) return
    mode.value = props.startInEdit && editable.value ? 'edit' : 'view'
    error.value = ''
    reset()
    if (!apartments.value.length) apartments.value = await listApartments()
  },
)

function reset() {
  form.title = r.value?.title ?? ''
  form.description = r.value?.description ?? ''
  form.apartmentId = r.value?.apartmentId ?? ''
}

function startEditing() {
  reset()
  error.value = ''
  mode.value = 'edit'
}

async function save() {
  if (!form.title.trim()) {
    error.value = 'Say what is wrong.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await editRequest(r.value.id, {
      title: form.title.trim(),
      description: form.description.trim() || null,
      apartmentId: form.apartmentId,
    })
    notify.success('Request updated')
    mode.value = 'view'
    emit('done')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not update the request.'
  } finally {
    pending.value = false
  }
}

/** Hand off to the parent, which closes this before opening the next. */
function handOff(event, payload) {
  emit('update:open', false)
  emit(event, payload)
}

const moved = computed(() => form.apartmentId && form.apartmentId !== r.value?.apartmentId)
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent v-if="r" class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle class="pe-9">{{ mode === 'edit' ? 'Edit request' : r.title }}</DialogTitle>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <!-- ── View ────────────────────────────────────────────────────────── -->
      <div v-if="mode === 'view'" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            :class="['text-[10px] tracking-wider uppercase', toneClass(priorityDisplay(r.priority).tone)]"
          >
            {{ priorityDisplay(r.priority).label }}
          </Badge>
          <Badge
            variant="outline"
            :class="['text-[10px] tracking-wider uppercase', toneClass(requestStateDisplay(r).tone)]"
          >
            {{ requestStateDisplay(r).label }}
          </Badge>
          <span class="text-muted-foreground text-xs">{{ r.apartmentName }}</span>
        </div>

        <p v-if="r.description" class="max-w-[60ch] text-sm">{{ r.description }}</p>
        <p v-else class="text-muted-foreground text-sm italic">No details were written down.</p>

        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div>
            <dt class="text-muted-foreground text-[11px] tracking-wider uppercase">Reported</dt>
            <dd class="tabular-nums">
              {{ facilityDateOf(r.reportedAt) }}
              <span class="text-muted-foreground">
                by {{ r.reportedBy?.fullName ?? 'unknown' }}
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-[11px] tracking-wider uppercase">Age</dt>
            <dd class="tabular-nums">
              {{ ageLabel(r.reportedAt) }} old
              <span v-if="r.dueAt" class="text-muted-foreground">
                · due {{ facilityDateOf(r.dueAt) }} {{ formatFacilityTime(r.dueAt) }}
              </span>
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="text-muted-foreground text-[11px] tracking-wider uppercase">Owner</dt>
            <dd>{{ ownerLabel(r) ?? 'Nobody yet' }}</dd>
          </div>
        </dl>

        <!-- The trail in full. The table can only say "3 entries", and this is
             the one place a reopening reads as the story it is. -->
        <div v-if="r.events?.length" class="flex flex-col gap-1.5">
          <p class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            History
          </p>
          <div class="flex flex-col gap-2 border-l-2 pl-3">
            <div v-for="e in r.events" :key="e.id" class="text-[13px]">
              <p>
                <span class="font-medium">{{ eventLabel(e) }}</span>
                <span class="text-muted-foreground">
                  by {{ e.actor?.fullName ?? 'unknown' }} ·
                  <span class="tabular-nums">{{ facilityDateOf(e.at) }}</span>
                </span>
              </p>
              <p class="text-muted-foreground">{{ e.note }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Edit ────────────────────────────────────────────────────────── -->
      <form v-else class="flex flex-col gap-4" @submit.prevent="save">
        <AppField v-slot="{ id }" label="What is wrong">
          <Input :id="id" v-model="form.title" />
        </AppField>

        <AppField v-slot="{ id }" label="Details" description="Optional.">
          <Textarea :id="id" v-model="form.description" :rows="3" />
        </AppField>

        <AppField
          v-slot="{ id }"
          label="Apartment"
          description="Only for a request filed against the wrong unit — it moves out of one apartment's history and into another's."
        >
          <Select :id="id" v-model="form.apartmentId">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="a in apartments" :key="a.id" :value="a.id">{{ a.name }}</SelectItem>
            </SelectContent>
          </Select>
        </AppField>

        <p v-if="moved" class="text-warning text-[12.5px]">
          This will move the request off {{ r.apartmentName }}.
        </p>
      </form>

      <DialogFooter class="gap-2 sm:justify-between">
        <template v-if="mode === 'view'">
          <div class="flex flex-wrap gap-2">
            <!-- Editing is all-staff and only while open; the server refuses a
                 closed one, so the button is absent rather than a trap. -->
            <Button v-if="editable" size="sm" variant="outline" @click="startEditing()">Edit</Button>
            <Button
              v-if="editable"
              size="sm"
              variant="outline"
              @click="handOff('assign-request', r)"
            >
              Assign
            </Button>
          </div>
          <div class="flex flex-wrap gap-2">
            <template v-if="editable && canManage">
              <Button
                size="sm"
                variant="ghost"
                @click="handOff('close-request', { request: r, status: 'CANCELLED' })"
              >
                Cancel request
              </Button>
              <Button
                size="sm"
                @click="handOff('close-request', { request: r, status: 'RESOLVED' })"
              >
                Resolve
              </Button>
            </template>
            <Button
              v-else-if="!editable && canManage"
              size="sm"
              @click="handOff('reopen-request', r)"
            >
              Reopen
            </Button>
          </div>
        </template>

        <template v-else>
          <span />
          <div class="flex gap-2">
            <Button type="button" size="sm" variant="ghost" @click="mode = 'view'">Back</Button>
            <Button type="button" size="sm" :disabled="pending" @click="save()">Save</Button>
          </div>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
