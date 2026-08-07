import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { PRISMA } from '../lib/http.js'
import {
  INVOICE_CURRENCY,
  INVOICE_DOT_GRACE_DAYS,
  INVOICE_STATUS,
  LEDGER_ENTRY_TYPE,
  LEDGER_SIGN,
  STAY_STATUS,
  STRIPE_LINE_LABEL,
} from '../domain/constants.js'
import { stripe, stripeEmailsInvoices, stripeEnabled } from '../lib/stripe.js'
import { balanceOfStay, balancesByStay } from './ledger.js'

/**
 * Invoices — module 11's second half, and the thing that finally gives
 * "overdue" a meaning.
 *
 * A charge is UNBILLED until an invoice sweeps it, and unbilled is the ABSENCE
 * of an `invoice_lines` row — never a column on the ledger, which refuses
 * updates by trigger and by revoked privilege. That was chosen over relaxing
 * the trigger for "only this one column, only null → value", which is exactly
 * how an append-only table stops being append-only.
 *
 * Nothing here stores a balance. `Invoice.totalCents` is a SNAPSHOT of what was
 * billed on the day it was sent, and the migration puts it outside the UPDATE
 * grant so it cannot move — which is what makes it a snapshot rather than a
 * cache, since a cache is by definition something that gets recomputed.
 */

const DAY_MS = 86_400_000

/** What may be swept: a charge asks for money, a credit reduces the ask. */
const BILLABLE = [LEDGER_ENTRY_TYPE.CHARGE, LEDGER_ENTRY_TYPE.CREDIT]

/** The label a line is allowed to carry to Stripe. Never the description. */
export function stripeLineLabel(entry) {
  if (entry.type === LEDGER_ENTRY_TYPE.CREDIT) return 'Credit'
  return STRIPE_LINE_LABEL[entry.category] ?? STRIPE_LINE_LABEL.OTHER
}

/**
 * The only thing about a resident that crosses to Stripe as metadata: opaque
 * ids. Built by ONE function so it is assertable rather than trusted.
 */
export function invoiceMetadata({ invoiceId, stayId, residentId }) {
  return { invoiceId, stayId, residentId }
}

/**
 * Whether an invoice is past due, and whether it has waited long enough to
 * shout. DERIVED on every read — the PRESENCE / CHECK_STATE rule.
 *
 * `settled` reads the LEDGER as well as Stripe, and that clause is
 * load-bearing rather than defensive: a resident pays $800 cash at the desk, a
 * manager posts a PAYMENT, and Stripe never hears about it. Without it the red
 * dot burns forever on somebody who is square, and staff learn the dot lies —
 * which costs more than the dot was ever worth.
 */
export function invoiceStatus(invoice, balanceCents, now = new Date()) {
  const settled =
    invoice.paidAt != null || invoice.voidedAt != null || balanceCents <= 0
  const overdue = invoice.finalizedAt != null && !settled && invoice.dueAt < now
  const daysPastDue = overdue ? Math.floor((now - invoice.dueAt) / DAY_MS) : 0
  return {
    settled,
    overdue,
    daysPastDue,
    // The alarm, not the arithmetic.
    dotDue: overdue && daysPastDue >= INVOICE_DOT_GRACE_DAYS,
  }
}

/** The unbilled lines of a stay: charges and credits with no invoice line. */
export async function unbilledFor(stayId) {
  return prisma.ledgerEntry.findMany({
    where: { stayId, type: { in: BILLABLE }, invoiceLine: { is: null } },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
}

/** Charges add, credits subtract. The net is what would be billed. */
export function netOf(entries) {
  return entries.reduce((t, e) => t + LEDGER_SIGN[e.type] * e.amountCents, 0)
}

/**
 * What a stay owes and where its invoicing stands — for the resident record
 * and the ledger section. One read.
 */
export async function stayInvoiceSummary(stayId) {
  if (!stayId) return null
  const [invoices, balanceCents, unbilled] = await Promise.all([
    prisma.invoice.findMany({
      where: { stayId },
      orderBy: { createdAt: 'desc' },
      include: { sentBy: { select: { id: true, fullName: true } } },
    }),
    balanceOfStay(stayId),
    unbilledFor(stayId),
  ])
  const now = new Date()
  const shaped = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    totalCents: i.totalCents,
    dueAt: i.dueAt,
    status: i.status,
    hostedUrl: i.hostedUrl,
    issuedAt: i.issuedAt,
    paidAt: i.paidAt,
    voidedAt: i.voidedAt,
    voidReason: i.voidReason,
    sentBy: i.sentBy,
    ...invoiceStatus(i, balanceCents, now),
  }))
  const overdue = shaped.filter((i) => i.overdue)
  return {
    invoices: shaped,
    unbilledCents: netOf(unbilled),
    unbilledCount: unbilled.length,
    overdue: overdue.length > 0,
    // The dot is the LOUDEST of them, not a count — the rail is a status
    // board, and two overdue invoices are not twice as red as one.
    dotDue: shaped.some((i) => i.dotDue),
    oldestDueAt: overdue.length ? overdue[overdue.length - 1].dueAt : null,
    overdueCents: overdue.reduce((t, i) => t + i.totalCents, 0),
  }
}

/**
 * Which of these stays carry an overdue invoice — ONE grouped query, for the
 * dashboard. The record and the dashboard read the same derivation, so they
 * cannot disagree; and module 14's rule forbids a per-resident loop in a
 * payload this heavily refetched.
 */
export async function overdueByStay(stayIds) {
  const ids = stayIds.filter(Boolean)
  if (ids.length === 0) return new Map()
  const now = new Date()
  const [open, balances] = await Promise.all([
    prisma.invoice.findMany({
      where: { stayId: { in: ids }, status: INVOICE_STATUS.OPEN, dueAt: { lt: now } },
      orderBy: { dueAt: 'asc' },
    }),
    balancesByStay(ids),
  ])
  const out = new Map()
  for (const inv of open) {
    const s = invoiceStatus(inv, balances.get(inv.stayId) ?? 0, now)
    if (!s.overdue) continue
    const prev = out.get(inv.stayId)
    // Oldest wins — it is the one that has been ignored longest.
    if (!prev || inv.dueAt < prev.dueAt) {
      out.set(inv.stayId, {
        invoiceId: inv.id,
        number: inv.number,
        dueAt: inv.dueAt,
        totalCents: inv.totalCents,
        daysPastDue: s.daysPastDue,
        dotDue: s.dotDue,
      })
    }
  }
  return out
}

/** Every invoice on a stay, newest first. */
export async function listInvoices(stayId) {
  const summary = await stayInvoiceSummary(stayId)
  return summary ?? { invoices: [], unbilledCents: 0, unbilledCount: 0 }
}

/**
 * Sweep a stay's unbilled lines into ONE invoice — the local half.
 *
 * Returns a DRAFT. The Stripe half runs afterwards and outside any
 * transaction: `runInTransaction` opens a Prisma interactive transaction, and
 * awaiting four Stripe round-trips inside one would pin a pooled connection
 * and trip the transaction timeout, leaving the ledger right and Stripe
 * holding an invoice nobody recorded.
 *
 * Committing the draft FIRST is what makes the whole thing safe: from that
 * instant the lines are billed and no second sweep can claim them, whatever
 * happens next. A crash before Stripe leaves a visible, resumable DRAFT rather
 * than a lost charge.
 */
export function draftInvoice(stayId, { dueAt }, actorId) {
  return runInTransaction(async () => {
    // Re-read INSIDE the transaction: two managers pressing Send at the same
    // instant both saw the same unbilled set a moment ago.
    const entries = await unbilledFor(stayId)
    if (entries.length === 0) {
      throw new HttpError(409, 'There is nothing unbilled on this stay.')
    }
    const totalCents = netOf(entries)
    if (totalCents <= 0) {
      throw new HttpError(
        409,
        'These lines net to zero or to a credit, so there is nothing to bill. They stay unbilled and will roll onto the next invoice.',
      )
    }

    const invoice = await prisma.invoice.create({
      data: {
        stayId,
        totalCents,
        dueAt,
        status: INVOICE_STATUS.DRAFT,
        sentById: actorId,
        lines: { create: entries.map((e) => ({ ledgerEntryId: e.id })) },
      },
      include: { lines: true },
    })
    return { invoice, entries }
  })
}

/**
 * The Stripe Customer for a PERSON, created lazily and exactly once.
 *
 * Name and email are the ONLY resident facts that cross — see lib/stripe.js
 * and CLAUDE.md's Compliance posture. `stripeCustomerId` is unique, so a race
 * between two managers pressing Send resolves to one Customer rather than
 * quietly doubling the disclosure.
 */
export async function ensureStripeCustomer(residentId) {
  const resident = await prisma.resident.findUnique({
    where: { id: residentId },
    select: { id: true, firstName: true, lastName: true, email: true, stripeCustomerId: true },
  })
  if (!resident) throw new HttpError(404, 'Resident not found')
  if (resident.stripeCustomerId) return resident.stripeCustomerId

  const customer = await stripe.customers.create(
    {
      name: `${resident.firstName} ${resident.lastName}`,
      ...(resident.email ? { email: resident.email } : {}),
      // Opaque only. Never a phase, a bed, or anything clinical.
      metadata: { residentId: resident.id },
    },
    { idempotencyKey: `cust:${resident.id}` },
  )

  try {
    await prisma.resident.update({
      where: { id: resident.id },
      data: { stripeCustomerId: customer.id },
    })
    return customer.id
  } catch (err) {
    // Another request won the race. Its Customer is the real one.
    if (err?.code === PRISMA.UNIQUE_VIOLATION) {
      const fresh = await prisma.resident.findUnique({
        where: { id: resident.id },
        select: { stripeCustomerId: true },
      })
      if (fresh?.stripeCustomerId) return fresh.stripeCustomerId
    }
    throw err
  }
}

/**
 * Push a drafted invoice to Stripe and open it.
 *
 * Runs OUTSIDE any transaction, after the draft has committed. Every call
 * carries a DETERMINISTIC idempotency key derived from our own invoice id —
 * never a random uuid, which is a nonce rather than an idempotency key. That
 * is what makes this safe to replay after a crash: the same key returns the
 * same Stripe object instead of creating a second one.
 */
export async function pushToStripe(invoiceId, entries) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { stay: { select: { id: true, residentId: true } } },
  })
  if (!invoice) throw new HttpError(404, 'Invoice not found')
  if (invoice.status !== INVOICE_STATUS.DRAFT) return invoice
  if (!stripeEnabled()) throw new HttpError(503, 'Stripe is not configured on this server.')

  const customerId = await ensureStripeCustomer(invoice.stay.residentId)
  const metadata = invoiceMetadata({
    invoiceId: invoice.id,
    stayId: invoice.stayId,
    residentId: invoice.stay.residentId,
  })

  const draft = await stripe.invoices.create(
    {
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 0, // Due on receipt (facility policy).
      // Explicit even though it is the default: without it a stray pending
      // invoice item — from a dashboard experiment, from a crashed run — is
      // swept into OUR invoice and totalCents silently stops matching Stripe.
      pending_invoice_items_behavior: 'exclude',
      metadata,
    },
    { idempotencyKey: `inv:${invoice.id}` },
  )

  for (const entry of entries) {
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: draft.id,
        currency: INVOICE_CURRENCY,
        // A credit is a negative line. The net was already checked positive.
        amount: LEDGER_SIGN[entry.type] * entry.amountCents,
        description: stripeLineLabel(entry),
        metadata: { ledgerEntryId: entry.id },
      },
      { idempotencyKey: `inv:${invoice.id}:line:${entry.id}` },
    )
  }

  const finalized = await stripe.invoices.finalizeInvoice(draft.id, {
    idempotencyKey: `inv:${invoice.id}:final`,
  })

  if (stripeEmailsInvoices()) {
    await stripe.invoices.sendInvoice(finalized.id, {
      idempotencyKey: `inv:${invoice.id}:send`,
    })
  }

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: INVOICE_STATUS.OPEN,
      stripeInvoiceId: finalized.id,
      number: finalized.number ?? null,
      hostedUrl: finalized.hosted_invoice_url ?? null,
      issuedAt: new Date(),
      finalizedAt: new Date(),
    },
  })
}

/** Draft, then push. The whole act, in the order that makes a crash survivable. */
export async function sendInvoice(stayId, { dueAt }, actorId) {
  const { invoice, entries } = await draftInvoice(stayId, { dueAt }, actorId)
  if (!stripeEnabled()) return invoice // A local invoice is still a real one.
  return pushToStripe(invoice.id, entries)
}

/** Resume a draft whose Stripe half never completed. Idempotent. */
export async function resumeSend(invoiceId) {
  const lines = await prisma.invoiceLine.findMany({
    where: { invoiceId },
    include: { ledgerEntry: true },
  })
  return pushToStripe(invoiceId, lines.map((l) => l.ledgerEntry))
}

/**
 * Void an invoice. Expensive on purpose: its lines are NEVER re-billable —
 * `invoice_lines` is unique and append-only, absolutely — so a mistake is
 * corrected the way everything else here is, with a CREDIT carrying
 * `correctsId` and fresh charges.
 */
export async function voidInvoice(invoiceId, reason) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) throw new HttpError(404, 'Invoice not found')
  if (invoice.status === INVOICE_STATUS.PAID) {
    throw new HttpError(409, 'A paid invoice cannot be voided. Refund it instead.')
  }
  if (invoice.status === INVOICE_STATUS.VOID) {
    throw new HttpError(409, 'This invoice is already void.')
  }
  if (invoice.stripeInvoiceId && stripeEnabled()) {
    await stripe.invoices.voidInvoice(invoice.stripeInvoiceId, {
      idempotencyKey: `inv:${invoice.id}:void`,
    })
  }
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: INVOICE_STATUS.VOID, voidedAt: new Date(), voidReason: reason },
  })
}

/**
 * Every active stay with something worth billing — the Friday button's list.
 *
 * A button rather than a cron, deliberately: this app has no scheduler and is
 * better for it. The dashboard nags once a Friday has passed so the button is
 * not silently forgotten, which is the honest trade — a human decides, and the
 * app makes forgetting visible.
 *
 * Discharged stays are skipped. A final invoice for somebody who has left is a
 * deliberate act, not something a weekly sweep should do on its own.
 */
export async function billableStays() {
  const stays = await prisma.stay.findMany({
    where: { status: STAY_STATUS.ACTIVE },
    select: { id: true, resident: { select: { id: true, firstName: true, lastName: true } } },
  })
  if (stays.length === 0) return []

  // ONE query for every unbilled line across every active stay, grouped in
  // memory. A loop calling unbilledFor() per stay would be a query per
  // resident — the thing module 14 forbids of the dashboard, and no better
  // here just because this list is smaller.
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      stayId: { in: stays.map((s) => s.id) },
      type: { in: BILLABLE },
      invoiceLine: { is: null },
    },
    select: { stayId: true, type: true, amountCents: true },
  })

  const byStay = new Map()
  for (const e of entries) {
    const acc = byStay.get(e.stayId) ?? { lineCount: 0, netCents: 0 }
    acc.lineCount += 1
    acc.netCents += LEDGER_SIGN[e.type] * e.amountCents
    byStay.set(e.stayId, acc)
  }

  return stays
    .map((stay) => {
      const acc = byStay.get(stay.id)
      if (!acc || acc.netCents <= 0) return null
      return {
        stayId: stay.id,
        residentId: stay.resident.id,
        residentName: `${stay.resident.firstName} ${stay.resident.lastName}`,
        ...acc,
      }
    })
    .filter(Boolean)
}
