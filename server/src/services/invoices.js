import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { isUniqueViolationOn } from '../lib/http.js'
import {
  INVOICE_CURRENCY,
  INVOICE_NET_DAYS,
  INVOICE_STATUS,
  LEDGER_ENTRY_TYPE,
  LEDGER_SIGN,
  NOTIFICATION_KIND,
  STAY_STATUS,
  STRIPE_LINE_LABEL,
} from '../domain/constants.js'
import { notify } from './notify.js'
import { facilityDueDate } from '../lib/facilityTime.js'
import { stripe, stripeEmailsInvoices, stripeEnabled } from '../lib/stripe.js'
import { balanceOfStay, balancesByStay, draftByStay, removedIds } from './ledger.js'

/**
 * Invoices — module 11's second half, and the thing that finally gives
 * "overdue" a meaning.
 *
 * A charge is PENDING until an invoice sweeps it, and pending is the ABSENCE
 * of an `invoice_lines` row — never a column on the ledger, which refuses
 * updates by trigger and by revoked privilege. That was chosen over relaxing
 * the trigger for "only this one column, only null → value", which is exactly
 * how an append-only table stops being append-only.
 *
 * Since 2026-08-07 an invoice is also what makes money OWED: the balance is
 * this module's own totals minus payments, so pending charges sit outside it
 * until they are billed. See the header of `services/ledger.js` for why, and
 * for the failure that forced it.
 *
 * Nothing here stores a balance. `Invoice.totalCents` is a SNAPSHOT of what was
 * billed on the day it was sent, and the migration puts it outside the UPDATE
 * grant so it cannot move — which is what makes it a snapshot rather than a
 * cache, since a cache is by definition something that gets recomputed. That
 * immutability is now load-bearing twice over: the balance is built from these
 * totals, so a movable one would silently rewrite what a resident owes.
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
  // There is deliberately no `dotDue` any more. It was `overdue` plus a 7-day
  // grace, which existed only because invoices were due on receipt and were
  // therefore overdue on arrival. The term carries the grace now, so the record's
  // red dot is exactly `overdue` — one fact, one name, nothing to drift.
  return { settled, overdue, daysPastDue }
}

/**
 * The PENDING lines of a stay: charges and credits with no invoice line, MINUS
 * any that have been removed.
 *
 * This is what the sweep bills, so the exclusion has to happen here and not
 * only in the figures — otherwise a charge the ledger shows as removed would
 * still land on the resident's next invoice, which is the whole thing removal
 * exists to prevent. `removedIds()` is the one place that decides.
 */
export async function pendingFor(stayId) {
  const rows = await prisma.ledgerEntry.findMany({
    where: { stayId, type: { in: BILLABLE }, invoiceLine: { is: null } },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  const gone = removedIds(rows)
  return rows.filter((r) => !gone.has(r.id))
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
  const [invoices, balanceCents, unbilled, drafts] = await Promise.all([
    prisma.invoice.findMany({
      where: { stayId },
      orderBy: { createdAt: 'desc' },
      include: { sentBy: { select: { id: true, fullName: true } } },
    }),
    balanceOfStay(stayId),
    pendingFor(stayId),
    draftByStay([stayId]),
  ])
  const draft = drafts.get(stayId) ?? { cents: 0, count: 0 }
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
    balanceCents,
    pendingCents: netOf(unbilled),
    pendingCount: unbilled.length,
    // Money on an invoice nobody sent — in neither figure above, so it is
    // stated rather than left to vanish. See `draftByStay`.
    draftCents: draft.cents,
    draftCount: draft.count,
    // A resident who has paid more than has been invoiced. The send surfaces
    // warn on it, because the invoice will still demand the full amount: the
    // credit lives in our ledger and Stripe has never heard of it.
    creditCents: balanceCents < 0 ? -balanceCents : 0,
    // The rail's red dot reads THIS. It is a boolean rather than a count — the
    // rail is a status board, and two overdue invoices are not twice as red as
    // one. It was `dotDue` until 2026-08-07, when the payment term took over
    // the job that field's grace period was doing.
    overdue: overdue.length > 0,
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
      })
    }
  }
  return out
}

/**
 * EVERY overdue invoice across the facility, oldest first — the billing
 * screen's chase list.
 *
 * Deliberately not `overdueByStay`, which keeps only the oldest per stay
 * because the dashboard and the rail's dot each need a single answer. A chase
 * list needs them all: a resident carrying two past-due invoices has a second
 * one that is real money, and showing one of them is showing less than is owed.
 *
 * It derives through the same `invoiceStatus()` as everything else, so this
 * screen cannot disagree with the record's red dot about who is late.
 */
export async function overdueInvoices() {
  const now = new Date()
  const open = await prisma.invoice.findMany({
    where: { status: INVOICE_STATUS.OPEN, dueAt: { lt: now } },
    orderBy: { dueAt: 'asc' },
    include: {
      stay: {
        select: {
          id: true,
          resident: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  })
  if (!open.length) return []

  const balances = await balancesByStay(open.map((i) => i.stayId))
  return open
    .map((inv) => {
      const s = invoiceStatus(inv, balances.get(inv.stayId) ?? 0, now)
      // `settled` reads the ledger too, so a resident who paid cash at the desk
      // drops off this list without anybody touching the invoice.
      if (!s.overdue) return null
      return {
        invoiceId: inv.id,
        stayId: inv.stayId,
        residentId: inv.stay.resident.id,
        residentName: `${inv.stay.resident.firstName} ${inv.stay.resident.lastName}`,
        number: inv.number,
        totalCents: inv.totalCents,
        dueAt: inv.dueAt,
        hostedUrl: inv.hostedUrl,
        daysPastDue: s.daysPastDue,
      }
    })
    .filter(Boolean)
}

/** Every invoice on a stay, newest first. */
export async function listInvoices(stayId) {
  const summary = await stayInvoiceSummary(stayId)
  return (
    summary ?? {
      invoices: [],
      balanceCents: 0,
      pendingCents: 0,
      pendingCount: 0,
      draftCents: 0,
      draftCount: 0,
      creditCents: 0,
    }
  )
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
    const entries = await pendingFor(stayId)
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
    if (isUniqueViolationOn(err, 'stripeCustomerId')) {
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
      // OUR due date, as an explicit instant — never `days_until_due`, which
      // makes Stripe count from ITS finalization moment. Ours is the end of a
      // facility day; Stripe's would be a different clock and could name a
      // different date on the hosted page than the ledger shows.
      due_date: Math.floor(invoice.dueAt.getTime() / 1000),
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

  // Note the EMPTY params object: these SDK methods are (id, params, options),
  // so passing the idempotency key second sends it to Stripe as a body
  // parameter and the call is rejected outright.
  const finalized = await stripe.invoices.finalizeInvoice(
    draft.id,
    {},
    { idempotencyKey: `inv:${invoice.id}:final` },
  )

  if (stripeEmailsInvoices()) {
    await stripe.invoices.sendInvoice(
      finalized.id,
      {},
      { idempotencyKey: `inv:${invoice.id}:send` },
    )
  }

  // The notification rides with the status flip rather than with the draft:
  // a DRAFT is money in neither the balance nor pending, so it is not yet news.
  // What is news is the moment the invoice becomes a demand.
  return runInTransaction(async () => {
    const open = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: INVOICE_STATUS.OPEN,
        stripeInvoiceId: finalized.id,
        number: finalized.number ?? null,
        hostedUrl: finalized.hosted_invoice_url ?? null,
        issuedAt: new Date(),
        finalizedAt: new Date(),
      },
      include: { stay: { select: { resident: { select: { firstName: true, lastName: true } } } } },
    })

    await notify(NOTIFICATION_KIND.INVOICE_SENT, {
      title: `Invoice sent — ${open.stay.resident.firstName} ${open.stay.resident.lastName}`,
      detail: `$${(open.totalCents / 100).toFixed(2)}`,
      // The invoice records who sent it, so pushToStripe needs no actorId
      // parameter — and this is also correct on the RESUME path, where a
      // different manager may be replaying somebody else's stranded draft.
      actorId: open.sentById,
      entity: 'Invoice',
      entityId: open.id,
    })

    return open
  })
}

/**
 * Everything that can be known to fail BEFORE anything is billed.
 *
 * This matters more than it looks. Once `draftInvoice` commits, its lines are
 * billed forever and a void does not give them back — so a failure after that
 * point strands real charges on an invoice that may never send. Anything
 * checkable belongs here, in front of the commit.
 */
async function preflight(stayId) {
  // A server with no Stripe key REFUSES rather than quietly making a local
  // invoice. It used to return the DRAFT and a 200, which is indistinguishable
  // from a real send at the UI: the lines came back billed and locked, staff
  // got a success toast, and the invoice would never exist. That happened for
  // real on 2026-08-07, when a merge left the keys behind in a worktree.
  //
  // A draft is also money in NEITHER the balance nor pending, so the silent
  // version did not even show up as something owed.
  if (!stripeEnabled()) {
    throw new HttpError(
      503,
      'Stripe is not configured on this server, so an invoice cannot be sent. Nothing has been billed.',
    )
  }
  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: { resident: { select: { id: true, email: true } } },
  })
  if (!canHostInvoice(stay?.resident)) {
    throw new HttpError(
      409,
      'Stripe needs an email address to host an invoice, and this resident has none on file. Add one to their record and send again.',
    )
  }
}

/**
 * Can Stripe host an invoice for this resident?
 *
 * Stripe's hosted invoicing requires an email on the Customer, and only a NAME
 * is required at intake — so a resident without one is ORDINARY, not an error
 * state, and this has to read as a missing fact rather than a fault.
 *
 * Pure, so the rule is assertable without a Stripe key, and so the UI can
 * disable the button for the same reason the server would refuse.
 *
 * @param {{ email?: string | null } | null | undefined} resident
 */
export function canHostInvoice(resident) {
  return Boolean(resident?.email?.trim())
}

/**
 * Draft, then push. The whole act, in the order that makes a crash survivable.
 *
 * The payment term is defaulted HERE rather than at the route, because both the
 * per-resident send and the Friday run call this — a default at each call site
 * is two knobs that will eventually disagree about what "net 3" means. An
 * explicit `dueAt` still wins, so a manager can agree different terms on one
 * invoice.
 */
export async function sendInvoice(stayId, { dueAt } = {}, actorId) {
  // The preflight refuses a keyless server, so by here Stripe is configured.
  await preflight(stayId)
  const { invoice, entries } = await draftInvoice(
    stayId,
    { dueAt: dueAt ?? facilityDueDate(new Date(), INVOICE_NET_DAYS) },
    actorId,
  )
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
    await stripe.invoices.voidInvoice(
      invoice.stripeInvoiceId,
      {},
      { idempotencyKey: `inv:${invoice.id}:void` },
    )
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
    select: {
      id: true,
      resident: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  if (stays.length === 0) return []

  // ONE query for every unbilled line across every active stay, grouped in
  // memory. A loop calling pendingFor() per stay would be a query per
  // resident — the thing module 14 forbids of the dashboard, and no better
  // here just because this list is smaller.
  const [entries, balances] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        stayId: { in: stays.map((s) => s.id) },
        type: { in: BILLABLE },
        invoiceLine: { is: null },
      },
      // id and correctsId are here for `removedIds` — a removed pair must not
      // be counted into the Friday run's figures either, or the preview would
      // promise money the sweep then declines to bill.
      select: { id: true, stayId: true, type: true, amountCents: true, correctsId: true },
    }),
    // For the credit warning below — also grouped, for the same reason.
    balancesByStay(stays.map((s) => s.id)),
  ])
  const gone = removedIds(entries)

  const byStay = new Map()
  for (const e of entries) {
    if (gone.has(e.id)) continue
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
        // The EMAIL ITSELF never leaves the server — only whether there is one.
        // The Friday run's preview has to be honest about which stays will
        // fail, and a name beside an address is more disclosure than the
        // question needs.
        canInvoice: canHostInvoice(stay.resident),
        // Money already received beyond what has been invoiced. The run still
        // bills the full net — Stripe has never heard of the credit — so the
        // preview names it rather than letting a resident discover it.
        creditCents: Math.max(0, -(balances.get(stay.id) ?? 0)),
        ...acc,
      }
    })
    .filter(Boolean)
}
