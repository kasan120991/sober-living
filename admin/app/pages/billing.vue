<script setup>
// Billing, house-wide. MANAGERS AND ADMINS — the API refuses a tech, and that
// refusal is the protection; the sidebar hiding the link is presentation.
//
// ── RUN-FIRST (chosen 2026-08-07 from three rendered framings; a
// collections-first chase list and a filterable invoice ledger were the
// others). This app has no cron: the facility is billed when a human presses a
// button, and that button used to be a Quick action in a dropdown on the
// dashboard. Putting what is ready to bill in the first band makes the act the
// point of the page.
//
// It matters more since 2026-08-07, when a balance became invoiced-and-due:
// pending money sits OUTSIDE the balance, so an unpressed button means nobody
// shows as owing it at all. The Friday nag is the counterweight, and it lives
// here and in the dashboard's attention panel — deliberately not in the bell,
// which techs read and cannot act on.
import { ExternalLink, Send } from '@lucide/vue'
import { money } from '~/utils/money.js'
import { facilityDateOf, humanDate } from '~/utils/facilityTime.js'
import { invoiceStatusDisplay } from '~/utils/invoices.js'
import { toneClass } from '~/utils/schedule.js'

// Literal rather than an imported constant: definePageMeta is a compile-time
// macro and does not see imports. The API is the real gate — this only stops a
// tech who types the URL landing on a crash from the refused fetch.
definePageMeta({ roles: ['ADMIN', 'HOUSE_MANAGER'] })

const { getBilling } = useBilling()

const data = ref(null)
const pending = ref(true)
const runOpen = ref(false)

async function load() {
  // First load only — a realtime refresh must not blank what it updates.
  pending.value = !data.value
  data.value = await getBilling()
  pending.value = false
}
await load()
onRealtimeChanged(load)

const figures = computed(() => data.value?.figures ?? {})
const nag = computed(() => data.value?.nag ?? null)
/** Positive pending and an email — what the button will actually send. */
const sendable = computed(() => (data.value?.ready ?? []).filter((r) => r.canInvoice))
/** Positive pending, no email. In `ready` on the wire, grouped apart here. */
const blocked = computed(() => (data.value?.ready ?? []).filter((r) => !r.canInvoice))
/** Nets to a credit, so a sweep would create nothing. */
const credits = computed(() => data.value?.skipped ?? [])
const pastDue = computed(() => data.value?.pastDue ?? [])
const recent = computed(() => data.value?.recent ?? [])
</script>

<template>
  <AppPage title="Billing">
    <template #description>
      <template v-if="figures.outstandingCents">
        <span class="tabular-nums">{{ money(figures.outstandingCents) }}</span> outstanding ·
        <span class="tabular-nums">{{ money(figures.pendingCents) }}</span> waiting to be billed
      </template>
      <template v-else>What is ready to bill, and who is behind.</template>
    </template>

    <p v-if="pending" class="text-muted-foreground text-sm">Loading…</p>

    <div v-else class="flex min-w-0 flex-col gap-6">
      <!-- ── The nag ──────────────────────────────────────────────────────
           Not "there are pending charges", which is true every day. It fires
           only when a billing day has gone past unbilled. -->
      <div
        v-if="nag?.due"
        class="border-warning bg-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[13px]"
      >
        <span class="text-warning font-semibold">Not billed since Friday</span>
        <span class="text-muted-foreground">
          · {{ nag.waiting }} {{ nag.waiting === 1 ? 'resident has' : 'residents have' }}
          charges waiting, and pending money is not part of what anyone owes
        </span>
      </div>

      <!-- ── Figures ──────────────────────────────────────────────────────
           Neither figure is hidden at zero: a missing box reads as a loading
           state, and "nothing outstanding" is an answer worth showing. -->
      <div class="grid gap-2.5 sm:grid-cols-3">
        <div
          class="rounded-md border p-3.5"
          :class="
            figures.overdueCents > 0
              ? 'border-destructive bg-card shadow-[inset_3px_0_0_var(--destructive)]'
              : 'bg-card'
          "
        >
          <p
            class="text-[11px] font-semibold tracking-wider uppercase"
            :class="figures.overdueCents > 0 ? 'text-destructive' : 'text-muted-foreground'"
          >
            Outstanding
          </p>
          <p class="mt-0.5 text-[23px] font-semibold tracking-tight tabular-nums">
            {{ money(figures.outstandingCents) }}
          </p>
          <p class="text-muted-foreground mt-1 text-[12.5px]">
            <span v-if="figures.overdueCents > 0" class="text-destructive">
              {{ money(figures.overdueCents) }} past due
            </span>
            <span v-else>Nothing past due</span>
          </p>
        </div>

        <div class="bg-card rounded-md border p-3.5">
          <p class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Waiting to be billed
          </p>
          <p class="mt-0.5 text-[23px] font-semibold tracking-tight tabular-nums">
            {{ money(figures.pendingCents) }}
          </p>
          <!-- This figure and the Send button are the SAME number by
               construction; when they differ it is because somebody has no
               email, and the line under the button says exactly who. -->
          <p class="text-muted-foreground mt-1 text-[12.5px]">
            <span v-if="figures.creditCents > 0" class="text-success">
              {{ money(figures.creditCents) }} in credit besides
            </span>
            <span v-else>Not owed by anyone until it is invoiced</span>
          </p>
        </div>

        <div class="bg-card rounded-md border p-3.5">
          <p class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Invoices past due
          </p>
          <p class="mt-0.5 text-[23px] font-semibold tracking-tight tabular-nums">
            {{ pastDue.length }}
          </p>
          <p v-if="figures.draftCount" class="text-warning mt-1 text-[12.5px]">
            {{ figures.draftCount }} not sent · {{ money(figures.draftCents) }}
          </p>
          <p v-else class="text-muted-foreground mt-1 text-[12.5px]">
            {{ recent.length }} invoices recently
          </p>
        </div>
      </div>

      <!-- ── Ready to bill ────────────────────────────────────────────────
           The point of the page. The button names what will actually SEND,
           never what is merely ready — "Send 5" that produces 2 teaches staff
           to distrust the count. -->
      <section class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            Ready to bill
          </h2>
          <Button
            size="sm"
            :disabled="!sendable.length"
            :title="!sendable.length ? 'Nothing can be sent right now' : undefined"
            @click="runOpen = true"
          >
            <Send class="size-4" />
            Send {{ sendable.length }}
            {{ sendable.length === 1 ? 'invoice' : 'invoices' }}
            <span v-if="sendable.length"> · {{ money(data.readyTotalCents) }}</span>
          </Button>
        </div>

        <div v-if="sendable.length" class="overflow-hidden rounded-md border">
          <table class="w-full border-collapse text-[13.5px]">
            <tbody>
              <tr v-for="s in sendable" :key="s.stayId" class="bg-card">
                <td class="h-11 border-b px-3">
                  <NuxtLink
                    :to="`/residents/${s.residentId}`"
                    class="underline-offset-2 hover:underline"
                  >
                    {{ s.residentName }}
                  </NuxtLink>
                  <span v-if="s.creditCents" class="text-muted-foreground">
                    · {{ money(s.creditCents) }} in credit
                  </span>
                </td>
                <td class="text-muted-foreground h-11 border-b px-3 text-right tabular-nums">
                  {{ s.lineCount }} {{ s.lineCount === 1 ? 'line' : 'lines' }}
                </td>
                <td class="h-11 w-[8em] border-b px-3 text-right font-medium tabular-nums">
                  {{ money(s.netCents) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-muted-foreground text-sm">
          Nothing to bill — no active stay has charges waiting.
        </p>

        <!-- Said BEFORE the press, not discovered as red rows afterwards. -->
        <div
          v-if="blocked.length || credits.length"
          class="text-muted-foreground flex flex-col gap-1 text-[12.5px]"
        >
          <p v-if="blocked.length">
            <span class="text-warning font-medium">Will not send:</span>
            {{ blocked.map((s) => s.residentName).join(', ') }} —
            {{ blocked.length === 1 ? 'has' : 'have' }} no email on file, and Stripe needs one
            to host an invoice.
          </p>
          <p v-if="credits.length">
            <span class="font-medium">Skipped:</span>
            {{ credits.map((s) => s.residentName).join(', ') }} — pending nets to a credit, so a
            sweep would create nothing. The lines roll to the next run.
          </p>
        </div>
      </section>

      <!-- ── Past due ─────────────────────────────────────────────────────
           EVERY overdue invoice, not one per stay: a resident carrying two has
           a second one that is real money. -->
      <section v-if="pastDue.length" class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Past due
        </h2>
        <div class="overflow-hidden rounded-md border">
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-[13.5px]">
              <tbody>
                <tr v-for="i in pastDue" :key="i.invoiceId" class="bg-card">
                  <td class="h-11 border-b px-3 whitespace-nowrap">
                    <NuxtLink
                      :to="`/residents/${i.residentId}`"
                      class="underline-offset-2 hover:underline"
                    >
                      {{ i.residentName }}
                    </NuxtLink>
                  </td>
                  <td class="text-muted-foreground h-11 border-b px-3 tabular-nums whitespace-nowrap">
                    {{ i.number ?? '—' }}
                  </td>
                  <td class="h-11 border-b px-3 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      class="border-transparent text-[10px]"
                      :class="toneClass('destructive')"
                    >
                      {{ i.daysPastDue }}d
                    </Badge>
                    <span class="text-muted-foreground ms-1.5 text-xs">
                      due {{ facilityDateOf(i.dueAt) }}
                    </span>
                  </td>
                  <td class="h-11 border-b px-3 text-right font-medium tabular-nums whitespace-nowrap">
                    {{ money(i.totalCents) }}
                  </td>
                  <td class="h-11 border-b px-3 text-right whitespace-nowrap">
                    <a
                      v-if="i.hostedUrl"
                      :href="i.hostedUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-muted-foreground inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      Open <ExternalLink class="size-3" />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ── Recent invoices ──────────────────────────────────────────── -->
      <section v-if="recent.length" class="flex flex-col gap-2">
        <h2 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Recent invoices
        </h2>
        <div class="overflow-hidden rounded-md border">
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-[13.5px]">
              <tbody>
                <tr v-for="i in recent" :key="i.id" class="bg-card">
                  <td class="text-muted-foreground h-11 border-b px-3 tabular-nums whitespace-nowrap">
                    {{ humanDate(facilityDateOf(i.createdAt), { short: true }) }}
                  </td>
                  <td class="h-11 border-b px-3 whitespace-nowrap">
                    <NuxtLink
                      :to="`/residents/${i.residentId}`"
                      class="underline-offset-2 hover:underline"
                    >
                      {{ i.residentName }}
                    </NuxtLink>
                  </td>
                  <td class="text-muted-foreground h-11 border-b px-3 tabular-nums whitespace-nowrap">
                    {{ i.number ?? 'Not sent' }}
                  </td>
                  <td class="h-11 border-b px-3 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      class="border-transparent text-[10px]"
                      :class="toneClass(invoiceStatusDisplay(i).tone)"
                    >
                      {{ invoiceStatusDisplay(i).label }}
                    </Badge>
                  </td>
                  <td class="h-11 border-b px-3 text-right tabular-nums whitespace-nowrap">
                    {{ money(i.totalCents) }}
                  </td>
                  <td class="h-11 border-b px-3 text-right whitespace-nowrap">
                    <a
                      v-if="i.hostedUrl"
                      :href="i.hostedUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-muted-foreground inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      Open <ExternalLink class="size-3" />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <!-- The screen IS the preview, so the dialog skips its own list and is a
         confirm plus the per-stay result — partial success is the expected
         outcome of a per-stay run, and that report is the only place it shows. -->
    <AppWeeklyRunDialog v-model:open="runOpen" confirm-only @ran="load" />
  </AppPage>
</template>
