<script setup>
// ONE med pass form, TWO shells — CLAUDE.md's UI rule, the AppCheckForm and
// AppEventForm pattern.
//
//   - AppMedPassSheet — the side drawer, for desktop, where the board itself is
//     the picker and a pass is a detour from a page you keep in view.
//   - /meds/round/[stayId] — a FULL-SCREEN step, for the phone and the tablet,
//     where the pass IS the screen.
//
// Every rule lives here. Two copies of this markup is how the drawer comes to
// demand a reason that the full-screen step lets through.
//
// THIS COMPONENT IS THE ONLY PLACE A MEDICATION IS NAMED on the operational
// side of the app. The board carries counts; the drug arrives because somebody
// deliberately opened one resident's pass. There is no reveal-and-auto-hide the
// way /screens has: this is the tool for DOING the pass, and a curtain closing
// mid-hallway is friction rather than protection.
import { doseLine, medStateDisplay, needsReason, RECORDABLE } from '~/utils/meds.js'
import { toneClass } from '~/utils/schedule.js'

const props = defineProps({
  /** `{ stayId, fullName }` — whose pass this is. */
  stay: { type: Object, default: null },
  /** Whether this instance should load. A sheet passes its `open`. */
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['saved'])

const { getPass, recordDoses, listStaff } = useMeds()
const { user } = useAuth()
const notify = useNotify()

const pass = ref(null)
const staff = ref([])
const marks = reactive({})
const reasons = reactive({})
const observedById = ref(null)
const loading = ref(false)
const pending = ref(false)
const error = ref('')

/** A dose's stable address: it has no id until somebody records it. */
const keyOf = (d) => `${d.medicationId}|${d.time}`

// Keyed on WHOSE pass, never on `active` alone — AppRollSheet's watch and its
// reasoning: the refetch's real dependency is which resident is being shown.
watch(
  () => (props.active && props.stay ? props.stay.stayId : null),
  async (stayId) => {
    if (!stayId) return
    error.value = ''
    pass.value = null
    for (const k of Object.keys(marks)) delete marks[k]
    for (const k of Object.keys(reasons)) delete reasons[k]
    loading.value = true
    try {
      const [data, people] = await Promise.all([getPass(stayId), staff.value.length ? staff.value : listStaff()])
      pass.value = data
      staff.value = people
      // The person holding the phone is nearly always the one who watched, so
      // default to them — but it stays changeable, because the second staff
      // member typing it up is a real case and only one of them attests.
      observedById.value = user.value?.id ?? people[0]?.id ?? null
    } catch (err) {
      error.value = err?.data?.error ?? 'Could not load this pass.'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

/** Doses somebody can actually answer: due or already missed, never upcoming. */
const openDoses = computed(() =>
  (pass.value?.doses ?? []).filter((d) => d.state === 'DUE' || d.state === 'MISSED'),
)
/** Already recorded, shown read-only so the sheet tells the whole day's story. */
const doneDoses = computed(() => (pass.value?.doses ?? []).filter((d) => d.log))
const laterDoses = computed(() => (pass.value?.doses ?? []).filter((d) => d.state === 'UPCOMING'))

const ready = computed(() => Boolean(pass.value))
const markedCount = computed(() => openDoses.value.filter((d) => marks[keyOf(d)]).length)

const canSave = computed(() => {
  if (!observedById.value) return false
  const answered = openDoses.value.filter((d) => marks[keyOf(d)])
  if (!answered.length) return false
  // A departure from the standing instruction needs a reason. The server and
  // the database both refuse it too; this only stops the round trip.
  return answered.every((d) => !needsReason(marks[keyOf(d)]) || reasons[keyOf(d)]?.trim())
})

const toneFor = (status, active) => {
  if (!active) return 'text-muted-foreground hover:bg-accent/60'
  if (status === 'GIVEN') return 'bg-success/15 text-success font-semibold'
  if (status === 'REFUSED') return 'bg-destructive/15 text-destructive font-semibold'
  return 'bg-warning/15 text-warning font-semibold'
}

async function submit() {
  pending.value = true
  error.value = ''
  const entries = openDoses.value
    .filter((d) => marks[keyOf(d)])
    .map((d) => ({
      medicationId: d.medicationId,
      time: d.time,
      status: marks[keyOf(d)],
      note: reasons[keyOf(d)]?.trim() || undefined,
    }))
  try {
    await recordDoses({ stayId: props.stay.stayId, observedById: observedById.value, entries })
    notify.success(entries.length === 1 ? 'Dose recorded' : `${entries.length} doses recorded`)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save this pass.'
  } finally {
    pending.value = false
  }
}

defineExpose({ submit, canSave, ready, loading, pending, markedCount, openDoses, pass })

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('observedBy')
</script>

<template>
  <div class="flex min-w-0 flex-col">
    <Alert v-if="error" variant="destructive" class="m-4 mb-0">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <p v-if="loading" class="text-muted-foreground p-4 text-sm">Loading…</p>

    <template v-else-if="ready">
      <p v-if="!pass.hasActiveStay" class="text-muted-foreground p-4 text-sm">
        This resident is no longer in the programme.
      </p>

      <p v-else-if="!pass.doses.length && !pass.prn.length" class="text-muted-foreground p-4 text-sm">
        No medications are on this resident’s list.
      </p>

      <template v-else>
        <!-- ── To record ─────────────────────────────────────────────── -->
        <div v-if="openDoses.length" class="flex flex-col gap-4 p-4">
          <div v-for="d in openDoses" :key="keyOf(d)" class="flex flex-col gap-2">
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-[14px] font-medium">{{ d.medicationName }}</p>
                <p class="text-muted-foreground text-xs">{{ doseLine(d) }}</p>
              </div>
              <Badge
                variant="outline"
                class="shrink-0 border-transparent text-[10px]"
                :class="toneClass(medStateDisplay(d.state).tone)"
              >
                {{ d.label }} · {{ medStateDisplay(d.state).short }}
              </Badge>
            </div>

            <div class="inline-flex overflow-hidden rounded-md border">
              <button
                v-for="s in RECORDABLE"
                :key="s"
                type="button"
                class="min-h-9 px-3 text-[12px] transition-colors max-md:min-h-11 pointer-coarse:min-h-11"
                :class="toneFor(s, marks[keyOf(d)] === s)"
                :aria-pressed="marks[keyOf(d)] === s"
                :aria-label="`${medStateDisplay(s).short} — ${d.medicationName}`"
                @click="marks[keyOf(d)] = s"
              >
                {{ medStateDisplay(s).short }}
              </button>
            </div>

            <!-- Revealed by the answer, because only a departure needs one. -->
            <Input
              v-if="needsReason(marks[keyOf(d)])"
              v-model="reasons[keyOf(d)]"
              class="h-9"
              maxlength="280"
              :placeholder="marks[keyOf(d)] === 'REFUSED' ? 'What did they say?' : 'Why was it held?'"
              :aria-label="`Reason — ${d.medicationName}`"
            />
          </div>
        </div>

        <p v-else class="text-muted-foreground p-4 text-sm">
          Nothing is due for {{ pass.fullName }} right now.
        </p>

        <!-- ── Already recorded today ───────────────────────────────── -->
        <div v-if="doneDoses.length" class="border-t p-4">
          <p class="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
            Recorded today
          </p>
          <div v-for="d in doneDoses" :key="`done-${keyOf(d)}`" class="flex items-center gap-2 py-1.5">
            <span class="text-muted-foreground w-16 shrink-0 text-[12px] tabular-nums">{{ d.label }}</span>
            <span class="min-w-0 flex-1 truncate text-[13px]">{{ d.medicationName }}</span>
            <Badge
              variant="outline"
              class="shrink-0 border-transparent text-[10px]"
              :class="toneClass(medStateDisplay(d.log.status).tone)"
            >
              {{ medStateDisplay(d.log.status).short }}
            </Badge>
          </div>
        </div>

        <!-- ── Later today ──────────────────────────────────────────── -->
        <div v-if="laterDoses.length" class="border-t p-4">
          <p class="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
            Later today
          </p>
          <div v-for="d in laterDoses" :key="`later-${keyOf(d)}`" class="flex items-center gap-2 py-1.5">
            <span class="text-muted-foreground w-16 shrink-0 text-[12px] tabular-nums">{{ d.label }}</span>
            <span class="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">{{ d.medicationName }}</span>
          </div>
        </div>

        <!-- ── Who watched ──────────────────────────────────────────── -->
        <div v-if="openDoses.length" class="border-t p-4">
          <Field>
            <FieldLabel :for="ids.observedBy">Observed by</FieldLabel>
            <Select v-model="observedById">
              <SelectTrigger class="w-full"><SelectValue placeholder="Who watched the dose?" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="s in staff" :key="s.id" :value="s.id">{{ s.fullName }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </template>
    </template>
  </div>
</template>
