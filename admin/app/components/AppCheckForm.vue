<script setup>
// ONE check form, TWO shells — CLAUDE.md's UI rule, the AppEventForm pattern.
//
// The rows, the chips, the required-note rule and the save all live here. The
// shells supply only a heading and a footer:
//
//   - AppCheckSheet — the side drawer, for desktop, where the apartment cards
//     ARE the picker and a check is a detour from a page you keep.
//   - /checks/round/[id] — a FULL-SCREEN step, for the phone and the tablet,
//     where the check IS the screen. A drawer over a picker on a 390px phone
//     spends a third of the viewport on the thing you just left.
//
// Two copies of this markup is how the drawer comes to require a note that
// the full-screen step lets through.
import { facilityDateOf, formatFacilityTime, humanDate } from '~/utils/facilityTime.js'

const props = defineProps({
  /** `{ id, name }` — record mode's subject. */
  apartment: { type: Object, default: null },
  /** A check id to amend instead of recording fresh. */
  amendId: { type: String, default: null },
  /** Whether this instance should load. A sheet passes its `open`. */
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['saved'])

const { getRoster, getCheck, recordCheck, amendCheck } = useChecks()
const notify = useNotify()

/** Quick notes for the common answers. Chips FILL the field, free text edits. */
const NOTE_CHIPS = ['Sleeping', 'In room', 'Common area', 'Cooking', 'Watching TV']

const roster = ref(null)
const original = ref(null)
const marks = reactive({})
const notes = reactive({})
const apartmentNote = ref('')
const reason = ref('')
const loading = ref(false)
const pending = ref(false)
const error = ref('')

const amending = computed(() => Boolean(props.amendId))

// Keyed on the real dependency — which apartment or which check — never on
// `active` alone. Same reasoning as AppRollSheet's watch.
watch(
  () => (props.active ? (props.amendId ?? (props.apartment ? `apt:${props.apartment.id}` : null)) : null),
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
        // Open sign-outs and travel passes pre-account their people; nothing
        // else is presumed. WHICH status matters — the server refuses
        // SIGNED_OUT for somebody away on a pass with a 409, and a sheet that
        // could only ever send SIGNED_OUT made the round unsavable while
        // anybody was away. `!== 'IN'` was the whole bug: two different facts
        // both satisfy "not in the building".
        for (const p of data.people) {
          const s = p.presence.state
          if (s === 'ON_PASS' || s === 'PASS_OVERDUE') marks[p.stayId] = 'ON_PASS'
          else if (s !== 'IN') marks[p.stayId] = 'SIGNED_OUT'
        }
      }
    } catch (err) {
      error.value = err?.data?.error ?? 'Could not load this check.'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const people = computed(() => {
  if (amending.value) {
    return (original.value?.residents ?? []).map((l) => ({
      stayId: l.stayId,
      fullName: l.fullName,
      out: false,
    }))
  }
  return (roster.value?.people ?? []).map((p) => {
    const onPass = p.presence.state === 'ON_PASS' || p.presence.state === 'PASS_OVERDUE'
    return {
      stayId: p.stayId,
      fullName: p.fullName,
      bedLabel: p.bedLabel,
      // Pre-accounted either way, which is what removes the buttons…
      out: p.presence.state !== 'IN',
      // …but the row has to say WHICH, or it tells a tech that a resident away
      // for the weekend has signed out for the afternoon.
      onPass,
      expectedReturnAt: p.presence.expectedReturnAt ?? null,
      returnBy: p.presence.returnBy ?? null,
    }
  })
})

const title = computed(
  () => original.value?.apartment?.name ?? roster.value?.apartment?.name ?? props.apartment?.name ?? 'Check',
)
const ready = computed(() => Boolean(roster.value || original.value))

const accountedCount = computed(
  () =>
    people.value.filter(
      (p) => marks[p.stayId] && !(marks[p.stayId] === 'PRESENT' && !notes[p.stayId]?.trim()),
    ).length,
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
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save the check.'
  } finally {
    pending.value = false
  }
}

/** In amend mode the derived statuses join the toggle; recording derives them. */
const statuses = computed(() =>
  amending.value ? ['PRESENT', 'SIGNED_OUT', 'ON_PASS', 'NOT_FOUND'] : ['PRESENT', 'NOT_FOUND'],
)
const STATUS_SHORT = { PRESENT: 'Present', SIGNED_OUT: 'Out', ON_PASS: 'On pass', NOT_FOUND: 'Not found' }

const toneFor = (status, active) => {
  if (!active) return 'text-muted-foreground hover:bg-accent/60'
  if (status === 'PRESENT') return 'bg-success/15 text-success font-semibold'
  if (status === 'NOT_FOUND') return 'bg-destructive/15 text-destructive font-semibold'
  return 'bg-warning/15 text-warning font-semibold'
}

// The shells drive the footer, so they need the form's state and its save.
defineExpose({ submit, canSave, accountedCount, people, ready, loading, pending, title, amending })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <Alert v-if="error" variant="destructive" class="m-4 mb-0">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <p v-if="loading" class="text-muted-foreground p-4 text-sm">Loading…</p>

    <template v-else-if="people.length">
      <div class="flex flex-col gap-2 p-3">
        <div
          v-for="p in people"
          :key="p.stayId"
          class="bg-card flex flex-col gap-2 rounded-lg border px-3 py-2.5"
          :class="p.out && !amending && 'opacity-70'"
        >
          <div class="flex min-h-9 items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-[14px] font-medium">{{ p.fullName }}</p>
              <p v-if="p.bedLabel" class="text-muted-foreground truncate text-[11px]">
                Bed {{ p.bedLabel }}
              </p>
            </div>

            <!-- Pre-accounted: the sign-out or the pass IS the record, so no
                 buttons. State and time only, never a destination — this sheet
                 is held up in a hallway. A pass carries a DATE, because it
                 spans days and a clock time would read as today. -->
            <Badge
              v-if="p.onPass && !amending"
              variant="outline"
              class="text-muted-foreground shrink-0 text-[10px]"
            >
              On pass<template v-if="p.returnBy">
                · back {{ humanDate(facilityDateOf(p.returnBy), { short: true }) }}</template
              >
            </Badge>
            <Badge
              v-else-if="p.out && !amending"
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
            Accounted for by the {{ p.onPass ? 'travel pass' : 'sign-out' }}.
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

    <p v-else-if="ready" class="text-muted-foreground p-4 text-sm">
      Nobody lives here right now. Saving records an empty check — the walk still counts.
    </p>
  </div>
</template>
