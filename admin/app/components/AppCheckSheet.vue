<script setup>
// Recording one apartment's hourly check.
//
// The other hallway sheet, built like AppRollSheet: a tech is standing in the
// doorway with a phone, and every decision here is about taps.
//
//   - One tap marks somebody present; the note chips make the required note
//     one more tap for the common cases and free text for the rest.
//   - Signed-out residents are pre-accounted and get no buttons — the
//     sign-out is what accounts for them, and a control that can only agree
//     with it is a tap wasted.
//   - One request saves the whole check.
//
// Amend mode (`amendId` set) reloads the original check's own lines instead
// of the live roster: the visit already happened, and an amendment describes
// that visit — the server refuses a different set of residents.
import { Check } from '@lucide/vue'
import { formatFacilityTime } from '~/utils/facilityTime.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** `{ id, name }` — record mode's subject. */
  apartment: { type: Object, default: null },
  /** A check id to amend instead of recording fresh. */
  amendId: { type: String, default: null },
})
const emit = defineEmits(['update:open', 'saved'])

const { getRoster, getCheck, recordCheck, amendCheck } = useChecks()
const notify = useNotify()

/** Quick notes for the common answers. Chips FILL the field, free text edits. */
const NOTE_CHIPS = ['Sleeping', 'In room', 'Common area', 'Cooking', 'Watching TV']

const roster = ref(null) // record mode: { apartment, people }
const original = ref(null) // amend mode: the check being corrected
const marks = reactive({}) // stayId → PRESENT | SIGNED_OUT | NOT_FOUND
const notes = reactive({}) // stayId → note text
const apartmentNote = ref('')
const reason = ref('')
const loading = ref(false)
const pending = ref(false)
const error = ref('')

const amending = computed(() => Boolean(props.amendId))

// Keyed on the sheet's real dependency — which apartment or which check —
// not on `open` alone. Same reasoning as AppRollSheet's watch.
watch(
  () => (props.open ? (props.amendId ?? (props.apartment ? `apt:${props.apartment.id}` : null)) : null),
  async (key) => {
    if (!key) return
    error.value = ''
    roster.value = null
    original.value = null
    apartmentNote.value = ''
    reason.value = ''
    for (const k of Object.keys(marks)) delete marks[k]
    for (const k of Object.keys(notes)) delete notes[k]
    loading.value = true
    try {
      if (props.amendId) {
        const check = await getCheck(props.amendId)
        original.value = check
        apartmentNote.value = check.note ?? ''
        for (const l of check.residents) {
          marks[l.stayId] = l.status
          if (l.note) notes[l.stayId] = l.note
        }
      } else {
        const data = await getRoster(props.apartment.id)
        roster.value = data
        // Open sign-outs pre-account their people; nothing else is presumed.
        for (const p of data.people) {
          if (p.presence.state !== 'IN') marks[p.stayId] = 'SIGNED_OUT'
        }
      }
    } catch (err) {
      error.value = err?.data?.error ?? 'Could not load this check.'
    } finally {
      loading.value = false
    }
  },
)

const people = computed(() => {
  if (amending.value) {
    return (original.value?.residents ?? []).map((l) => ({
      stayId: l.stayId,
      fullName: l.fullName,
      out: false, // amend mode: every status is editable; the server re-validates
    }))
  }
  return (roster.value?.people ?? []).map((p) => ({
    stayId: p.stayId,
    fullName: p.fullName,
    bedLabel: p.bedLabel,
    out: p.presence.state !== 'IN',
    expectedReturnAt: p.presence.expectedReturnAt ?? null,
  }))
})

const title = computed(
  () => original.value?.apartment?.name ?? roster.value?.apartment?.name ?? props.apartment?.name ?? 'Check',
)

const accountedCount = computed(
  () => people.value.filter((p) => marks[p.stayId] && !(marks[p.stayId] === 'PRESENT' && !notes[p.stayId]?.trim())).length,
)
const canSave = computed(() => {
  if (!people.value.every((p) => marks[p.stayId])) return false
  if (!people.value.every((p) => marks[p.stayId] !== 'PRESENT' || notes[p.stayId]?.trim())) return false
  if (amending.value && !reason.value.trim()) return false
  return true
})

async function submit() {
  pending.value = true
  error.value = ''
  const lines = people.value.map((p) => ({
    stayId: p.stayId,
    status: marks[p.stayId],
    note: notes[p.stayId]?.trim() || undefined,
  }))
  try {
    if (amending.value) {
      await amendCheck(props.amendId, {
        amendmentReason: reason.value.trim(),
        note: apartmentNote.value.trim(),
        lines,
      })
      notify.success('Check amended')
    } else {
      await recordCheck({
        apartmentId: props.apartment.id,
        note: apartmentNote.value.trim() || undefined,
        lines,
      })
      notify.success(`${title.value} checked`)
    }
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save the check.'
  } finally {
    pending.value = false
  }
}

/** In amend mode SIGNED_OUT joins the toggle; recording derives it instead. */
const statuses = computed(() =>
  amending.value ? ['PRESENT', 'SIGNED_OUT', 'NOT_FOUND'] : ['PRESENT', 'NOT_FOUND'],
)
const STATUS_SHORT = { PRESENT: 'Present', SIGNED_OUT: 'Out', NOT_FOUND: 'Not found' }

const toneFor = (status, active) => {
  if (!active) return 'text-muted-foreground hover:bg-accent/60'
  if (status === 'PRESENT') return 'bg-success/15 text-success font-semibold'
  if (status === 'NOT_FOUND') return 'bg-destructive/15 text-destructive font-semibold'
  return 'bg-warning/15 text-warning font-semibold'
}
</script>

<template>
  <Sheet :open="open" @update:open="(v) => emit('update:open', v)">
    <SheetContent side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
      <SheetHeader class="border-b p-4">
        <!-- pe-9 reserves the lane SheetContent's own absolute close button
             occupies — the AppRollSheet lesson. -->
        <div class="flex items-start gap-2 pe-9">
          <SheetTitle class="min-w-0 flex-1 text-[15px]">
            {{ amending ? `Amend check — ${title}` : `Check ${title}` }}
          </SheetTitle>
        </div>
        <p class="text-muted-foreground text-xs">
          <template v-if="amending && original">
            Recorded {{ formatFacilityTime(original.checkedAt) }} by {{ original.recordedBy.fullName }}.
            The original stays; this files a corrected version.
          </template>
          <template v-else-if="roster">
            <span class="tabular-nums">{{ people.length }}</span> to account for
          </template>
        </p>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Alert v-if="error" variant="destructive" class="m-4 mb-0">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <p v-if="loading" class="text-muted-foreground p-4 text-sm">Loading…</p>

        <template v-else-if="people.length">
          <div class="flex flex-col">
            <div
              v-for="p in people"
              :key="p.stayId"
              class="flex flex-col gap-2 border-b px-3 py-2.5 last:border-b-0"
            >
              <div class="flex min-h-9 items-center gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13.5px]">{{ p.fullName }}</p>
                  <p v-if="p.bedLabel" class="text-muted-foreground truncate text-[11px]">
                    Bed {{ p.bedLabel }}
                  </p>
                </div>

                <!-- Pre-accounted: the sign-out is the record, so no buttons.
                     State and time only, never a destination. -->
                <Badge
                  v-if="p.out && !amending"
                  variant="outline"
                  class="border-warning/40 bg-warning/15 text-warning-foreground shrink-0 text-[10px]"
                >
                  Out<template v-if="p.expectedReturnAt">
                    · back {{ formatFacilityTime(p.expectedReturnAt) }}</template
                  >
                </Badge>

                <div v-else class="inline-flex shrink-0 overflow-hidden rounded-md border">
                  <button
                    v-for="s in statuses"
                    :key="s"
                    type="button"
                    class="px-2.5 text-[11px] transition-colors max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
                    :class="toneFor(s, marks[p.stayId] === s)"
                    :aria-pressed="marks[p.stayId] === s"
                    :aria-label="`${STATUS_SHORT[s]} — ${p.fullName}`"
                    @click="marks[p.stayId] = s"
                  >
                    {{ STATUS_SHORT[s] }}
                  </button>
                </div>
              </div>

              <p v-if="p.out && !amending" class="text-muted-foreground text-[11px]">
                Accounted for by the sign-out.
              </p>

              <!-- The required note, one tap away. Chips fill; typing edits. -->
              <template v-if="marks[p.stayId] === 'PRESENT'">
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="chip in NOTE_CHIPS"
                    :key="chip"
                    type="button"
                    class="rounded-full border px-2.5 py-1 text-[11px] transition-colors max-md:min-h-9 pointer-coarse:min-h-9"
                    :class="
                      notes[p.stayId] === chip
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60'
                    "
                    @click="notes[p.stayId] = chip"
                  >
                    {{ chip }}
                  </button>
                </div>
                <Input
                  v-model="notes[p.stayId]"
                  placeholder="What are they doing?"
                  maxlength="280"
                  class="h-9"
                />
              </template>
              <p v-else-if="marks[p.stayId] === 'NOT_FOUND'" class="text-destructive text-[11px]">
                Stays flagged until a later check or a sign-out accounts for them.
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-2 border-t p-3">
            <AppField v-slot="{ id }" label="Apartment note" description="Optional — the unit itself, not a person.">
              <Input :id="id" v-model="apartmentNote" maxlength="500" placeholder="e.g. smoke smell in hallway" />
            </AppField>
            <AppField
              v-if="amending"
              v-slot="{ id }"
              label="Reason for the amendment"
              description="Required. The original stays on the record."
            >
              <Input :id="id" v-model="reason" maxlength="500" placeholder="What was wrong?" />
            </AppField>
          </div>
        </template>

        <p v-else-if="!loading && (roster || original)" class="text-muted-foreground p-4 text-sm">
          Nobody lives here right now. Saving records an empty check — the walk still counts.
        </p>
      </div>

      <SheetFooter v-if="!loading && (roster || original)" class="border-t p-4">
        <div class="flex w-full items-center gap-3">
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ accountedCount }} of {{ people.length }} accounted
          </span>
          <Button class="ms-auto" :disabled="pending || !canSave" @click="submit">
            <template v-if="amending">File amendment</template>
            <template v-else><Check class="size-4" /> Save check</template>
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
