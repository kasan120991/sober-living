/**
 * Invoice vocabulary — COPIED from server/src/domain/constants.js, per the
 * convention. `overdue` and `dotDue` are deliberately absent: they are derived
 * on the server and arrive on the payload, because two implementations of
 * "is this person overdue" is how two screens come to disagree about somebody's
 * money.
 */
export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
})

/**
 * What a line is allowed to SAY on a Stripe invoice — mirrors
 * STRIPE_LINE_LABEL on the server. Shown in the send dialog so whoever presses
 * Send can see exactly what the resident will see, and that it is not the
 * wording they typed.
 */
export const STRIPE_LINE_LABEL = Object.freeze({
  RENT: 'Rent',
  LAUNDRY: 'Laundry',
  TRIP: 'Activity fee',
  PROGRAM_FEE: 'Program fee',
  DAMAGE: 'Property repair',
  LAB_FEE: 'Testing fee',
  OTHER: 'Program charge',
})

/** How an invoice's state reads, and which tone it carries. */
export function invoiceStatusDisplay(invoice) {
  if (invoice.status === INVOICE_STATUS.PAID) return { label: 'Paid', tone: 'success' }
  if (invoice.status === INVOICE_STATUS.VOID) return { label: 'Void', tone: 'muted' }
  if (invoice.status === INVOICE_STATUS.UNCOLLECTIBLE) {
    return { label: 'Uncollectible', tone: 'muted' }
  }
  if (invoice.status === INVOICE_STATUS.DRAFT) return { label: 'Not sent', tone: 'warning' }
  // OPEN — the only state where the clock matters.
  if (invoice.overdue) {
    return {
      label: `Overdue ${invoice.daysPastDue}d`,
      tone: 'destructive',
    }
  }
  return { label: 'Sent', tone: 'muted' }
}
