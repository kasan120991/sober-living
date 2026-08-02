/**
 * Money is integer cents everywhere — in the database, over the API, and in
 * these helpers. It becomes a decimal string exactly once, at the moment it is
 * rendered, and never goes back the other way in the browser: dollars are
 * parsed to cents on the server, where one rounding rule applies to everyone.
 */

/**
 * Cents → "$650.00". A credit renders in accounting parentheses rather than
 * with a minus sign, because a minus is easy to lose at the start of a column
 * of numbers and "(120.00)" is not.
 *
 * @param {number|null|undefined} cents
 * @param {{ zeroAs?: string }} [opts] what to show for an exactly square balance
 */
export function money(cents, { zeroAs = '$0.00' } = {}) {
  if (cents == null) return '—'
  if (cents === 0) return zeroAs
  const abs = (Math.abs(cents) / 100).toFixed(2)
  return cents < 0 ? `($${abs})` : `$${abs}`
}

/** True when the resident is ahead — a waived fee or an overpayment. */
export const inCredit = (cents) => typeof cents === 'number' && cents < 0

/** True when they owe something. Zero is neither owing nor in credit. */
export const owes = (cents) => typeof cents === 'number' && cents > 0

export const LEDGER_TYPES = [
  { label: 'Charge', value: 'CHARGE' },
  { label: 'Payment', value: 'PAYMENT' },
  { label: 'Credit', value: 'CREDIT' },
]

/** Mirrors the LedgerCategory enum in schema.prisma. Charges only. */
export const LEDGER_CATEGORIES = [
  { label: 'Rent', value: 'RENT' },
  { label: 'Laundry', value: 'LAUNDRY' },
  { label: 'Trip', value: 'TRIP' },
  { label: 'Program fee', value: 'PROGRAM_FEE' },
  { label: 'Damage', value: 'DAMAGE' },
  { label: 'Other', value: 'OTHER' },
]

export const categoryLabel = (v) =>
  LEDGER_CATEGORIES.find((c) => c.value === v)?.label ?? null
