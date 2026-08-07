<script setup>
// The lines behind a balance.
//
// The roster shows a number; this is where it comes from. A balance nobody can
// break down is not defensible to a resident disputing it or to anyone auditing
// the facility, so the record page always shows the entries, not just the total.
//
// Nothing here edits or deletes: the database refuses both. A mistake is
// corrected by posting an entry that points at the one it fixes.
// Dates here go through facilityDateOf, NEVER isoDate. Every date this section
// shows is an INSTANT underneath — `occurredAt` defaults to the moment the
// entry was typed, and `dueAt` to the moment the invoice was sent. isoDate
// slices UTC, so a charge posted at 9pm ET was dated tomorrow and an invoice
// sent that evening claimed to be due a day later than it is. Same rule, and
// the same bug, as the dashboard's `lastPaymentAt`.
import { ExternalLink, Plus, Send } from '@lucide/vue'
import { facilityDateOf } from '~/utils/facilityTime.js'
import { money, inCredit, categoryLabel } from '~/utils/money.js'
import { invoiceStatusDisplay } from '~/utils/invoices.js'
import { toneClass } from '~/utils/schedule.js'
import { STAFF_ROLE } from '~/utils/roles.js'

const props = defineProps({
  residentId: { type: String, required: true },
  /** False once discharged — a closed stay still shows, it just cannot be billed. */
  canPost: { type: Boolean, default: false },
  residentName: { type: String, default: '' },
  residentEmail: { type: String, default: '' },
})
const emit = defineEmits(['posted'])

const { user } = useAuth()
const { listLedger } = useResidents()
const { listInvoices, resendInvoice } = useInvoices()
const notify = useNotify()

const entries = ref([])
const balanceCents = ref(0)
// Charges and credits nobody has invoiced yet. NOT part of the balance: since
// 2026-08-07 a resident owes what has been invoiced and not paid, so pending
// money is stated beside it rather than folded into it.
const pendingCents = ref(0)
// Money on an invoice nobody sent — in neither figure, so it gets said out loud
// rather than silently disappearing from both.
const draftCents = ref(0)
const invoices = ref([])
const overdue = ref(null)
// Loading, not money. Named for what it is now that `pendingCents` exists.
const loading = ref(true)

// Posting money is a manager action. A tech can read a balance — answering
// "what do I owe" at the door should not need a manager — but not change one.
const canManage = computed(
  () =>
    props.canPost && [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

async function load() {
  loading.value = true
  const [data, inv] = await Promise.all([
    listLedger(props.residentId),
    listInvoices(props.residentId),
  ])
  entries.value = data.entries
  balanceCents.value = data.balanceCents
  pendingCents.value = data.pendingCents
  draftCents.value = data.draftCents
  invoices.value = inv.invoices
  overdue.value = inv.invoices.find((i) => i.overdue) ?? null
  loading.value = false
}
await load()

// The dialog is a sibling component now, not a nested one with its own trigger,
// so the row menu on the roster can open the same implementation.
const entryOpen = ref(false)
const sendOpen = ref(false)

async function onPosted() {
  await load()
  emit('posted')
}

// Finish a draft whose Stripe half never completed. Idempotent on the server —
// the deterministic idempotency keys mean a replay returns the same objects
// rather than creating a second invoice — so this is safe to press twice.
const resuming = ref(null)
async function resume(invoice) {
  resuming.value = invoice.id
  try {
    await resendInvoice(invoice.id)
    notify.success('Invoice sent')
    await load()
    emit('posted')
  } catch (err) {
    notify.error(err?.data?.error ?? 'The invoice could not be sent.')
  } finally {
    resuming.value = null
  }
}
</script>

<template>
  <section>
    <div class="mb-2 flex items-center justify-between gap-3">
      <div class="flex items-baseline gap-3">
        <h2 class="font-heading text-[15px] font-semibold tracking-tight">Ledger</h2>
        <!-- Two figures, not one, and the split is the point: the balance is
             what has been INVOICED and not paid, pending is what has not been
             billed yet. The beds-free card's treatment — a bare total would
             hide which of the two a number belongs to. -->
        <span
          class="text-[13.5px] tabular-nums"
          :class="
            balanceCents === 0
              ? 'text-muted-foreground'
              : inCredit(balanceCents)
                ? 'text-success'
                : 'text-foreground font-medium'
          "
        >
          {{ money(balanceCents) }}
          <span class="text-muted-foreground font-normal">
            {{ inCredit(balanceCents) ? 'in credit' : balanceCents === 0 ? 'balance' : 'owed' }}
          </span>
        </span>
        <!-- Hidden at zero, the census-tile rule: absence of a figure means
             nothing is waiting, which keeps a quiet record quiet. -->
        <span v-if="pendingCents !== 0" class="text-muted-foreground text-[13.5px] tabular-nums">
          {{ money(pendingCents) }} pending
        </span>
      </div>

      <div class="flex items-center gap-2">
        <!-- Hidden for techs (the server refuses regardless, and a control
             that can never succeed teaches nothing); DISABLED with a reason
             when there is nothing to bill. Different cases, different
             treatments. -->
        <Button
          v-if="canManage"
          size="sm"
          variant="outline"
          :disabled="pendingCents <= 0"
          :title="pendingCents <= 0 ? 'Nothing pending on this stay' : undefined"
          @click="sendOpen = true"
        >
          <Send class="size-4" /> Send invoice
        </Button>
        <Button v-if="canManage" size="sm" variant="outline" @click="entryOpen = true">
          <Plus class="size-4" /> Add entry
        </Button>
      </div>
    </div>

    <!-- Overdue is the loudest thing this section can say, so it says it once,
         at the top, rather than only as a chip on a row far down the table. -->
    <div
      v-if="overdue"
      class="border-destructive bg-card mb-3 rounded-md border px-3 py-2 text-[13px] shadow-[inset_3px_0_0_var(--destructive)]"
    >
      <span class="text-destructive font-semibold">
        Overdue {{ overdue.daysPastDue }}d
      </span>
      <span class="text-muted-foreground">
        · invoice {{ overdue.number ?? '—' }} for {{ money(overdue.totalCents) }} was due
        {{ facilityDateOf(overdue.dueAt) }}
      </span>
      <a
        v-if="overdue.hostedUrl"
        :href="overdue.hostedUrl"
        target="_blank"
        rel="noopener"
        class="ms-1 underline underline-offset-2"
      >
        Open
      </a>
    </div>

    <p v-if="loading" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="overflow-hidden rounded-md border">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th
                v-for="h in ['Date', 'Description', 'Type', 'Amount']"
                :key="h"
                class="bg-card text-muted-foreground border-b px-3 py-2 text-left text-[10.5px] font-semibold tracking-[0.1em] whitespace-nowrap uppercase"
                :class="h === 'Amount' && 'text-right'"
              >
                {{ h }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in entries" :key="e.id" class="bg-card">
              <td class="h-12 border-b px-3 tabular-nums whitespace-nowrap">
                {{ facilityDateOf(e.occurredAt) }}
              </td>
              <td class="h-12 max-w-[38ch] truncate border-b px-3">
                {{ e.description }}
                <span v-if="e.category" class="text-muted-foreground">
                  · {{ categoryLabel(e.category) }}
                </span>
                <span v-if="e.corrects" class="text-warning">· correction</span>
                <!-- PENDING is marked, not billed. Once invoicing is routine
                     most lines are billed, and marking the majority is
                     wallpaper — the polish-pass lesson. Pending is the state
                     somebody can act on, and now also the one saying this line
                     is not yet part of what the resident owes. -->
                <span v-if="!e.billed && e.type !== 'PAYMENT'" class="text-muted-foreground">
                  · pending
                </span>
                <a
                  v-else-if="e.invoice?.hostedUrl"
                  :href="e.invoice.hostedUrl"
                  target="_blank"
                  rel="noopener"
                  class="text-muted-foreground underline underline-offset-2"
                >
                  · {{ e.invoice.number ?? 'invoice' }}
                </a>
              </td>
              <td class="h-12 border-b px-3 whitespace-nowrap">
                <Badge variant="outline" class="tracking-wider text-[10px] uppercase">
                  {{ e.type.toLowerCase() }}
                </Badge>
              </td>
              <td class="h-12 border-b px-3 text-right tabular-nums whitespace-nowrap">
                <span :class="e.type === 'CHARGE' ? 'text-foreground' : 'text-success'">
                  {{ e.type === 'CHARGE' ? '' : '−' }}{{ money(e.amountCents) }}
                </span>
              </td>
            </tr>

            <tr v-if="!entries.length">
              <td colspan="4" class="bg-card text-muted-foreground px-3 py-8 text-center text-sm">
                Nothing billed yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <!-- ── Invoices ────────────────────────────────────────────────────── -->
    <div v-if="!loading && invoices.length" class="mt-5">
      <h3 class="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
        Invoices
      </h3>
      <div class="flex flex-col">
        <div
          v-for="i in invoices"
          :key="i.id"
          class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-1 py-2 text-[13px] last:border-b-0"
        >
          <span class="font-medium tabular-nums">{{ i.number ?? 'Not sent' }}</span>
          <span class="text-muted-foreground tabular-nums">
            {{ money(i.totalCents) }} · due {{ facilityDateOf(i.dueAt) }}
          </span>
          <Badge
            variant="outline"
            class="border-transparent text-[10px]"
            :class="toneClass(invoiceStatusDisplay(i).tone)"
          >
            {{ invoiceStatusDisplay(i).label }}
          </Badge>
          <a
            v-if="i.hostedUrl"
            :href="i.hostedUrl"
            target="_blank"
            rel="noopener"
            class="text-muted-foreground ms-auto inline-flex items-center gap-1 underline underline-offset-2"
          >
            Open <ExternalLink class="size-3" />
          </a>
          <!-- A DRAFT is an invoice whose Stripe half never finished. The
               recovery path already existed on the server and was reachable
               only by curl, which is how one sat unnoticed for 40 minutes. -->
          <Button
            v-else-if="canManage && i.status === 'DRAFT'"
            size="sm"
            variant="outline"
            class="ms-auto"
            :disabled="resuming === i.id"
            @click="resume(i)"
          >
            <Send class="size-4" /> {{ resuming === i.id ? 'Sending…' : 'Send' }}
          </Button>
        </div>
      </div>
    </div>

    <AppLedgerEntryDialog
      v-model:open="entryOpen"
      :resident-id="residentId"
      :balance-cents="balanceCents"
      @posted="onPosted"
    />
    <AppInvoiceSendDialog
      v-model:open="sendOpen"
      :resident-id="residentId"
      :resident-name="residentName"
      :resident-email="residentEmail"
      :entries="entries"
      :balance-cents="balanceCents"
      @sent="onPosted"
    />
  </section>
</template>
