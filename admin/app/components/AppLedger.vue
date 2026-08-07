<script setup>
// The lines behind a balance.
//
// The roster shows a number; this is where it comes from. A balance nobody can
// break down is not defensible to a resident disputing it or to anyone auditing
// the facility, so the record page always shows the entries, not just the total.
//
// Nothing here edits or deletes: the database refuses both. A mistake is
// corrected by posting an entry that points at the one it fixes.
//
// ── A BAND OVER A GROUPED HISTORY, THEN THE INVOICES (chosen 2026-08-07 from
// three rendered variants; a bank-style statement and an invoice-first list
// were the others). The section serves two questions in this order: "what does
// this person owe and what do I do about it" — the band — and "why" — the
// history. That is the same hero-over-trail shape as Apartment checks and the
// same queue-over-progress shape as /service, so the rail reads consistently.
//
// The two rejected variants each failed on the domain rather than on looks.
// The statement kept the cleanest chronology but demoted the invoice to a chip
// at the end of a row, just as an invoice became the thing that MAKES money
// owed. Invoice-first was the most faithful to that rule, but payments are not
// invoice lines in this model, so it split the story into pending / invoices /
// payments and left somebody asking "why $975" to net three blocks in their
// head — which is exactly the breakdown this section exists to provide.
//
// Dates here go through facilityDateOf, NEVER isoDate. Every date this section
// shows is an INSTANT underneath — `occurredAt` defaults to the moment the
// entry was typed, and `dueAt` is an invoice's term. isoDate slices UTC, so a
// charge posted at 9pm ET was dated tomorrow. Same rule, and the same bug, as
// the dashboard's `lastPaymentAt`.
import { Ellipsis, ExternalLink, Plus, Send, Trash2 } from '@lucide/vue'
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
// Loading, not money. Named for what it is now that `pendingCents` exists.
const loading = ref(true)

// Posting money is a manager action. A tech can read a balance — answering
// "what do I owe" at the door should not need a manager — but not change one.
const canManage = computed(
  () =>
    props.canPost && [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER].includes(user.value?.role),
)

async function load() {
  loading.value = !entries.value.length
  const [data, inv] = await Promise.all([
    listLedger(props.residentId),
    listInvoices(props.residentId),
  ])
  entries.value = data.entries
  balanceCents.value = data.balanceCents
  pendingCents.value = data.pendingCents
  draftCents.value = data.draftCents
  invoices.value = inv.invoices
  loading.value = false
}
await load()
// Every other rail section subscribes and this one did not — so a Stripe
// webhook posting a payment refreshed every screen EXCEPT the one where the
// money actually moved. Refreshes never re-blank what they update.
onRealtimeChanged(load)

// ── Derived ────────────────────────────────────────────────────────────────

/**
 * Charges and credits with no invoice. Payments are never billable, and a
 * REMOVED pair is not pending either — it is excluded from `pendingCents` on
 * the server, so counting it here would make the figure and its own caption
 * disagree ("$20.00 · 3 lines").
 */
const pendingEntries = computed(() =>
  entries.value.filter((e) => !e.billed && e.type !== 'PAYMENT' && !e.removed && !e.isReversal),
)
// OLDEST first — the one that has been ignored longest, the same order
// `overdueByStay` uses for the dashboard. The invoice list itself is
// newest-first, which would otherwise put the least urgent one in front.
const overdueInvoices = computed(() =>
  invoices.value.filter((i) => i.overdue).sort((a, b) => b.daysPastDue - a.daysPastDue),
)
/** An invoice whose Stripe half never finished — billed, but never sent. */
const drafts = computed(() => invoices.value.filter((i) => i.status === 'DRAFT'))

/**
 * Overdue-ness per invoice, keyed by id, so a row can carry it.
 *
 * The entry's own `invoice` projection deliberately does NOT include `overdue`
 * — that is derived on the server from a clock — so the row reads it from the
 * invoice list the same payload carried. One derivation, so a row and the
 * block above it cannot disagree about who is late.
 */
const statusById = computed(
  () => new Map(invoices.value.map((i) => [i.id, invoiceStatusDisplay(i)])),
)

/** The lines an invoice swept, for its disclosure. */
const linesByInvoice = computed(() => {
  const out = new Map()
  for (const e of entries.value) {
    if (!e.invoice) continue
    if (!out.has(e.invoice.id)) out.set(e.invoice.id, [])
    out.get(e.invoice.id).push(e)
  }
  return out
})

const MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })
// "Jul 5" — the rows sit under a month header, so repeating the year and month
// on every one of them is noise the group already carries. Deliberately not
// `humanDate({ short: true })`, which prepends a weekday nobody is reading here.
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const dayLabel = (instant) => DAY.format(new Date(`${facilityDateOf(instant)}T00:00:00.000Z`))

/**
 * Order-preserving month grouping over the newest-first list, with what each
 * month charged and took — the Screens section's idiom.
 *
 * The summary is deliberately TWO figures rather than one net subtotal. A net
 * would mix billed and pending money and state a number that is neither the
 * balance nor pending, which is the confusion this whole section was rebuilt
 * to remove.
 */
const byMonth = computed(() => {
  const out = []
  // The reversal half of a removed pair is dropped: it is the SAME fact as the
  // struck-through row above it, and two rows would read as two events. Both
  // are still on the wire and both are still in the table forever.
  for (const e of entries.value.filter((x) => !x.isReversal)) {
    const key = MONTH.format(new Date(`${facilityDateOf(e.occurredAt)}T00:00:00.000Z`))
    if (out.at(-1)?.key !== key) out.push({ key, entries: [], charged: 0, paid: 0, credited: 0 })
    const g = out.at(-1)
    g.entries.push(e)
    // A removed charge still SHOWS, struck through, but must not be counted:
    // a month header reading "$735.00 charged" that includes money nobody is
    // owed would be the section stating a figure it does not mean.
    if (e.removed) continue
    if (e.type === 'CHARGE') g.charged += e.amountCents
    else if (e.type === 'PAYMENT') g.paid += e.amountCents
    else g.credited += e.amountCents
  }
  return out
})

const monthSummary = (g) =>
  [
    g.charged ? `${money(g.charged)} charged` : null,
    g.paid ? `${money(g.paid)} paid` : null,
    g.credited ? `${money(g.credited)} credited` : null,
  ]
    .filter(Boolean)
    .join(' · ')

/** What the owed box says underneath its figure. */
const owedSub = computed(() => {
  if (overdueInvoices.value.length) return null // The invoice links say it.
  if (balanceCents.value > 0) return 'Invoiced, not yet due'
  if (inCredit(balanceCents.value)) return 'Paid ahead of what has been invoiced'
  return 'Nothing outstanding'
})

const pendingSub = computed(() => {
  const n = pendingEntries.value.length
  if (!n) return 'Nothing waiting'
  if (inCredit(pendingCents.value)) return `${n} ${n === 1 ? 'line' : 'lines'}, net a credit`
  return `${n} ${n === 1 ? 'line' : 'lines'}, not yet invoiced`
})

// ── Actions ────────────────────────────────────────────────────────────────

// The dialogs are siblings, not nested with their own triggers, so the roster's
// row menu can open the same implementation.
const entryOpen = ref(false)
const sendOpen = ref(false)
// ONE dialog for the whole table, driven by a row ref — the AppBedTable rule.
const removeOpen = ref(false)
const removing = ref(null)
function askRemove(entry) {
  removing.value = entry
  removeOpen.value = true
}

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
  <section class="flex min-w-0 flex-col gap-4">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-heading text-[15px] font-semibold tracking-tight">Ledger</h2>

      <div v-if="canManage" class="flex items-center gap-2">
        <!-- The button names the FIGURE it will bill, the weekly run's rule: a
             control that says what will happen is a promise, and a bare label
             is not. DISABLED when the sweep would refuse — a net of zero or a
             credit creates nothing and leaves the lines to roll onward. -->
        <Button
          size="sm"
          variant="outline"
          :disabled="pendingCents <= 0"
          :title="
            pendingCents < 0
              ? 'Pending nets to a credit — a sweep must come out positive'
              : pendingCents === 0
                ? 'Nothing pending on this stay'
                : undefined
          "
          @click="sendOpen = true"
        >
          <Send class="size-4" />
          Send invoice<span v-if="pendingCents > 0"> · {{ money(pendingCents) }}</span>
        </Button>
        <Button size="sm" variant="outline" @click="entryOpen = true">
          <Plus class="size-4" /> Add entry
        </Button>
      </div>
    </div>

    <p v-if="loading" class="text-muted-foreground text-sm">Loading…</p>

    <template v-else>
      <!-- ── The band ─────────────────────────────────────────────────────── -->
      <!-- Two figures, and the split is the point: the balance is what has been
           INVOICED and not paid, pending is what has not been billed yet.
           Neither box is hidden at zero — a missing box reads as a loading
           state, and staff need to see that the answer IS zero. -->
      <div class="grid gap-2.5 sm:grid-cols-[1.35fr_1fr]">
        <!-- The pane's ONE inset, and it carries the overdue invoices itself.
             A separate banner beneath a destructive box was two insets on one
             surface, which is what stops an inset meaning anything. -->
        <div
          class="rounded-md border p-3.5"
          :class="
            overdueInvoices.length
              ? 'border-destructive bg-card shadow-[inset_3px_0_0_var(--destructive)]'
              : 'bg-card'
          "
        >
          <p
            class="text-[11px] font-semibold tracking-wider uppercase"
            :class="overdueInvoices.length ? 'text-destructive' : 'text-muted-foreground'"
          >
            {{ inCredit(balanceCents) ? 'In credit' : 'Owed' }}
            <span v-if="overdueInvoices.length">
              · {{ overdueInvoices.length }} past due
            </span>
          </p>
          <p
            class="mt-0.5 text-[23px] font-semibold tracking-tight tabular-nums"
            :class="
              overdueInvoices.length
                ? 'text-destructive'
                : balanceCents === 0
                  ? 'text-muted-foreground'
                  : inCredit(balanceCents)
                    ? 'text-success'
                    : 'text-foreground'
            "
          >
            {{ money(balanceCents) }}
          </p>

          <!-- Every overdue invoice, not just the oldest. A resident with two
               is a resident with a second one nobody is being shown. -->
          <p v-if="overdueInvoices.length" class="text-muted-foreground mt-1 text-[12.5px]">
            <!-- Each number and its age are one unit; the gap between them has
                 to be a real character, since Vue collapses leading whitespace
                 in a text node and they otherwise render run together. -->
            <span v-for="(i, idx) in overdueInvoices" :key="i.id">
              <span v-if="idx" aria-hidden="true"> · </span>
              <a
                v-if="i.hostedUrl"
                :href="i.hostedUrl"
                target="_blank"
                rel="noopener"
                class="underline underline-offset-2"
              >{{ i.number ?? 'invoice' }}</a>
              <span v-else>{{ i.number ?? 'invoice' }}</span>
              <span class="tabular-nums">&nbsp;{{ i.daysPastDue }}d</span>
            </span>
          </p>
          <p v-else class="text-muted-foreground mt-1 text-[12.5px]">{{ owedSub }}</p>
        </div>

        <div class="bg-card rounded-md border p-3.5">
          <p class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Pending
          </p>
          <p
            class="mt-0.5 text-[23px] font-semibold tracking-tight tabular-nums"
            :class="
              pendingCents === 0
                ? 'text-muted-foreground'
                : inCredit(pendingCents)
                  ? 'text-success'
                  : 'text-foreground'
            "
          >
            {{ money(pendingCents) }}
          </p>
          <p class="text-muted-foreground mt-1 text-[12.5px]">{{ pendingSub }}</p>
        </div>
      </div>

      <!-- A DRAFT is money in NEITHER figure above: its lines are bound so they
           are not pending, and it was never issued so it is not owed. Without
           this line it simply vanishes from the section. -->
      <div
        v-if="draftCents > 0"
        class="border-warning bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-[13px]"
      >
        <span class="text-warning font-semibold">
          {{ drafts.length }} {{ drafts.length === 1 ? 'invoice' : 'invoices' }} not sent
        </span>
        <span class="text-muted-foreground">
          · {{ money(draftCents) }} is billed but never went out
        </span>
        <Button
          v-if="canManage && drafts.length"
          size="sm"
          variant="outline"
          class="ms-auto"
          :disabled="resuming === drafts[0].id"
          @click="resume(drafts[0])"
        >
          <Send class="size-4" /> {{ resuming === drafts[0].id ? 'Sending…' : 'Send' }}
        </Button>
      </div>

      <!-- ── History ──────────────────────────────────────────────────────── -->
      <section v-if="entries.length" class="flex flex-col gap-1">
        <h3 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          History
        </h3>

        <div v-for="g in byMonth" :key="g.key" class="mt-1.5">
          <div class="flex items-baseline justify-between gap-3 border-b px-1 py-1">
            <span class="text-[12px] font-bold tracking-wider uppercase">{{ g.key }}</span>
            <span class="text-muted-foreground text-[12px] tabular-nums">
              {{ monthSummary(g) }}
            </span>
          </div>

          <table class="w-full border-collapse text-[13.5px]">
            <tbody>
              <tr v-for="e in g.entries" :key="e.id">
                <td
                  class="text-muted-foreground w-[5.2em] border-b px-1 py-2 align-baseline tabular-nums whitespace-nowrap"
                >
                  {{ dayLabel(e.occurredAt) }}
                </td>
                <td class="border-b px-1 py-2 align-baseline" :class="e.removed && 'text-muted-foreground'">
                  {{ e.description }}
                  <span v-if="e.category" class="text-muted-foreground">
                    · {{ categoryLabel(e.category) }}
                  </span>
                  <span v-if="e.corrects && !e.removed" class="text-warning">· correction</span>

                  <!-- A removed charge keeps its row and its reason. It cannot
                       leave: the table refuses DELETE by trigger and by revoked
                       privilege, which is the guarantee the module rests on. -->
                  <span v-if="e.removed" class="text-muted-foreground">
                    · removed<template v-if="e.removedBy">
                      · {{ e.removedBy.description.replace(/^Removed:\s*/, '') }}</template>
                  </span>

                  <!-- PENDING is marked; billed is not. Once invoicing is
                       routine most lines are billed, and marking the majority
                       is wallpaper — the polish-pass lesson. Pending is the
                       state somebody can act on, and the one saying this line
                       is not yet part of what the resident owes. -->
                  <Badge
                    v-if="!e.billed && e.type !== 'PAYMENT' && !e.removed"
                    variant="outline"
                    class="ms-1 text-[10px]"
                  >
                    pending
                  </Badge>
                  <template v-else-if="e.invoice">
                    <Badge
                      v-if="statusById.get(e.invoice.id)?.tone === 'destructive'"
                      variant="outline"
                      class="ms-1 border-transparent text-[10px]"
                      :class="toneClass('destructive')"
                    >
                      {{ statusById.get(e.invoice.id).label }}
                    </Badge>
                    <a
                      v-if="e.invoice.hostedUrl"
                      :href="e.invoice.hostedUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-muted-foreground ms-1 underline underline-offset-2 whitespace-nowrap"
                    >
                      {{ e.invoice.number ?? 'invoice' }}
                    </a>
                  </template>
                </td>
                <td
                  class="w-[7em] border-b px-1 py-2 text-right align-baseline tabular-nums whitespace-nowrap"
                >
                  <span
                    :class="
                      e.removed
                        ? 'text-muted-foreground line-through'
                        : e.type === 'CHARGE'
                          ? 'text-foreground'
                          : 'text-success'
                    "
                  >
                    {{ e.type === 'CHARGE' ? '' : '−' }}{{ money(e.amountCents) }}
                  </span>
                </td>

                <!-- Row actions follow AppBedTable: a trailing column, a ghost
                     ellipsis, and ONE dialog for the whole table driven by a
                     row ref — never a dialog per row. The cell is always
                     rendered so the column does not appear and disappear
                     between rows and shift the amounts sideways. -->
                <td class="w-9 border-b px-0 py-2 align-baseline">
                  <DropdownMenu v-if="canManage && !e.billed && e.type === 'CHARGE' && !e.removed">
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="size-7 p-0"
                        :aria-label="`Actions for ${e.description}`"
                      >
                        <Ellipsis class="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem class="text-destructive" @select="askRemove(e)">
                        <Trash2 class="size-4" /> Remove charge
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-else class="text-muted-foreground py-6 text-center text-sm">
        No entries yet. Rent and fees appear here as they are posted.
      </p>

      <!-- ── Invoices ─────────────────────────────────────────────────────── -->
      <!-- Native <details> rather than a vendored Collapsible: shadcn's is not
           in ui/, and `shadcn-vue add` rewrites main.css with the Google Fonts
           imports this project forbids. A disclosure is a browser primitive —
           this is not the hand-rolled component the convention warns about. -->
      <section v-if="invoices.length" class="flex flex-col gap-1">
        <h3 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Invoices
        </h3>

        <details v-for="i in invoices" :key="i.id" class="group mt-1 rounded-md border">
          <summary
            class="flex cursor-pointer flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3 py-2.5 text-[13.5px] max-md:min-h-11 [&::-webkit-details-marker]:hidden"
          >
            <span class="text-muted-foreground text-[10px] group-open:rotate-90">▶</span>
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
              @click.stop
            >
              Open <ExternalLink class="size-3" />
            </a>
            <Button
              v-else-if="canManage && i.status === 'DRAFT'"
              size="sm"
              variant="outline"
              class="ms-auto"
              :disabled="resuming === i.id"
              @click.stop.prevent="resume(i)"
            >
              <Send class="size-4" /> {{ resuming === i.id ? 'Sending…' : 'Send' }}
            </Button>
          </summary>

          <!-- The lines it swept — the one question the flat table could never
               answer without reading every row. -->
          <div class="px-3 pb-2.5 ps-7">
            <table class="w-full border-collapse text-[13px]">
              <tbody>
                <tr v-for="e in linesByInvoice.get(i.id) ?? []" :key="e.id">
                  <td
                    class="text-muted-foreground w-[5.2em] border-b px-1 py-1.5 align-baseline tabular-nums whitespace-nowrap"
                  >
                    {{ dayLabel(e.occurredAt) }}
                  </td>
                  <td class="border-b px-1 py-1.5 align-baseline">
                    {{ e.description }}
                    <span v-if="e.category" class="text-muted-foreground">
                      · {{ categoryLabel(e.category) }}
                    </span>
                  </td>
                  <td
                    class="w-[7em] border-b px-1 py-1.5 text-right align-baseline tabular-nums whitespace-nowrap"
                  >
                    <span :class="e.type === 'CREDIT' && 'text-success'">
                      {{ e.type === 'CREDIT' ? '−' : '' }}{{ money(e.amountCents) }}
                    </span>
                  </td>
                </tr>
                <tr v-if="!(linesByInvoice.get(i.id) ?? []).length">
                  <td colspan="3" class="text-muted-foreground px-1 py-2 text-[12.5px]">
                    Its lines belong to an earlier stay, so they are not on this ledger.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </template>

    <AppLedgerRemoveDialog
      v-model:open="removeOpen"
      :resident-id="residentId"
      :entry="removing"
      @removed="onPosted"
    />
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
