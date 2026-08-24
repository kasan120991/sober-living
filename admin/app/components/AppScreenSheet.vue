<script setup>
// Recording a collection — the hallway form.
//
// AppCheckSheet's twin: a tech is standing with a cup and a specimen cup in
// the other hand. Mobile-first, 44px floors, one POST for the whole screen.
//
// The substances field only exists for a POSITIVE, because that is the only
// result that carries them — enforced in the service AND by a CHECK, so the
// form is agreeing with the database rather than deciding the rule.
import { humanEnum, SCREEN_METHODS, SCREEN_REASONS, SCREEN_RESULT, SUBSTANCES } from '~/utils/screens.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** Candidates to collect from — housed, active residents. */
  residents: { type: Array, default: () => [] },
  staff: { type: Array, default: () => [] },
  /** Preselect when opened from a resident's record. */
  residentId: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'recorded'])

const { recordScreen } = useScreens()
const notify = useNotify()

const RESULTS = [
  SCREEN_RESULT.NEGATIVE,
  SCREEN_RESULT.POSITIVE,
  SCREEN_RESULT.DILUTE,
  SCREEN_RESULT.REFUSAL,
  SCREEN_RESULT.PENDING,
]

const blank = () => ({
  residentId: props.residentId || '',
  reason: 'RANDOM',
  method: 'URINE',
  result: '',
  substances: [],
  specimenId: '',
  witnessedById: '',
  note: '',
})

const form = reactive(blank())
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    Object.assign(form, blank())
  },
)

/** A refusal produced no specimen, and a negative needs no seal number. */
const needsSpecimen = computed(
  () => form.result && ![SCREEN_RESULT.NEGATIVE, SCREEN_RESULT.REFUSAL].includes(form.result),
)
const isPositive = computed(() => form.result === SCREEN_RESULT.POSITIVE)

watch(isPositive, (v) => {
  if (!v) form.substances = []
})

function toggleSubstance(s) {
  form.substances = form.substances.includes(s)
    ? form.substances.filter((x) => x !== s)
    : [...form.substances, s]
}

const canSave = computed(
  () =>
    form.residentId &&
    form.result &&
    form.witnessedById &&
    (!isPositive.value || form.substances.length > 0) &&
    (!needsSpecimen.value || form.specimenId.trim()),
)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    await recordScreen({
      residentId: form.residentId,
      reason: form.reason,
      method: form.method,
      result: form.result,
      substances: form.substances.length ? form.substances : undefined,
      specimenId: form.specimenId.trim() || undefined,
      witnessedById: form.witnessedById,
      note: form.note.trim() || undefined,
    })
    notify.success('Screen recorded')
    emit('update:open', false)
    emit('recorded')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not record this screen.'
  } finally {
    pending.value = false
  }
}

// Ids for the Field labels below — see utils/fieldIds.js.
const ids = useFieldIds('collectionWitness', 'detected', 'note', 'reason', 'resident', 'result', 'specimenSealNumber', 'testType')
</script>

<template>
  <Sheet :open="open" @update:open="(v) => emit('update:open', v)">
    <SheetContent side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
      <SheetHeader class="border-b p-4">
        <!-- pe-9 clears SheetContent's own absolute close button. -->
        <div class="pe-9">
          <SheetTitle class="text-[15px]">Record a screen</SheetTitle>
        </div>
        <p class="text-muted-foreground text-xs">
          A non-negative asks the resident whether to send it for confirmation — that comes next,
          on the queue.
        </p>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Field>
          <FieldLabel :for="ids.resident">Resident</FieldLabel>
          <select
            :id="ids.resident"
            v-model="form.residentId"
            class="border-input bg-background w-full rounded-md border px-3 text-sm max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
          >
            <option value="">Choose…</option>
            <option v-for="r in residents" :key="r.id" :value="r.id">
              {{ r.firstName }} {{ r.lastName }}
            </option>
          </select>
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel :for="ids.reason">Reason</FieldLabel>
            <select
              :id="ids.reason"
              v-model="form.reason"
              class="border-input bg-background w-full rounded-md border px-3 text-sm max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
            >
              <option v-for="r in SCREEN_REASONS" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
          </Field>
          <Field>
            <FieldLabel :for="ids.testType">Test type</FieldLabel>
            <select
              :id="ids.testType"
              v-model="form.method"
              class="border-input bg-background w-full rounded-md border px-3 text-sm max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
            >
              <option v-for="m in SCREEN_METHODS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </Field>
        </div>

        <Field>
          <FieldLabel :for="ids.result">Result</FieldLabel>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="r in RESULTS"
              :key="r"
              type="button"
              class="rounded-md border px-3 text-[13px] transition-colors max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
              :class="form.result === r ? 'border-primary bg-primary/10 font-semibold' : 'text-muted-foreground hover:bg-accent/60'"
              @click="form.result = r"
            >
              {{ r === 'PENDING' ? 'Not read' : humanEnum(r) }}
            </button>
          </div>
          <FieldDescription>A refusal and a dilute are outcomes of their own, never a failure.</FieldDescription>
        </Field>

        <Field v-if="isPositive">
          <FieldLabel :for="ids.detected">Detected</FieldLabel>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="s in SUBSTANCES"
              :key="s"
              type="button"
              class="rounded-full border px-2.5 py-1 text-[11px] transition-colors max-md:min-h-9 pointer-coarse:min-h-9"
              :class="form.substances.includes(s) ? 'border-destructive/40 bg-destructive/10 text-foreground' : 'text-muted-foreground hover:bg-accent/60'"
              @click="toggleSubstance(s)"
            >
              {{ humanEnum(s) }}
            </button>
          </div>
          <FieldDescription>A positive names what was found.</FieldDescription>
        </Field>

        <Field v-if="needsSpecimen">
          <FieldLabel :for="ids.specimenSealNumber">Specimen / seal number</FieldLabel>
          <Input :id="ids.specimenSealNumber" v-model="form.specimenId" maxlength="60" placeholder="e.g. SL-40881" />
          <FieldDescription>What ties this to a lab report.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel :for="ids.collectionWitness">Collection witness</FieldLabel>
          <select
            :id="ids.collectionWitness"
            v-model="form.witnessedById"
            class="border-input bg-background w-full rounded-md border px-3 text-sm max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
          >
            <option value="">Choose…</option>
            <option v-for="s in staff" :key="s.id" :value="s.id">{{ s.fullName }}</option>
          </select>
          <FieldDescription>Who observed the specimen being given.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel :for="ids.note">Note</FieldLabel>
          <Input :id="ids.note" v-model="form.note" maxlength="500" />
          <FieldDescription>Optional.</FieldDescription>
        </Field>
      </div>

      <SheetFooter class="border-t p-4">
        <Button class="w-full" :disabled="pending || !canSave" @click="submit">Save screen</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
