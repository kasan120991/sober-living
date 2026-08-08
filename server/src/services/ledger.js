import { prisma, runInTransaction } from '../db/client.js'
import { isUniqueViolationOn } from '../lib/http.js'
import { facilityDayInstant } from '../lib/facilityTime.js'
import { HttpError } from '../middleware/authorize.js'
import {
  INVOICE_STATUS,
  LEDGER_ENTRY_TYPE,
  LEDGER_SIGN,
  NOTIFICATION_KIND,
  STAY_STATUS,
} from '../domain/constants.js'
import { notify } from './notify.js'

/**
 * The resident fee ledger.
 *
 * **A resident owes what has been INVOICED and not yet paid** (facility,
 * 2026-08-07). A charge or a credit is PENDING until an invoice picks it up,
 * and pending money is not part of the balance; a stay nobody has invoiced has
 * a balance of zero.
 *
 *     balance = Σ(invoice totals, excluding VOID and DRAFT) − Σ(payments)
 *     pending = Σ(unbilled charges) − Σ(unbilled credits)
 *
 * This REVERSES the original rule, which was `SUM(charges) − SUM(payments +
 * credits)` — every charge counted the moment it was posted. That is recorded
 * rather than deleted because it is what the ledger meant for its first week,
 * and because the failure that ended it is worth keeping: three months of rent
 * were charged and paid but never invoiced, so the Friday sweep — whose guard
 * is `charges + credits > 0`, not `balance > 0` — billed $2,055 at a resident
 * who owed $105. Under the new rule the two figures cannot diverge like that,
 * because the thing that makes money owed is the same thing that bills it.
 *
 * Two consequences worth knowing before touching this:
 *
 * - **A payment with nothing invoiced reads as a CREDIT**, a negative balance,
 *   and nets against the next invoice. Flooring it at zero was considered and
 *   rejected: it would hide money that was really received.
 * - **Voiding an invoice removes its demand.** That is why the balance is built
 *   from invoice TOTALS rather than from billed ledger lines — it is what gives
 *   a wrong invoice a real undo. The lines stay bound to it and are therefore
 *   still never re-billable, which is unchanged and still deliberate.
 *
 * Both figures are DERIVED on every read. A stored total is a second source of
 * truth, and the day it disagrees with the lines beneath it there is no way to
 * tell which one is wrong — `verify-ledger.js` asserts no balance column exists
 * anywhere, and that assertion survived this change untouched.
 *
 * Nothing here updates or deletes. The database refuses both — see the
 * `ledger_entries` migration — so a mistake is corrected by posting a new entry
 * that points at the one it fixes.
 */

/**
 * Invoices that count toward a balance.
 *
 * VOID is excluded because voiding is how a wrong invoice is undone. DRAFT is
 * excluded because it has not been issued — nobody has been asked for it yet.
 * A draft's lines ARE bound, so they are not pending either, which leaves its
 * money in neither figure: see `draftByStay`, which exists so that gap is
 * visible rather than silent.
 */
const COUNTED = [INVOICE_STATUS.OPEN, INVOICE_STATUS.PAID, INVOICE_STATUS.UNCOLLECTIBLE]

/**
 * Balances for many stays — TWO grouped queries, never one per resident
 * (module 14's rule; this feeds the most-refetched read in the app).
 *
 * @param {string[]} stayIds
 * @returns {Promise<Map<string, number>>} stayId → balance in cents, positive
 *   when the resident owes and negative when they are in credit
 */
export async function balancesByStay(stayIds) {
  const ids = stayIds.filter(Boolean)
  if (!ids.length) return new Map()

  const [invoiced, paid] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['stayId'],
      where: { stayId: { in: ids }, status: { in: COUNTED } },
      _sum: { totalCents: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['stayId'],
      where: { stayId: { in: ids }, type: LEDGER_ENTRY_TYPE.PAYMENT },
      _sum: { amountCents: true },
    }),
  ])

  const byStay = new Map(ids.map((id) => [id, 0]))
  for (const row of invoiced) {
    byStay.set(row.stayId, byStay.get(row.stayId) + (row._sum.totalCents ?? 0))
  }
  for (const row of paid) {
    byStay.set(row.stayId, byStay.get(row.stayId) - (row._sum.amountCents ?? 0))
  }
  return byStay
}

/**
 * Charges and credits with no invoice line yet — what WOULD be billed.
 *
 * Payments are never billable, so they are never pending either. The relation
 * filter is the whole definition: pending is the ABSENCE of an invoice line,
 * a read rather than a column on a table that refuses updates.
 *
 * @param {string[]} stayIds
 * @returns {Promise<Map<string, number>>} stayId → pending cents
 */
export const PENDING_WHERE = {
  type: { in: [LEDGER_ENTRY_TYPE.CHARGE, LEDGER_ENTRY_TYPE.CREDIT] },
  invoiceLine: { is: null },
}

/**
 * Which of these unbilled rows have been REMOVED — the one place that decides.
 *
 * A pending charge cannot be deleted: `ledger_entries` refuses DELETE by
 * trigger and by revoked privilege, and that is not negotiable. Removing one is
 * therefore a reversing CREDIT with `correctsId`, and BOTH rows live forever.
 * What "removed" buys is that neither is billable — the pair never reaches an
 * invoice, so a charge posted against the wrong resident is not something they
 * are asked to look at and query.
 *
 * The test is deliberately exact: same stay, opposite type, SAME amount, and
 * both still unbilled. A partial credit is an ordinary adjustment and must stay
 * billable, or waiving half a charge would silently waive all of it. And
 * because `rows` only ever contains unbilled entries, a reversal of an already
 * invoiced charge cannot match — which is right, since that money has been
 * demanded and the correction belongs on the next invoice.
 *
 * @param {{id: string, type: string, amountCents: number, correctsId: string|null}[]} rows
 * @returns {Set<string>} ids of every row in a removed pair, reversal included
 */
export function removedIds(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = new Set()
  for (const r of rows) {
    if (!r.correctsId) continue
    const target = byId.get(r.correctsId)
    if (!target) continue
    if (target.type === r.type) continue
    if (target.amountCents !== r.amountCents) continue
    out.add(target.id)
    out.add(r.id)
  }
  return out
}

export async function pendingByStay(stayIds) {
  const ids = stayIds.filter(Boolean)
  if (!ids.length) return new Map()

  // findMany rather than groupBy: whether a row is removed depends on ANOTHER
  // row, which no aggregate can express. The set is small by construction —
  // these are only the lines nobody has invoiced yet.
  const rows = await prisma.ledgerEntry.findMany({
    where: { stayId: { in: ids }, ...PENDING_WHERE },
    select: { id: true, stayId: true, type: true, amountCents: true, correctsId: true },
  })
  const gone = removedIds(rows)

  const byStay = new Map(ids.map((id) => [id, 0]))
  for (const r of rows) {
    if (gone.has(r.id)) continue
    byStay.set(r.stayId, byStay.get(r.stayId) + LEDGER_SIGN[r.type] * r.amountCents)
  }
  return byStay
}

/**
 * Money sitting on invoices nobody has sent.
 *
 * It is in neither the balance nor pending, which is exactly why it gets its
 * own figure: a send that dies between our commit and Stripe's finalize leaves
 * a recoverable DRAFT, and without this the charges on it would simply vanish
 * from both totals with nothing on any screen saying so.
 */
export async function draftByStay(stayIds) {
  const ids = stayIds.filter(Boolean)
  if (!ids.length) return new Map()

  const sums = await prisma.invoice.groupBy({
    by: ['stayId'],
    where: { stayId: { in: ids }, status: INVOICE_STATUS.DRAFT },
    _sum: { totalCents: true },
    _count: true,
  })

  const byStay = new Map(ids.map((id) => [id, { cents: 0, count: 0 }]))
  for (const row of sums) {
    byStay.set(row.stayId, { cents: row._sum.totalCents ?? 0, count: row._count })
  }
  return byStay
}

/** The single-stay cases, so callers do not have to unwrap a one-entry Map. */
export async function balanceOfStay(stayId) {
  return (await balancesByStay([stayId])).get(stayId) ?? 0
}

export async function pendingOfStay(stayId) {
  return (await pendingByStay([stayId])).get(stayId) ?? 0
}

/**
 * Every line on a stay, with the three figures that describe it.
 *
 * There is NO running balance any more. It was a cumulative fold over every
 * entry, which under the old rule was the balance — and under this one it is
 * not any figure at all: a pending charge does not move the balance, so a
 * column that advanced on one would have disagreed with the header on the very
 * next row. Balance and pending are stated once, at the top.
 */
export async function listEntries(stayId) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { stayId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    include: {
      recordedBy: { select: { id: true, fullName: true } },
      corrects: { select: { id: true, description: true, occurredAt: true } },
      // Billed-ness, in the SAME query. Prisma batches this for the whole set
      // rather than reading per row — and it is a to-ONE include only because
      // invoice_lines is unique on ledgerEntryId, which is that index doing a
      // third job beyond "a charge cannot be billed twice".
      invoiceLine: {
        select: {
          invoice: {
            select: { id: true, number: true, status: true, dueAt: true, hostedUrl: true },
          },
        },
      },
    },
  })

  // Removal is decided over the UNBILLED rows only, by the same helper the
  // figures use — so a row cannot render as removed while still counting
  // toward pending, or the other way round.
  const unbilled = entries.filter((e) => !e.invoiceLine && e.type !== LEDGER_ENTRY_TYPE.PAYMENT)
  const gone = removedIds(unbilled)
  const reversalOf = new Map(
    unbilled.filter((e) => gone.has(e.id) && e.correctsId).map((e) => [e.correctsId, e]),
  )

  const rows = entries.map((e) => {
    // "Pending" is the ABSENCE of an invoice line — a read, never a column on
    // this table, which refuses updates. Payments are never billable, so they
    // are never pending either.
    const billed = Boolean(e.invoiceLine)
    const reversal = reversalOf.get(e.id) ?? null
    return {
      id: e.id,
      type: e.type,
      category: e.category,
      amountCents: e.amountCents,
      description: e.description,
      occurredAt: e.occurredAt,
      externalRef: e.externalRef,
      corrects: e.corrects,
      recordedBy: e.recordedBy,
      recordedAt: e.createdAt,
      billed,
      invoice: e.invoiceLine?.invoice ?? null,
      // The pair, told apart: the original renders struck through with the
      // reason, and the reversal is hidden — it is the SAME fact stated twice
      // and two rows would read as two events. Both remain on the wire, and
      // both remain in the table forever; this only decides how they draw.
      removed: Boolean(reversal),
      removedBy: reversal && {
        at: reversal.createdAt,
        description: reversal.description,
        byName: reversal.recordedBy?.fullName ?? null,
      },
      isReversal: gone.has(e.id) && Boolean(e.correctsId) && !reversal,
    }
  })

  // The figures come from the same helpers every other screen reads, rather
  // than being folded out of these rows — one derivation, so the ledger
  // section and the roster cannot disagree about what somebody owes.
  const [balanceCents, pendingCents, drafts] = await Promise.all([
    balanceOfStay(stayId),
    pendingOfStay(stayId),
    draftByStay([stayId]),
  ])
  const draft = drafts.get(stayId) ?? { cents: 0, count: 0 }

  return {
    entries: rows.reverse(), // Newest first for display.
    balanceCents,
    pendingCents,
    draftCents: draft.cents,
    draftCount: draft.count,
  }
}

/**
 * Post a line. The only write this module has.
 *
 * @param {object} input
 * @param {string} actorId user id of the staff member recording it
 */
export async function postEntry(input, actorId) {
  const {
    stayId,
    type,
    category = null,
    amountCents,
    description,
    occurredAt,
    correctsId = null,
    externalRef = null,
  } = input

  const stay = await prisma.stay.findUnique({ where: { id: stayId }, select: { id: true, status: true } })
  if (!stay) throw new HttpError(404, 'Stay not found')

  // A discharged stay can still take entries: a final water bill or a payment
  // that lands after someone leaves is normal, and refusing it would push the
  // money into a note nobody can total. Bed assignments are the opposite case
  // and are closed at discharge — money outlives the bed.

  if (type === LEDGER_ENTRY_TYPE.CHARGE && !category) {
    throw new HttpError(400, 'A charge must say what it is for.')
  }
  if (type !== LEDGER_ENTRY_TYPE.CHARGE && category) {
    throw new HttpError(400, 'Only a charge carries a category.')
  }
  if (externalRef && type !== LEDGER_ENTRY_TYPE.PAYMENT) {
    throw new HttpError(400, 'A processor reference belongs to a payment.')
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'Amount must be a positive whole number of cents.')
  }

  if (correctsId) {
    const target = await prisma.ledgerEntry.findUnique({
      where: { id: correctsId },
      select: { id: true, stayId: true },
    })
    if (!target || target.stayId !== stayId) {
      throw new HttpError(400, 'A correction must reference an entry on the same stay.')
    }
  }

  try {
    // Reentrant — removePendingCharge() calls this from inside its own
    // transaction, and runInTransaction reuses an open one.
    return await runInTransaction(async () => {
      const entry = await prisma.ledgerEntry.create({
        data: {
          stayId,
          type,
          category,
          amountCents,
          description: description.trim(),
          // A date a manager typed is a facility calendar date, not UTC midnight.
          occurredAt: facilityDayInstant(occurredAt),
          correctsId,
          externalRef,
          recordedById: actorId,
        },
        include: { recordedBy: { select: { id: true, fullName: true } } },
      })

      // ONLY A PAYMENT. A charge is the facility asking for money and a credit
      // is the facility correcting itself — neither is news. Money arriving is,
      // and it is the one event here that can originate outside the building:
      // the Stripe webhook posts through this same function.
      //
      // THE DESCRIPTION NEVER CROSSES. It is unreviewed free text a manager
      // typed about a person, which is the same reason it never reaches Stripe
      // (see the compliance section: "a ledger description is unreviewed prose
      // entered in a hallway and can say anything at all").
      if (type === LEDGER_ENTRY_TYPE.PAYMENT) {
        const stay = await prisma.stay.findUnique({
          where: { id: stayId },
          select: { resident: { select: { firstName: true, lastName: true } } },
        })
        await notify(NOTIFICATION_KIND.PAYMENT_RECEIVED, {
          title: `Payment received — ${stay.resident.firstName} ${stay.resident.lastName}`,
          // Formatted HERE because the title and detail are STORED. Integer
          // cents are the wire format everywhere else; this is the one place
          // the server writes a money string, because a stored sentence
          // cannot be re-formatted by a client later.
          detail: `$${(amountCents / 100).toFixed(2)}`,
          actorId,
          entity: 'LedgerEntry',
          entityId: entry.id,
        })
      }

      return entry
    })
  } catch (err) {
    // A duplicate processor reference is the at-least-once webhook arriving
    // twice, not an error the caller can fix. Say so plainly; a handler should
    // treat it as "already recorded".
    // isUniqueViolationOn, not a hand-rolled meta.target read: Prisma 7's
    // driver adapter stopped populating that field, and this check had been
    // silently failing — the 409 below never fired and callers saw a 500.
    if (isUniqueViolationOn(err, 'externalRef')) {
      throw new HttpError(409, 'That payment has already been recorded.')
    }
    throw err
  }
}

/**
 * Remove a PENDING charge — by reversing it, because nothing here deletes.
 *
 * `ledger_entries` refuses DELETE by trigger and by revoked privilege, and that
 * is the guarantee the whole module rests on. So a removal is an ordinary
 * append: a CREDIT for the same amount pointing at the charge with
 * `correctsId`. Both rows are permanent and an auditor can see exactly what was
 * raised, when it was reversed and why.
 *
 * What removal earns is that the PAIR is not billable — `removedIds()` drops
 * both from pending, so neither reaches an invoice. A charge posted against the
 * wrong resident is not something they are then asked to look at and query.
 *
 * The service composes the entry rather than the caller: the amount, the type,
 * the date and whose ledger it lands on are all determined by the charge being
 * reversed, and the only thing a human supplies is the reason. That is module
 * 5's rule for when a service may post to the ledger directly.
 */
export async function removePendingCharge(stayId, entryId, reason, actorId) {
  const trimmed = (reason ?? '').trim()
  if (!trimmed) throw new HttpError(400, 'A removal needs a reason.')

  return runInTransaction(async () => {
    // Re-read INSIDE the transaction. Between a manager opening the dialog and
    // pressing Remove, the Friday run may have swept this very charge onto an
    // invoice — at which point it is money that has been demanded, and the
    // correction belongs on the next invoice rather than here.
    const entry = await prisma.ledgerEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        stayId: true,
        type: true,
        amountCents: true,
        description: true,
        occurredAt: true,
        invoiceLine: { select: { id: true } },
        correctedBy: { select: { id: true, type: true, amountCents: true } },
      },
    })
    if (!entry || entry.stayId !== stayId) throw new HttpError(404, 'Entry not found on this stay.')
    if (entry.type !== LEDGER_ENTRY_TYPE.CHARGE) {
      throw new HttpError(409, 'Only a charge can be removed.')
    }
    if (entry.invoiceLine) {
      throw new HttpError(
        409,
        'That charge has been invoiced, so it can no longer be removed. Post a credit against it instead.',
      )
    }
    const already = entry.correctedBy.some(
      (c) => c.type !== entry.type && c.amountCents === entry.amountCents,
    )
    if (already) throw new HttpError(409, 'That charge has already been removed.')

    return postEntry(
      {
        stayId,
        type: LEDGER_ENTRY_TYPE.CREDIT,
        amountCents: entry.amountCents,
        description: `Removed: ${trimmed}`,
        // The original's date, not today's — the reversal applies to the day
        // the charge did. Same rule as an apartment check's amendment carrying
        // `checkedAt` verbatim: it corrects what was recorded, never when.
        occurredAt: entry.occurredAt,
        correctsId: entry.id,
      },
      actorId,
    )
  })
}

/** The active stay for a resident, which is what the ledger UI operates on. */
export async function activeStayIdFor(residentId) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  return stay?.id ?? null
}
