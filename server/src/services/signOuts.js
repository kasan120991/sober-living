import { prisma } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { PRISMA } from '../lib/http.js'
import { PRESENCE, STAY_STATUS } from '../domain/constants.js'
import { passOverdueCutoff } from './passes.js'
import { facilityToday, facilityWallClockToUtc } from '../lib/facilityTime.js'
import { activeStayIdFor } from './ledger.js'

/**
 * Sign-outs: a resident leaves the property and returns the same day.
 *
 * A sign-out is OPEN until a staff member acknowledges the return. Presence is
 * derived from the open record against the clock, never stored.
 */

/**
 * How late past expectedReturnAt a resident may be before the app starts
 * shouting. Facility policy (chosen 2026-08-02): fifteen minutes — enough for
 * a walk back from the bus stop, not enough to hide a no-show.
 *
 * THE one knob. The pill, the bell, the census and this service all derive
 * overdue through overdueCutoff(), so changing it here changes it everywhere.
 * Note the "Overdue 2h 41m" label still measures from expectedReturnAt — grace
 * delays the alarm, not the arithmetic.
 */
export const OVERDUE_GRACE_MS = 15 * 60_000

/** Open sign-outs expected back before this instant are overdue. */
export function overdueCutoff(now = new Date()) {
  return new Date(now.getTime() - OVERDUE_GRACE_MS)
}

/**
 * Presence of an occupied bed, given its open sign-out and its covering travel
 * pass (either or both may be absent).
 *
 * THE one derivation, and it stays one on purpose: it has exactly two callers —
 * `rosterFor()` in checks and the census — and a second, parallel "are they
 * here" function is how those two screens come to disagree about a resident.
 * Module 9 extended this rather than adding `passPresenceOf()` beside it.
 *
 * A PASS OUTRANKS A SIGN-OUT when somehow both are open. That ordering is
 * deliberate: a multi-day sanctioned absence is the larger fact, and a stale
 * sign-out left open underneath one should not downgrade the display to "out
 * for the afternoon". The service refuses to open a sign-out during a pass, so
 * this is a belt-and-braces ordering rather than an expected state.
 */
export function presenceOf(openSignOut, now = new Date(), activePass = null) {
  if (activePass) {
    return {
      state:
        activePass.returnBy < passOverdueCutoff(now) ? PRESENCE.PASS_OVERDUE : PRESENCE.ON_PASS,
      // Dates, never the destination — the census tile is read over a
      // resident's shoulder. Whoever must CHASE an overdue pass gets the
      // destination from the bell and /passes, which are work queues.
      departAt: activePass.departAt,
      returnBy: activePass.returnBy,
    }
  }
  if (!openSignOut) return { state: PRESENCE.IN }
  return {
    state:
      openSignOut.expectedReturnAt < overdueCutoff(now) ? PRESENCE.OVERDUE : PRESENCE.OUT,
    outAt: openSignOut.outAt,
    expectedReturnAt: openSignOut.expectedReturnAt,
  }
}

const WITH_NAMES = {
  stay: {
    select: {
      id: true,
      resident: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  recordedBy: { select: { id: true, fullName: true } },
  returnAcknowledgedBy: { select: { id: true, fullName: true } },
}

function shape(s, now) {
  return {
    id: s.id,
    resident: {
      id: s.stay.resident.id,
      fullName: `${s.stay.resident.firstName} ${s.stay.resident.lastName}`,
    },
    destination: s.destination,
    purpose: s.purpose,
    outAt: s.outAt,
    expectedReturnAt: s.expectedReturnAt,
    returnedAt: s.returnedAt,
    overdue: !s.returnedAt && s.expectedReturnAt < overdueCutoff(now),
    recordedBy: s.recordedBy,
    returnAcknowledgedBy: s.returnAcknowledgedBy,
  }
}

/** Everyone out right now (most overdue first), plus recent returns. */
export async function listSignOuts() {
  const now = new Date()
  const [open, returned] = await Promise.all([
    prisma.signOut.findMany({
      where: { returnedAt: null },
      orderBy: { expectedReturnAt: 'asc' },
      include: WITH_NAMES,
    }),
    prisma.signOut.findMany({
      where: { returnedAt: { not: null } },
      orderBy: { returnedAt: 'desc' },
      take: 20,
      include: WITH_NAMES,
    }),
  ])
  return { open: open.map((s) => shape(s, now)), returned: returned.map((s) => shape(s, now)) }
}

/** Wall-clock date+time to an instant, with the facility's today as default. */
function instantFrom(dateStr, timeStr, fallback) {
  if (!timeStr) return fallback
  return facilityWallClockToUtc(dateStr ?? facilityToday(), timeStr)
}

export async function recordSignOut(input, actorId) {
  const stayId = await activeStayIdFor(input.residentId)
  if (!stayId) {
    throw new HttpError(409, 'This resident is not currently in the program.')
  }

  const now = new Date()
  const outAt = instantFrom(input.outDate, input.outTime, now)
  const expectedReturnAt = instantFrom(input.expectedReturnDate, input.expectedReturnTime)
  if (!(expectedReturnAt > outAt)) {
    throw new HttpError(400, 'The expected return must be after the out time.')
  }

  // Friendly message first; the partial unique index is the race-proof
  // backstop underneath it.
  const alreadyOut = await prisma.signOut.findFirst({
    where: { stayId, returnedAt: null },
    select: { id: true },
  })
  if (alreadyOut) {
    throw new HttpError(409, 'Already signed out. Acknowledge the return first.')
  }

  try {
    return await prisma.signOut.create({
      data: {
        stayId,
        destination: input.destination,
        purpose: input.purpose || null,
        outAt,
        expectedReturnAt,
        recordedById: actorId,
      },
      include: WITH_NAMES,
    })
  } catch (err) {
    // The raw index is invisible to Prisma, so match the code alone — this
    // catch is scoped to one insert with one unique constraint in play.
    if (err.code === PRISMA.UNIQUE_VIOLATION) {
      throw new HttpError(409, 'Already signed out. Acknowledge the return first.')
    }
    throw err
  }
}

export async function acknowledgeReturn(id, input, actorId) {
  const signOut = await prisma.signOut.findUnique({ where: { id } })
  if (!signOut) throw new HttpError(404, 'Sign-out not found')
  if (signOut.returnedAt) throw new HttpError(409, 'This return was already recorded.')

  const returnedAt = instantFrom(input.returnedDate, input.returnedTime, new Date())
  if (returnedAt < signOut.outAt) {
    throw new HttpError(400, 'The return cannot be before the out time.')
  }

  return prisma.signOut.update({
    where: { id },
    data: { returnedAt, returnAcknowledgedById: actorId },
    include: WITH_NAMES,
  })
}

/**
 * A sign-out recorded in error. Open records only — a completed return is
 * history and is never deleted. Soft: the row stays for the audit trail, and
 * the partial unique index ignores it, freeing the slot.
 */
export async function removeSignOut(id) {
  const signOut = await prisma.signOut.findUnique({ where: { id } })
  if (!signOut) throw new HttpError(404, 'Sign-out not found')
  if (signOut.returnedAt) {
    throw new HttpError(409, 'A completed sign-out is history and cannot be removed.')
  }
  return prisma.signOut.delete({ where: { id } })
}

/** Open sign-outs past the grace window, for the pill, the bell and census. */
export function overdueWhere(now = new Date()) {
  return {
    returnedAt: null,
    expectedReturnAt: { lt: overdueCutoff(now) },
    stay: { status: STAY_STATUS.ACTIVE },
  }
}
