<script setup>
// What the lab reported.
//
// A lab speaks a SUBSET of the vocabulary: negative, positive or dilute. It
// cannot report a refusal — that is a fact about the person, recorded at
// collection — and it is never "not read", which means something else again.
//
// Recording a lab-negative on a paid confirmation moves NO money. It flags the
// screen for a manager to decide on a credit, case by case, because how much
// to refund is a facility judgement and not something the app should make.
import { humanEnum, SCREEN_RESULT, SUBSTANCES } from '~/utils/screens.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  screen: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'recorded'])

const { recordLabResult } = useScreens()
const notify = useNotify()

const LAB_RESULTS = [SCREEN_RESULT.NEGATIVE, SCREEN_RESULT.POSITIVE, SCREEN_RESULT.DILUTE]

const labResult = ref('')
const labSubstances = ref([])
const labReference = ref('')
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    labResult.value = ''
    labSubstances.value = []
    labReference.value = props.screen?.labReference ?? ''
  },
)

const isPositive = computed(() => labResult.value === SCREEN_RESULT.POSITIVE)
watch(isPositive, (v) => {
  if (!v) labSubstances.value = []
})

function toggle(s) {
  labSubstances.value = labSubstances.value.includes(s)
    ? labSubstances.value.filter((x) => x !== s)
    : [...labSubstances.value, s]
}

const canSave = computed(
  () => labResult.value && (!isPositive.value || labSubstances.value.length > 0),
)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    await recordLabResult(props.screen.id, {
      labResult: labResult.value,
      labSubstances: labSubstances.value.length ? labSubstances.value : undefined,
      labReference: labReference.value.trim() || undefined,
    })
    notify.success('Lab result recorded')
    emit('update:open', false)
    emit('recorded')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not record the lab result.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Lab result — {{ screen?.resident.fullName }}</DialogTitle>
        <DialogDescription>
          {{ screen?.labName }}<template v-if="screen?.labReference"> · {{ screen.labReference }}</template>.
          The cup's own result stays on the record either way.
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-3">
        <AppField label="What the lab reported">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="r in LAB_RESULTS"
              :key="r"
              type="button"
              class="rounded-md border px-3 text-[13px] transition-colors max-md:min-h-11 pointer-coarse:min-h-11 min-h-9"
              :class="labResult === r ? 'border-primary bg-primary/10 font-semibold' : 'text-muted-foreground hover:bg-accent/60'"
              @click="labResult = r"
            >
              {{ humanEnum(r) }}
            </button>
          </div>
        </AppField>

        <AppField v-if="isPositive" label="Confirmed substances">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="s in SUBSTANCES"
              :key="s"
              type="button"
              class="rounded-full border px-2.5 py-1 text-[11px] transition-colors max-md:min-h-9 pointer-coarse:min-h-9"
              :class="labSubstances.includes(s) ? 'border-destructive/40 bg-destructive/10 text-foreground' : 'text-muted-foreground hover:bg-accent/60'"
              @click="toggle(s)"
            >
              {{ humanEnum(s) }}
            </button>
          </div>
        </AppField>

        <AppField v-slot="{ id }" label="Lab reference" description="Optional.">
          <Input :id="id" v-model="labReference" maxlength="80" />
        </AppField>

        <p class="text-muted-foreground text-xs">
          If the lab clears a resident who paid, this flags it for review — no credit is posted
          automatically.
        </p>
      </div>

      <DialogFooter>
        <Button :disabled="pending || !canSave" @click="submit">Record result</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
