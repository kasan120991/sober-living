<script setup>
// Sending an invoice — and the confirmation IS the design.
//
// Three things this dialog exists to show before anybody commits:
//
//   1. WHAT IS BEING SWEPT, in ledger wording, with the total. A sweep is
//      irreversible in one direction: those lines are billed forever, and a
//      void does not give them back.
//   2. THE STAY'S CURRENT BALANCE beside it, because the invoice bills new
//      charges rather than "what you owe" — a resident sitting on a credit
//      still gets billed for new rent, and a manager should see that before
//      it surprises them. Warned, never blocked; the invoice may be wanted.
//   3. WHAT LEAVES THE BUILDING. The exact labels Stripe will show, and one
//      plain sentence naming what crosses. The 42 CFR Part 2 decision, made
//      visible at the moment it is exercised rather than buried in a doc.
import { money } from '~/utils/money.js'
import { STRIPE_LINE_LABEL } from '~/utils/invoices.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  residentId: { type: String, default: '' },
  residentName: { type: String, default: '' },
  residentEmail: { type: String, default: '' },
  /** The ledger read's rows, so this fetches nothing. */
  entries: { type: Array, default: () => [] },
  balanceCents: { type: Number, default: 0 },
})
const emit = defineEmits(['update:open', 'sent'])

const { sendInvoice } = useInvoices()
const notify = useNotify()

const pending = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) error.value = ''
  },
)

/** Charges and credits with no invoice yet. Payments are never billable. */
const pendingLines = computed(() =>
  props.entries.filter((e) => !e.billed && e.type !== 'PAYMENT'),
)
const totalCents = computed(() =>
  pendingLines.value.reduce((t, e) => t + (e.type === 'CHARGE' ? e.amountCents : -e.amountCents), 0),
)
const inCredit = computed(() => props.balanceCents < 0)

async function submit() {
  pending.value = true
  error.value = ''
  try {
    // No "created but not sent" case any more: a server without a Stripe key
    // refuses in the pre-flight, before anything is billed, rather than
    // returning a local-only draft that looks exactly like a real send.
    const invoice = await sendInvoice(props.residentId)
    notify.success('Invoice sent')
    emit('update:open', false)
    emit('sent', invoice)
  } catch (err) {
    error.value = err?.data?.error ?? 'Could not send the invoice.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Send invoice — {{ residentName }}</DialogTitle>
        <DialogDescription>
          Every pending charge and credit on this stay, swept into one invoice. Due on receipt —
          and billing them is what makes them owed.
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <p v-if="!pendingLines.length" class="text-muted-foreground text-sm">
        There is nothing pending on this stay.
      </p>

      <template v-else>
        <div class="flex max-h-56 flex-col overflow-y-auto">
          <div
            v-for="e in pendingLines"
            :key="e.id"
            class="flex items-baseline gap-3 border-b px-1 py-1.5 text-[13px] last:border-b-0"
          >
            <span class="min-w-0 flex-1 truncate">{{ e.description }}</span>
            <span class="text-muted-foreground text-xs">{{ STRIPE_LINE_LABEL[e.category] ?? (e.type === 'CREDIT' ? 'Credit' : 'Program charge') }}</span>
            <span class="tabular-nums" :class="e.type === 'CREDIT' && 'text-success'">
              {{ e.type === 'CREDIT' ? '−' : '' }}{{ money(e.amountCents) }}
            </span>
          </div>
        </div>

        <div class="flex items-baseline justify-between border-t pt-2 text-sm">
          <span class="font-semibold">Invoice total</span>
          <span class="font-semibold tabular-nums">{{ money(totalCents) }}</span>
        </div>
        <p class="text-muted-foreground -mt-1 flex items-baseline justify-between text-xs">
          <span>Current balance on the stay</span>
          <span class="tabular-nums">{{ money(balanceCents) }}</span>
        </p>

        <!-- The invoice bills PENDING charges, and STRIPE HAS NEVER HEARD OF
             the credit — it lives only in our ledger. Said here rather than
             left to surprise somebody when the resident rings up about it. -->
        <Alert v-if="inCredit">
          <AlertDescription class="text-xs">
            {{ residentName }} is {{ money(Math.abs(balanceCents)) }} in credit, and this invoice
            will still ask Stripe for {{ money(totalCents) }} — the credit is on our ledger, not
            on the invoice. Their balance here afterwards will be
            {{ money(totalCents + balanceCents) }}.
          </AlertDescription>
        </Alert>

        <!-- Stripe's hosted invoicing requires an email, and only a NAME is
             required at intake — so a resident without one is ordinary. Said
             here, before the click, rather than as a failure afterwards. -->
        <Alert v-if="!residentEmail" variant="destructive">
          <AlertDescription class="text-xs">
            {{ residentName }} has no email address on file, and Stripe needs one to host an
            invoice. Add one to their record first.
          </AlertDescription>
        </Alert>

        <p v-else class="text-muted-foreground border-t pt-2 text-xs">
          Stripe receives {{ residentName }}'s name and email address, the amounts, and the
          labels above — never the wording on the left, and nothing clinical. The invoice is
          not emailed; you share the link.
        </p>
      </template>

      <DialogFooter>
        <Button
          :disabled="pending || !pendingLines.length || totalCents <= 0 || !residentEmail"
          @click="submit"
        >
          Send {{ money(totalCents) }} invoice
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
