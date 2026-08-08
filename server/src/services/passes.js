import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { PASS_GRACE_MS, PASS_STATUS, STAY_STATUS } from '../domain/constants.js'
import { facilityWallClockToUtc } from '../lib/facilityTime.js'

/**
 * Travel passes: an overnight or multi-day approved absence.
 *
 * THE BED IS HELD, and that costs nothing — this module writes nothing to
 * `bed_assignments`. Assignment is not presence (see BedAssignment's own note),
 * so the census renders "on pass" instead of a free tile purely by deriving
 * presence through presenceOf(). A pass that freed the bed would be a transfer,
 * and this is not one.
 *
 * Everything time-shaped is DERIVED on read — away-now, overdue, days
 * remaining — never stored. No cron, nothing to go stale: the PRESENCE /
 * CHECK_STATE / MED_DOSE_STATE pattern.
 */

/** Passes that have not been decided yet. */
const REQUESTED_ONLY = { status: PASS_STATUS.REQUESTED, deletedAt: null }

/** Approved and not yet closed — the ones that make somebody away. */
export const activeWhere = () => ({ status: PASS_STATUS.APPROVED, deletedAt: null })

const NAME = { select: { id: true, firstName: true, lastName: true } }
const WHO = { select: { id: true, fullName: true } }
const fullName = (r) => `${r.firstName} ${r.lastName}`

/**
 * A pass past this instant's return time is overdue.
 *
 * THE one knob. The passes page, the bell and the dashboard all derive through
 * it, so none of the three can disagree about who is late back. See
 * PASS_GRACE_MS for why an hour rather than the sign-out's fifteen minutes.
 */
export function passOverdueCutoff(now = new Date()) {
  return new Date(now.getTime() - PASS_GRACE_MS)
}

/**
 * Is this approved pass in force at `at`?
 *
 * DEPARTURE ONLY — `returnBy` deliberately does not close it. An approved pass
 * runs until somebody acknowledges the return or cancels it, so a resident who
 * is late back is still away.
 *
 * Bounding this by `returnBy` was the first version and it was wrong in the
 * worst direction: at the exact moment somebody became overdue they stopped
 * counting as absent, so the census dropped them back to "in", the hourly round
 * stopped pre-accounting them, and their medication doses became due again —
 * every one of which would then read MISSED. The alarm and the absence would
 * have contradicted each other precisely when the facility most needed them to
 * agree.
 */
export const coversInstant = (pass, at) => pass.departAt <= at

/**
 * Whether a stay may be granted a pass at all, and if not, WHICH rule refused.
 *
 * Derived from the program rather than stored on the pass: changing the phase
 * policy changes what is refused tomorrow with no backfill, and a pass approved
 * under an older rule keeps its own history instead of being retro-judged.
 *
 * Returns the reason as prose because the request dialog shows it BEFORE
 * somebody types a destination — "Phase 1 · day 12 of 90" is actionable, "not
 * eligible" is not.
 */
export function passEligibility(stay, now = new Date()) {
  if (!stay || stay.status !== STAY_STATUS.ACTIVE) {
    return { eligible: false, reason: 'This resident has no active stay.' }
  }
  const program = stay.program
  if (!program) {
    return { eligible: false, reason: 'This resident is not on a program.' }
  }
  // Null means the facility has not set a policy for this phase, and the
  // conservative reading of an unset privilege is that it is not granted —
  // the same posture as an unset service-hours target meaning "no target".
  if (program.passEligible !== true) {
    return {
      eligible: false,
      reason: `${program.name} is not eligible for travel passes.`,
    }
  }

  const minDays = program.minDaysBeforePass
  if (minDays) {
    const days = Math.floor((now.getTime() - stay.intakeAt.getTime()) / 86_400_000)
    if (days < minDays) {
      return {
        eligible: false,
        reason: `${program.name} needs ${minDays} days in the programme — this is day ${days}.`,
        days,
        minDays,
      }
    }
  }
  return { eligible: true, reason: null }
}

function shape(p, now) {
  const overdue =
    p.status === PASS_STATUS.APPROVED && p.returnBy < passOverdueCutoff(now)
  return {
    id: p.id,
    stayId: p.stayId,
    residentId: p.stay?.resident?.id ?? null,
    fullName: p.stay?.resident ? fullName(p.stay.resident) : null,
    destination: p.destination,
    purpose: p.purpose,
    departAt: p.departAt,
    returnBy: p.returnBy,
    status: p.status,
    overdue,
    /// Away RIGHT NOW rather than merely approved — an approved pass for next
    /// Friday is not an absence yet.
    away: p.status === PASS_STATUS.APPROVED && coversInstant(p, now),
    /// Approved but not departed yet — a pass for next Friday is not an absence.
    upcoming: p.status === PASS_STATUS.APPROVED && p.departAt > now,
    nights: Math.max(1, Math.round((p.returnBy - p.departAt) / 86_400_000)),
    requestedBy: p.requestedBy,
    reviewedBy: p.reviewedBy,
    reviewedAt: p.reviewedAt,
    reviewNote: p.reviewNote,
    returnedAt: p.returnedAt,
    returnAcknowledgedBy: p.returnAcknowledgedBy,
  }
}

const WITH_PEOPLE = {
  stay: { select: { id: true, resident: NAME } },
  requestedBy: WHO,
  reviewedBy: WHO,
  returnAcknowledgedBy: WHO,
}

/**
 * The passes board — one composed read, the /census and /service pattern.
 *
 * REVIEW QUEUE FIRST (variant A, chosen 2026-08-08 from three rendered
 * variants; a fortnight calendar and a filterable table were the others). A
 * request is the only thing here with somebody waiting on it — a resident who
 * does not yet know whether they can go — so it leads even on the days it is
 * empty. The calendar is the fallback once passes are frequent enough that
 * OVERLAP becomes the question, which no other layout answers.
 */
export async function housePasses({ now = new Date() } = {}) {
  const [requested, approved, recent] = await Promise.all([
    prisma.travelPass.findMany({
      where: REQUESTED_ONLY,
      include: WITH_PEOPLE,
      // Oldest first: the request that has waited longest is the one at risk of
      // never being answered. Same reasoning as the service queue.
      orderBy: { createdAt: 'asc' },
    }),
    prisma.travelPass.findMany({
      where: activeWhere(),
      include: WITH_PEOPLE,
      orderBy: { returnBy: 'asc' },
    }),
    prisma.travelPass.findMany({
      where: {
        deletedAt: null,
        status: { in: [PASS_STATUS.RETURNED, PASS_STATUS.DENIED, PASS_STATUS.CANCELLED] },
      },
      include: WITH_PEOPLE,
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ])

  const away = approved.map((p) => shape(p, now))
  return {
    now,
    graceMs: PASS_GRACE_MS,
    figures: {
      awaitingReview: requested.length,
      awayNow: away.filter((p) => p.away).length,
      overdue: away.filter((p) => p.overdue).length,
      upcoming: away.filter((p) => p.upcoming).length,
    },
    // Overdue first inside the away band: the loudest thing on the page.
    awaitingReview: requested.map((p) => shape(p, now)),
    away: away.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.returnBy - b.returnBy),
    recent: recent.map((p) => shape(p, now)),
  }
}

/**
 * Every stay that is away on a pass at `at`, as a Map keyed by stayId.
 *
 * The shared read behind all three integrations — the check roster, the med
 * board and the roll sheet. One query, so none of them can disagree about who
 * is away, and none of them grows a per-resident loop.
 */
export async function passesCovering(at, stayIds = null) {
  const rows = await prisma.travelPass.findMany({
    where: {
      ...activeWhere(),
      // No `returnBy` bound — see coversInstant(). An APPROVED pass is in force
      // until it is returned or cancelled, however late it runs.
      departAt: { lte: at },
      ...(stayIds ? { stayId: { in: [...stayIds] } } : {}),
    },
    select: { id: true, stayId: true, destination: true, departAt: true, returnBy: true },
  })
  return new Map(rows.map((p) => [p.stayId, p]))
}

/**
 * Approved passes touching a window — for a whole page of doses at once.
 *
 * Same rule as coversInstant(): departure bounds it and `returnBy` does not,
 * because a pass running late is still an absence. A dose during an overdue
 * pass stays suppressed rather than turning into a MISSED record of medication
 * the facility could not possibly have given.
 */
export async function passesOverlapping(from, to, stayIds = null) {
  return prisma.travelPass.findMany({
    where: {
      ...activeWhere(),
      departAt: { lte: to },
      ...(stayIds ? { stayId: { in: [...stayIds] } } : {}),
    },
    select: { id: true, stayId: true, departAt: true, returnBy: true },
  })
}

/** Overdue passes, for the bell and the dashboard — one knob, shared. */
export async function overduePasses(now = new Date()) {
  const rows = await prisma.travelPass.findMany({
    where: { ...activeWhere(), returnBy: { lt: passOverdueCutoff(now) } },
    include: WITH_PEOPLE,
    orderBy: { returnBy: 'asc' },
  })
  return rows.map((p) => shape(p, now))
}

/**
 * File a request. ALL-STAFF: the tech at the door is the one a resident asks,
 * and making them find a manager to type it is how a request never gets filed.
 * Deciding it is the manager's act, not recording it.
 *
 * Times cross the wire as facility WALL-CLOCK strings and are interpreted here,
 * the sign-outs rule — a manager filing from another timezone still writes
 * facility time.
 */
export async function requestPass(residentId, input, actorId) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    include: { program: true },
  })
  const eligibility = passEligibility(stay)
  if (!eligibility.eligible) throw new HttpError(409, eligibility.reason)

  const departAt = facilityWallClockToUtc(input.departDate, input.departTime)
  const returnBy = facilityWallClockToUtc(input.returnDate, input.returnTime)
  if (returnBy <= departAt) {
    throw new HttpError(400, 'The return has to be after the departure.')
  }

  // One live request or absence at a time. A second overlapping pass is almost
  // always a double-entry, and two approved absences over one window would make
  // "are they away" ambiguous for every derivation downstream.
  const clash = await prisma.travelPass.findFirst({
    where: {
      stayId: stay.id,
      deletedAt: null,
      status: { in: [PASS_STATUS.REQUESTED, PASS_STATUS.APPROVED] },
      departAt: { lte: returnBy },
      returnBy: { gte: departAt },
    },
  })
  if (clash) {
    throw new HttpError(409, 'This resident already has a pass covering those dates.')
  }

  return prisma.travelPass.create({
    data: {
      stayId: stay.id,
      destination: input.destination.trim(),
      purpose: input.purpose?.trim() || null,
      departAt,
      returnBy,
      requestedById: actorId,
    },
  })
}

/**
 * Approve or deny. MANAGERS — the same line every other judgement sits on.
 *
 * A denial REQUIRES a note, at the route, here, and in the database: a refusal
 * with no stated reason is what a resident appeals and the facility cannot
 * defend. Eligibility is re-checked at review, because a request can sit in the
 * queue across a phase change.
 */
export async function reviewPass(id, { approve, note }, actorId) {
  return runInTransaction(async () => {
    const pass = await prisma.travelPass.findFirst({
      where: { id, deletedAt: null },
      include: { stay: { include: { program: true } } },
    })
    if (!pass) throw new HttpError(404, 'Pass not found')
    if (pass.status !== PASS_STATUS.REQUESTED) {
      throw new HttpError(409, `This pass has already been ${pass.status.toLowerCase()}.`)
    }
    if (!approve && !note?.trim()) {
      throw new HttpError(400, 'A denial needs a reason.')
    }
    if (approve) {
      const eligibility = passEligibility(pass.stay)
      if (!eligibility.eligible) throw new HttpError(409, eligibility.reason)
    }

    return prisma.travelPass.update({
      where: { id },
      data: {
        status: approve ? PASS_STATUS.APPROVED : PASS_STATUS.DENIED,
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    })
  })
}

/**
 * Acknowledge a return. ALL-STAFF, exactly like a sign-out's return: the person
 * at the door is the one who sees them walk in.
 *
 * `returnedAt` is the SERVER CLOCK — a client-supplied time is an invitation to
 * back-date a late return into an on-time one, which is the whole fact this
 * record exists to hold.
 */
export async function returnPass(id, actorId) {
  const pass = await prisma.travelPass.findFirst({ where: { id, deletedAt: null } })
  if (!pass) throw new HttpError(404, 'Pass not found')
  if (pass.status !== PASS_STATUS.APPROVED) {
    throw new HttpError(409, 'Only an approved pass can be marked returned.')
  }
  return prisma.travelPass.update({
    where: { id },
    data: {
      status: PASS_STATUS.RETURNED,
      returnedAt: new Date(),
      returnAcknowledgedById: actorId,
    },
  })
}

/** Call off an approved pass. Managers, with a reason — the denial's twin. */
export async function cancelPass(id, { note }, actorId) {
  const pass = await prisma.travelPass.findFirst({ where: { id, deletedAt: null } })
  if (!pass) throw new HttpError(404, 'Pass not found')
  if (pass.status !== PASS_STATUS.APPROVED) {
    throw new HttpError(409, 'Only an approved pass can be cancelled.')
  }
  if (!note?.trim()) throw new HttpError(400, 'Cancelling a pass needs a reason.')
  return prisma.travelPass.update({
    where: { id },
    data: { status: PASS_STATUS.CANCELLED, reviewNote: note.trim() },
  })
}

/**
 * Withdraw a request filed in error — soft, and only while UNDECIDED.
 *
 * The sign-out shape: fixable in error, but only while nothing has been
 * recorded against it. Once a manager has approved or denied it, the decision
 * is what an auditor reads, and it stays.
 */
export async function withdrawPass(id) {
  const pass = await prisma.travelPass.findFirst({ where: { id, deletedAt: null } })
  if (!pass) throw new HttpError(404, 'Pass not found')
  if (pass.status !== PASS_STATUS.REQUESTED) {
    throw new HttpError(
      409,
      'This pass has been reviewed, so it is part of the record. Cancel it instead.',
    )
  }
  await prisma.travelPass.update({ where: { id }, data: { deletedAt: new Date() } })
  return { id }
}

/** One resident's passes — the record's rail section. Active stay only. */
export async function residentPasses(residentId, { now = new Date() } = {}) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    include: { program: true },
  })
  if (!stay) return { hasActiveStay: false, eligibility: null, passes: [] }

  const passes = await prisma.travelPass.findMany({
    where: { stayId: stay.id, deletedAt: null },
    include: WITH_PEOPLE,
    orderBy: { departAt: 'desc' },
  })
  return {
    hasActiveStay: true,
    stayId: stay.id,
    // Shown on the record so somebody can see WHY a request would be refused
    // before filing one — the same reason the dialog carries it.
    eligibility: passEligibility(stay, now),
    passes: passes.map((p) => shape(p, now)),
  }
}
