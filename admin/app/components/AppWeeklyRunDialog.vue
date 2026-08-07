<script setup>
// The Friday run — one invoice per active stay with a positive net.
//
// This is the app's only bulk money action, and it is IRREVERSIBLE in one
// direction: every line it sweeps is billed forever, and voiding an invoice
// does not give those lines back. So the dialog is a preview first and a
// button second, and it never runs on open.
//
// It has TWO states rather than one, because the run is per-stay and partial
// success is the expected outcome, not an edge case: one resident's Stripe
// failure leaves a recoverable draft and does not abort anybody else's
// invoice. A dialog that closed on "done" would report that as success.
import { CircleAlert, CircleCheck } from '@lucide/vue'
import { money } from '~/utils/money.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /**
   * Suppress the preview list. The billing screen already shows exactly what
   * will send, and a confirm that repeats it is noise — one component, two
   * shells, the `AppEventForm` layout-prop precedent. The dialog still fetches:
   * it needs the counts for its own button, and re-reading at the moment of
   * confirming is what keeps the promise honest if something changed.
   */
  confirmOnly: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'ran'])

const { listBillable, runWeekly } = useInvoices()
const notify = useNotify()

const stays = ref([])
const loading = ref(false)
const pending = ref(false)
const error = ref('')
/** Null until the run happens; then the per-stay outcomes. */
const results = ref(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    error.value = ''
    results.value = null
    loading.value = true
    try {
      stays.value = await listBillable()
    } catch {
      error.value = 'Could not work out what is ready to bill.'
    } finally {
      loading.value = false
    }
  },
)

/** The total of what will SEND — same reasoning as the button's count. */
const totalCents = computed(() =>
  stays.value.reduce((t, s) => t + (s.canInvoice ? s.netCents : 0), 0),
)
/** Stays that will fail for a reason we already know — said before the press. */
const blocked = computed(() => stays.value.filter((s) => !s.canInvoice))
// The button names what will actually SEND, not what is ready to bill. Those
// are different numbers whenever somebody has no email, and the button is the
// promise — "Send 5" that produces 2 teaches staff to distrust the count.
const sendable = computed(() => stays.value.filter((s) => s.canInvoice))
const failures = computed(() => (results.value ?? []).filter((r) => !r.ok))
// Stays that have paid more than has been invoiced. The run bills the full net
// regardless — the credit is on our ledger, not on the Stripe invoice — so it
// is named before the press rather than discovered by the resident.
const inCredit = computed(() => stays.value.filter((s) => s.canInvoice && s.creditCents > 0))

async function submit() {
  pending.value = true
  error.value = ''
  try {
    const res = await runWeekly()
    results.value = res.results
    notify.success(
      res.billed === 1 ? '1 invoice sent' : `${res.billed} invoices sent`,
    )
    emit('ran')
  } catch (err) {
    error.value = err?.data?.error ?? 'The run could not be completed.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Generate weekly invoices</DialogTitle>
        <DialogDescription>
          One invoice per active stay with pending charges. Net 3 days.
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <p v-if="loading" class="text-muted-foreground text-sm">Working out what is ready…</p>

      <!-- ── After the run ──────────────────────────────────────────────── -->
      <template v-else-if="results">
        <div class="flex max-h-64 flex-col overflow-y-auto">
          <div
            v-for="r in results"
            :key="r.stayId"
            class="flex items-center gap-2.5 border-b px-1 py-2 text-[13px] last:border-b-0"
          >
            <CircleCheck v-if="r.ok" class="text-success size-4 shrink-0" />
            <CircleAlert v-else class="text-destructive size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ r.residentName }}</span>
            <span v-if="r.ok" class="tabular-nums">{{ money(r.netCents) }}</span>
            <span v-else class="text-destructive max-w-[22ch] truncate text-xs">{{ r.error }}</span>
          </div>
        </div>
        <!-- A partial run is the normal outcome, so it gets said plainly
             rather than hidden behind a success toast. -->
        <p v-if="failures.length" class="text-muted-foreground text-xs">
          {{ failures.length }} did not send. Their charges are still pending and will be
          picked up by the next run once the reason is fixed.
        </p>
      </template>

      <!-- ── Before the run ─────────────────────────────────────────────── -->
      <template v-else-if="!stays.length">
        <p class="text-muted-foreground text-sm">
          There is nothing to bill — no active stay has pending charges.
        </p>
      </template>

      <template v-else>
        <div v-if="!confirmOnly" class="flex max-h-56 flex-col overflow-y-auto">
          <div
            v-for="s in stays"
            :key="s.stayId"
            class="flex items-baseline gap-3 border-b px-1 py-1.5 text-[13px] last:border-b-0"
          >
            <span class="min-w-0 flex-1 truncate">{{ s.residentName }}</span>
            <span class="text-muted-foreground text-xs tabular-nums">
              {{ s.lineCount }} {{ s.lineCount === 1 ? 'line' : 'lines' }}
            </span>
            <span class="tabular-nums" :class="!s.canInvoice && 'text-muted-foreground'">
              {{ money(s.netCents) }}
            </span>
          </div>
        </div>

        <div class="flex items-baseline justify-between border-t pt-2 text-sm">
          <span class="font-semibold">
            {{ sendable.length }} {{ sendable.length === 1 ? 'invoice' : 'invoices' }}
          </span>
          <span class="font-semibold tabular-nums">{{ money(totalCents) }}</span>
        </div>

        <!-- Known-to-fail stays are named UP FRONT. Letting the run discover
             them turns a preventable omission into a list of red rows. -->
        <Alert v-if="blocked.length" variant="destructive">
          <AlertDescription class="text-xs">
            {{ blocked.map((s) => s.residentName).join(', ') }}
            {{ blocked.length === 1 ? 'has' : 'have' }} no email address on file, and Stripe
            needs one to host an invoice.
            {{ blocked.length === 1 ? 'That invoice' : 'Those invoices' }} will not send;
            the charges stay pending for the next run.
          </AlertDescription>
        </Alert>

        <Alert v-if="inCredit.length">
          <AlertDescription class="text-xs">
            {{ inCredit.map((s) => s.residentName).join(', ') }}
            {{ inCredit.length === 1 ? 'has' : 'have' }} paid ahead, and the invoice will still
            ask Stripe for the full amount — the credit sits on our ledger, not on the invoice.
            Their balance here nets down once it is sent.
          </AlertDescription>
        </Alert>

        <p class="text-muted-foreground border-t pt-2 text-xs">
          Once swept, these lines are billed for good — a void does not return them. A
          correction after the fact is a new ledger entry, which flows onto the next invoice.
        </p>
      </template>

      <DialogFooter>
        <Button v-if="results" variant="outline" @click="emit('update:open', false)">
          Close
        </Button>
        <Button v-else :disabled="pending || loading || !sendable.length" @click="submit">
          Send {{ sendable.length }} {{ sendable.length === 1 ? 'invoice' : 'invoices' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
