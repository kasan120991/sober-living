<script setup>
// Removing a pending charge — and the confirmation is doing real work.
//
// Nothing is deleted. `ledger_entries` refuses DELETE by trigger and by revoked
// privilege, so this posts a reversing CREDIT and BOTH rows stay forever. What
// removal buys is that the pair is no longer billable, so it never reaches the
// resident's invoice.
//
// The dialog says exactly that, because "Remove" on its own would promise
// something the database will not do, and a manager should know the charge
// remains visible on the record before they choose their wording.
import { money, categoryLabel } from '~/utils/money.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: '' },
  /** The row being removed; null while closed. */
  entry: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'removed'])

const { removeLedgerEntry } = useResidents()
const notify = useNotify()

const reason = ref('')
const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    reason.value = ''
    error.value = ''
  },
)

async function submit() {
  if (!reason.value.trim()) {
    error.value = 'A removal needs a reason.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    await removeLedgerEntry(props.residentId, props.entry.id, reason.value.trim())
    notify.success('Charge removed')
    emit('update:open', false)
    emit('removed')
  } catch (err) {
    error.value = err?.data?.error ?? 'The charge could not be removed.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Remove this charge?</DialogTitle>
        <DialogDescription v-if="entry">
          {{ entry.description }}
          <span v-if="entry.category">· {{ categoryLabel(entry.category) }}</span>
          · {{ money(entry.amountCents) }}
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <AppField label="Reason" required>
        <template #default="{ id }">
          <Input
            :id="id"
            v-model="reason"
            placeholder="Posted against the wrong resident"
            maxlength="300"
            @keyup.enter="submit"
          />
        </template>
      </AppField>

      <!-- Said plainly, because the word "Remove" over-promises: the row does
           not go away, and a manager writing the reason should know it will be
           read later. -->
      <p class="text-muted-foreground text-xs">
        The charge and its reversal both stay on the ledger permanently — nothing here is
        ever deleted. What changes is that neither is billable, so the pair will not appear
        on any invoice.
      </p>

      <DialogFooter>
        <Button variant="outline" :disabled="pending" @click="emit('update:open', false)">
          Cancel
        </Button>
        <Button variant="destructive" :disabled="pending || !reason.trim()" @click="submit">
          {{ pending ? 'Removing…' : 'Remove charge' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
