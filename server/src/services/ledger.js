import { prisma } from '../db/client.js'
import { isUniqueViolationOn } from '../lib/http.js'
import { facilityWallClockToUtc } from '../lib/facilityTime.js'
import { HttpError } from '../middleware/authorize.js'
import { LEDGER_ENTRY_TYPE, LEDGER_SIGN, STAY_STATUS } from '../domain/constants.js'

/**
 * The resident fee ledger.
 *
 * A balance is never stored. It is SUM(charges) - SUM(payments + credits),
 * computed from the entries every time it is asked for, because the entries are
 * the evidence and the balance is only their sum. A stored total is a second
 * source of truth, and the day it disagrees with the lines beneath it there is
 * no way to tell which one is wrong.
 *
 * Nothing here updates or deletes. The database refuses both — see the
 * `ledger_entries` migration — so a mistake is corrected by posting a new entry
 * that points at the one it fixes.
 */

/** Cents, positive when the resident owes, negative when they are in credit. */
function foldBalance(rows) {
  return rows.reduce((total, r) => total + LEDGER_SIGN[r.type] * (r._sum.amountCents ?? 0), 0)
}

/**
 * Balances for many stays in one query — the roster needs one per row, and a
 * per-row query would be a dozen round trips to render one table.
 *
 * @param {string[]} stayIds
 * @returns {Promise<Map<string, number>>} stayId → balance in cents
 */
export async function balancesByStay(stayIds) {
  const ids = stayIds.filter(Boolean)
  if (!ids.length) return new Map()

  const sums = await prisma.ledgerEntry.groupBy({
    by: ['stayId', 'type'],
    where: { stayId: { in: ids } },
    _sum: { amountCents: true },
  })

  const byStay = new Map(ids.map((id) => [id, 0]))
  for (const row of sums) {
    byStay.set(row.stayId, byStay.get(row.stayId) + LEDGER_SIGN[row.type] * (row._sum.amountCents ?? 0))
  }
  return byStay
}

/** The single-stay case, so callers do not have to unwrap a one-entry Map. */
export async function balanceOfStay(stayId) {
  const sums = await prisma.ledgerEntry.groupBy({
    by: ['type'],
    where: { stayId },
    _sum: { amountCents: true },
  })
  return foldBalance(sums)
}

/**
 * Every line on a stay, oldest first, with a running balance attached so the
 * UI does not have to recompute it and risk a different answer from the total.
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

  let running = 0
  let unbilledCents = 0
  const rows = entries.map((e) => {
    running += LEDGER_SIGN[e.type] * e.amountCents
    // "Unbilled" is the ABSENCE of an invoice line — a read, never a column
    // on this table, which refuses updates. Payments are never billable, so
    // they are never unbilled either.
    const billed = Boolean(e.invoiceLine)
    if (!billed && e.type !== LEDGER_ENTRY_TYPE.PAYMENT) {
      unbilledCents += LEDGER_SIGN[e.type] * e.amountCents
    }
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
      runningCents: running,
      billed,
      invoice: e.invoiceLine?.invoice ?? null,
    }
  })

  // Newest first for display; the running balance was computed oldest first,
  // which is the only order in which a running total means anything.
  return { entries: rows.reverse(), balanceCents: running, unbilledCents }
}

/**
 * The instant to store for `occurredAt`, which is a DATE wearing a DateTime.
 *
 * A bare 'YYYY-MM-DD' from the form is a FACILITY calendar date, and
 * `new Date('2026-08-06')` reads it as UTC midnight — which is 8pm on the 5th
 * in New York. So an entry a manager dated the 6th was stored as, and read
 * back as, the 5th. It is anchored at facility NOON instead: far enough from
 * either midnight that the stored instant falls on the intended day whether it
 * is later read on the facility clock or in UTC, which is what stops this
 * drifting back the next time somebody reaches for the wrong helper. Noon is
 * also the convention the seed already uses.
 *
 * A real instant (Stripe's `paid_at`) is left exactly as it is — that is a
 * moment, not a calendar date, and `facilityDateOf` renders it on the right
 * day already.
 */
export function occurredAtInstant(value) {
  if (!value) return new Date()
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return facilityWallClockToUtc(value.trim(), '12:00')
  }
  return new Date(value)
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
    return await prisma.ledgerEntry.create({
      data: {
        stayId,
        type,
        category,
        amountCents,
        description: description.trim(),
        occurredAt: occurredAtInstant(occurredAt),
        correctsId,
        externalRef,
        recordedById: actorId,
      },
      include: { recordedBy: { select: { id: true, fullName: true } } },
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

/** The active stay for a resident, which is what the ledger UI operates on. */
export async function activeStayIdFor(residentId) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  return stay?.id ?? null
}
