<script setup>
// The resident's answer: send it to the lab, or don't.
//
// The dialog quotes the fee from the SERVER's `feeCents`, never a hardcoded
// 5000 — that is how a dialog comes to promise a figure the ledger disagrees
// with. And it says out loud that the resident is charged, because a staff
// member is about to put money on somebody's balance on their behalf.
//
// Declining is a full-width, equal-weight action, not a cancel link: "he was
// offered confirmation and declined" is a record this module exists to
// produce, and burying it would make the easy path the one that records
// nothing.
import { money } from '~/utils/money.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  screen: { type: Object, default: null },
  feeCents: { type: Number, default: 0 },
})
const emit = defineEmits(['update:open', 'decided'])

const { recordDecision } = useScreens()
const notify = useNotify()

const labName = ref('')
const labReference = ref('')
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    error.value = ''
    labName.value = ''
    labReference.value = ''
  },
)

async function decide(decision) {
  pending.value = true
  error.value = ''
  try {
    await recordDecision(props.screen.id, {
      decision,
      labName: decision === 'REQUESTED' ? labName.value.trim() : undefined,
      labReference: decision === 'REQUESTED' ? labReference.value.trim() || undefined : undefined,
    })
    notify.success(decision === 'REQUESTED' ? 'Sent for confirmation' : 'Decision recorded')
    emit('update:open', false)
    emit('decided')
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not record the decision.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Confirmation — {{ screen?.resident.fullName }}</DialogTitle>
        <DialogDescription>
          They choose whether this specimen goes to a lab. Either answer is recorded.
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-3">
        <AppField
          v-slot="{ id }"
          label="Lab"
          :description="`Required to send. The resident is charged ${money(feeCents)}.`"
        >
          <Input :id="id" v-model="labName" maxlength="120" placeholder="e.g. Quest Diagnostics" />
        </AppField>
        <AppField v-slot="{ id }" label="Lab reference" description="Optional.">
          <Input :id="id" v-model="labReference" maxlength="80" />
        </AppField>
      </div>

      <DialogFooter class="flex-col gap-2 sm:flex-col">
        <Button class="w-full" :disabled="pending || !labName.trim()" @click="decide('REQUESTED')">
          Send to the lab · charge {{ money(feeCents) }}
        </Button>
        <Button variant="outline" class="w-full" :disabled="pending" @click="decide('DECLINED')">
          They declined confirmation
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
