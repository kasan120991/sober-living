<script setup>
// The two refusals — DENYING a request and CANCELLING an approved pass — in one
// dialog with a `mode`, because they are the same act from two directions and
// the database says so: `pass_refusal_needs_reason` covers both statuses in one
// CHECK. Two components would be two places for the reason requirement to drift.
//
// Managers only, and the note is REQUIRED — a refusal with nothing stated is
// exactly what a resident appeals and the facility cannot defend. The route,
// the service and the CHECK all agree; this only saves the round trip.
//
// APPROVING deliberately has NO dialog: it needs nothing from the reviewer, and
// a confirm that asks for nothing is a click that teaches people to click. The
// board approves inline. These two get a dialog because they have a cost.
const props = defineProps({
  open: { type: Boolean, default: false },
  pass: { type: Object, default: null },
  /** 'deny' — refuse a request. 'cancel' — call off a pass already approved. */
  mode: { type: String, default: 'deny' },
})
const emit = defineEmits(['update:open', 'saved'])

const { reviewPass, cancelPass } = usePasses()
const notify = useNotify()

const note = ref('')
const busy = ref(false)
const error = ref('')

const copy = computed(() =>
  props.mode === 'cancel'
    ? {
        title: `Cancel ${props.pass?.fullName}’s pass`,
        blurb:
          'The pass stays on their record with the reason. Cancelling is a decision an ' +
          'auditor reads, so it cannot be undone — approve a fresh request instead.',
        placeholder: 'Court date moved to that weekend.',
        action: 'Cancel pass',
        toast: 'Pass cancelled for',
      }
    : {
        title: `Deny ${props.pass?.fullName}’s pass`,
        blurb:
          'The request stays on their record with the reason. Denying is a decision an ' +
          'auditor reads, so it cannot be undone — file a fresh request instead.',
        placeholder: 'Not eligible until 90 days in.',
        action: 'Deny pass',
        toast: 'Pass denied for',
      },
)

watch(
  () => (props.open ? props.pass?.id : null),
  (id) => {
    if (!id) return
    note.value = ''
    error.value = ''
  },
  { immediate: true },
)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    if (props.mode === 'cancel') await cancelPass(props.pass.id, { note: note.value.trim() })
    else await reviewPass(props.pass.id, { approve: false, note: note.value.trim() })
    notify.success(`${copy.value.toast} ${props.pass.fullName}`)
    emit('update:open', false)
    emit('saved')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not save that.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>{{ copy.title }}</DialogTitle>
        <DialogDescription>{{ copy.blurb }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div v-if="pass" class="bg-muted/40 rounded-md border px-3 py-2 text-xs">
          <p class="font-medium">{{ pass.destination }}</p>
          <p class="text-muted-foreground tabular-nums">{{ nightsLabel(pass.nights) }}</p>
        </div>

        <AppField
          v-slot="{ id }"
          label="Reason"
          description="Required — this is what the resident is told and what a review reads."
        >
          <Input :id="id" v-model="note" :placeholder="copy.placeholder" required />
        </AppField>

        <DialogFooter class="border-t pt-4">
          <Button type="button" variant="ghost" @click="emit('update:open', false)">
            Never mind
          </Button>
          <Button type="submit" variant="destructive" :disabled="busy || !note.trim()">
            {{ copy.action }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
