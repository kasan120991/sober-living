import { Router } from 'express'
import { prisma } from '../db/client.js'
import { handler, PRISMA } from '../lib/http.js'
import { runAsSystem } from '../lib/dbContext.js'
import { stripe, webhookSecret } from '../lib/stripe.js'
import { INVOICE_STATUS, LEDGER_ENTRY_TYPE, STRIPE_SYSTEM_EMAIL } from '../domain/constants.js'
import { postEntry } from '../services/ledger.js'

/**
 * Stripe's webhook — the only route in this app with no session.
 *
 * Four things about it are deliberate, and each one is a decision the app's
 * own structure forced:
 *
 *   1. THE RAW BODY. Stripe signs the exact bytes it sent; `express.json`
 *      parses and discards them, and a signature checked against a
 *      re-serialised object is a check against a different string. `app.js`
 *      mounts `express.raw` for this path ABOVE the global JSON parser.
 *   2. NO SESSION, AND THAT IS THE POINT. It mounts above sessionMiddleware,
 *      so a forged cookie can never establish an actor here. THE SIGNATURE IS
 *      THE AUTHENTICATION, and it is verified before any database access —
 *      CLAUDE.md module 12: "an unverified webhook is an unauthenticated write
 *      to a resident's balance."
 *   3. NO DB ACTOR. RLS is fail-closed and there is no session to derive one
 *      from, so the work runs inside runAsSystem().
 *   4. A NAME ON THE MONEY. `recordedById` is NOT NULL, and attributing a card
 *      payment to whoever happened to send the invoice would put their name on
 *      money they never touched — ServiceEntry's "never a change of verifier",
 *      in a different costume. A dormant system user carries it instead.
 *
 * And the rule that is easiest to get wrong: A DUPLICATE MUST RETURN 200.
 * Webhooks are delivered at least once. `externalRef` is unique so the second
 * delivery cannot post a second payment — but if this route answered 409,
 * Stripe would read "failed" and retry that same event forever.
 */
const router = Router()

/** The dormant account that owns machine-written ledger rows. */
async function systemUserId() {
  const user = await prisma.user.findUnique({
    where: { email: STRIPE_SYSTEM_EMAIL },
    select: { id: true },
  })
  if (user) return user.id
  // Upserted on first use so a fresh deploy that never ran the seed still
  // works. isActive false — it can never log in or hold a session.
  const created = await prisma.user.create({
    data: {
      email: STRIPE_SYSTEM_EMAIL,
      fullName: 'Stripe (automated)',
      role: 'STAFF',
      isActive: false,
      passwordHash: 'x', // Never compared: login refuses an inactive user first.
    },
    select: { id: true },
  })
  return created.id
}

/** Ours by Stripe's id, or by the metadata we set when we created it. */
async function localInvoiceFor(stripeInvoice) {
  const byId = stripeInvoice.id
    ? await prisma.invoice.findUnique({ where: { stripeInvoiceId: stripeInvoice.id } })
    : null
  if (byId) return byId
  const metaId = stripeInvoice.metadata?.invoiceId
  return metaId ? prisma.invoice.findUnique({ where: { id: metaId } }) : null
}

async function onPaid(stripeInvoice) {
  const invoice = await localInvoiceFor(stripeInvoice)
  if (!invoice) return // Not ours — a dashboard-created invoice, say.

  // The PAYMENT id, not the invoice id: an invoice paid in instalments is two
  // real payments and must be two rows, while a redelivered event is one.
  const paymentId =
    stripeInvoice.payment_intent ?? stripeInvoice.charge ?? `inv_${stripeInvoice.id}`

  try {
    await postEntry(
      {
        stayId: invoice.stayId,
        type: LEDGER_ENTRY_TYPE.PAYMENT,
        amountCents: stripeInvoice.amount_paid,
        description: 'Card payment',
        occurredAt: stripeInvoice.status_transitions?.paid_at
          ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
          : new Date(),
        externalRef: `stripe_${paymentId}`,
      },
      await systemUserId(),
    )
  } catch (err) {
    // 409 from the unique index IS the guard working. Swallow it: the row
    // already exists, so the outcome the caller wanted is already true.
    if (err?.status !== 409) throw err
  }

  if (invoice.status === INVOICE_STATUS.OPEN) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: INVOICE_STATUS.PAID, paidAt: new Date() },
    })
  }
}

/**
 * The reconciliation backstop. If our process died after Stripe finalized but
 * before we stored the ids, this fills them in and the invoice heals itself
 * without anybody pressing anything.
 */
async function onFinalized(stripeInvoice) {
  const invoice = await localInvoiceFor(stripeInvoice)
  if (!invoice || invoice.status !== INVOICE_STATUS.DRAFT) return
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: INVOICE_STATUS.OPEN,
      stripeInvoiceId: stripeInvoice.id,
      number: stripeInvoice.number ?? null,
      hostedUrl: stripeInvoice.hosted_invoice_url ?? null,
      issuedAt: new Date(),
      finalizedAt: new Date(),
    },
  })
}

async function onClosed(stripeInvoice, status) {
  const invoice = await localInvoiceFor(stripeInvoice)
  if (!invoice || invoice.status !== INVOICE_STATUS.OPEN) return
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status,
      ...(status === INVOICE_STATUS.VOID
        ? { voidedAt: new Date(), voidReason: 'Voided in Stripe' }
        : {}),
    },
  })
}

export async function handleStripeEvent(event) {
  // Seen-before check and the effect share one transaction, so every handler
  // is idempotent — not only the one that happens to have a unique index
  // behind it. A replayed invoice.voided would otherwise be a second UPDATE.
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
  } catch (err) {
    if (err?.code === PRISMA.UNIQUE_VIOLATION) return // Seen; nothing to redo.
    throw err
  }

  const object = event.data.object
  if (event.type === 'invoice.paid') await onPaid(object)
  else if (event.type === 'invoice.finalized') await onFinalized(object)
  else if (event.type === 'invoice.voided') await onClosed(object, INVOICE_STATUS.VOID)
  else if (event.type === 'invoice.marked_uncollectible') {
    await onClosed(object, INVOICE_STATUS.UNCOLLECTIBLE)
  }
  // invoice.payment_failed writes NOTHING: no money moved, and a declined card
  // is not something a tech in a hallway can act on. It surfaces on its own
  // when the invoice goes past due, which is the honest signal. Deliberately
  // not a bell item — module 13's rule.
}

router.post(
  '/',
  handler(async (req, res) => {
    if (!stripe || !webhookSecret()) {
      return res.status(503).json({ error: 'Stripe is not configured.' })
    }

    let event
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.get('stripe-signature'),
        webhookSecret(),
      )
    } catch {
      // 400, never 500: a forgery should not be retried, and a retry storm is
      // what a 5xx would buy.
      return res.status(400).json({ error: 'Invalid signature' })
    }

    await runAsSystem(() => handleStripeEvent(event))
    res.json({ received: true })
  }),
)

export default router
