import Stripe from 'stripe'

/**
 * The Stripe client — the ONE place this app talks to a payment processor.
 *
 * Note what this is not: the Stripe MCP server. That is a tool for a developer
 * configuring the sandbox from their editor; a running Node process cannot
 * reach it. The server uses the SDK with a key from the environment, and
 * nothing else.
 *
 * WHAT MAY CROSS THIS BOUNDARY is a 42 CFR Part 2 question, not a technical
 * one, and it is answered in CLAUDE.md's Compliance posture: as of 2026-08-06
 * a resident's legal name and email may go to Stripe, and nothing else about
 * them — no date of birth, no SSN fragment, no phone, no screen result, no
 * medication, no apartment, no program phase, and no free text a human typed.
 * Line labels come from STRIPE_LINE_LABEL and metadata from
 * invoiceMetadata(); neither takes a caller-supplied string. Do not widen
 * either without re-reading that section.
 */

const KEY = process.env.STRIPE_SECRET_KEY

if (!KEY && process.env.NODE_ENV === 'production') {
  // The APP_DATABASE_URL precedent: fail at boot rather than at the first
  // invoice, when a manager is standing there.
  throw new Error('STRIPE_SECRET_KEY is required in production.')
}

/** Null in development without a key, so callers can 503 legibly. */
export const stripe = KEY
  ? new Stripe(KEY, {
      // Pinned, not floating: an API version that moves under a running
      // deployment changes what a webhook payload looks like.
      apiVersion: '2026-07-29.dahlia',
      appInfo: { name: 'SoberLife', version: '0.1.0' },
    })
  : null

export const stripeEnabled = () => stripe !== null

/** Whether Stripe should email the invoice. Off unless explicitly enabled. */
export const stripeEmailsInvoices = () => process.env.STRIPE_EMAIL_INVOICES === 'true'

export const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET
