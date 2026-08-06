/**
 * Community service hours.
 *
 * Three properties do the work, and each has a cheaper version that fails:
 *
 * 1. **Only VERIFIED hours count.** A logged hour is a claim; a verified hour is
 *    an attestation by a staff member who saw the slip. Once residents submit
 *    from the portal, counting unverified hours would let the target be met by
 *    self-report.
 *
 * 2. **Nothing is ever edited.** A mistake is corrected by an AMENDMENT — a new
 *    row pointing at the original with a reason — and the database refuses both
 *    UPDATE (except the one verification transition) and DELETE. A void is an
 *    amendment to zero minutes.
 *
 * 3. **The total is derived, never stored.** Same rule as the ledger balance:
 *    a stored total is a second source of truth, and the day it disagrees with
 *    the rows beneath it there is no way to tell which one is wrong.
 *
 * Minutes everywhere. Hours are a display unit, parsed once at the route
 * boundary — the ledger's integer-cents reasoning, applied to time.
 */
import { prisma } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import {
  MONTHLY_SERVICE_QUOTA_HOURS,
  SERVICE_DAYS_PER_MONTH,
  STAY_STATUS,
} from '../domain/constants.js'

/**
 * The pace rule. PURE — no database, and no clock beyond the `dayOfStay` handed
 * in — so it can be asserted without a database and cannot drift between the
 * resident record and any other screen. Same discipline as
 * services/schedule/expand.js, and for the same reason.
 *
 * Two details that are the whole rule:
 *
 * - Expectation accrues in WHOLE MONTHLY STEPS. Continuous accrual (20 × days/30)
 *   would make a resident 0.7 hours behind on day two and amber on day three,
 *   which is exactly the noisy-dot failure CLAUDE.md warns about twice. Whole
 *   steps make the first month grace by construction rather than by a second knob.
 *
 * - Expectation is CAPPED at the target. Without the cap, somebody who finished
 *   all 80 hours in month two goes amber in month five because 20 × 5 > 80 — a
 *   dot on a resident who is done, which is how a dot stops being read.
 */
export function servicePace({ dayOfStay, requiredHours, verifiedMinutes }) {
  if (requiredHours == null) {
    // No target means no bar and no dot. Absence of a signal means fine — the
    // same rule the census tiles and the rail follow.
    return {
      requiredMinutes: null,
      expectedMinutes: 0,
      behindMinutes: 0,
      behind: false,
      monthsElapsed: 0,
    }
  }

  const requiredMinutes = requiredHours * 60
  // Day 1 is zero months, so nobody is behind on their intake day.
  const monthsElapsed = Math.max(0, Math.floor((dayOfStay - 1) / SERVICE_DAYS_PER_MONTH))
  const expectedMinutes = Math.min(
    requiredMinutes,
    MONTHLY_SERVICE_QUOTA_HOURS * 60 * monthsElapsed,
  )
  const behindMinutes = Math.max(0, expectedMinutes - verifiedMinutes)

  return {
    requiredMinutes,
    expectedMinutes,
    behindMinutes,
    behind: behindMinutes > 0,
    monthsElapsed,
  }
}

/** The current view: entries nothing has amended. */
const CURRENT_ONLY = { supersededBy: { is: null } }

const WITH_PEOPLE = {
  recordedBy: { select: { id: true, fullName: true } },
  verifiedBy: { select: { id: true, fullName: true } },
  supersedes: { select: { id: true, minutes: true, workedOn: true, location: true } },
}

/**
 * Verified and pending minutes for many stays in one query.
 *
 * The roster shape, mirroring balancesByStay: one grouped query rather than a
 * round trip per row. Superseded rows are excluded in JS rather than in the
 * `where`, because grouping cannot express the anti-join.
 */
export async function serviceMinutesByStay(stayIds) {
  const ids = stayIds.filter(Boolean)
  if (!ids.length) return new Map()

  const rows = await prisma.serviceEntry.findMany({
    where: { stayId: { in: ids }, ...CURRENT_ONLY },
    select: { stayId: true, minutes: true, verifiedAt: true },
  })

  const byStay = new Map(ids.map((id) => [id, { verifiedMinutes: 0, pendingMinutes: 0 }]))
  for (const r of rows) {
    const acc = byStay.get(r.stayId)
    if (r.verifiedAt) acc.verifiedMinutes += r.minutes
    else acc.pendingMinutes += r.minutes
  }
  return byStay
}

/**
 * The effective target for a stay: the per-stay override, else the phase
 * default, else none.
 *
 * `targetSource` rides along so the UI can say "Phase 2 default" rather than
 * presenting a number with no provenance — a court-ordered 80 and a phase
 * default 80 are the same figure and very different facts.
 */
export function effectiveTarget(stay) {
  if (stay?.serviceHoursRequired != null) {
    return { requiredHours: stay.serviceHoursRequired, targetSource: 'STAY' }
  }
  if (stay?.program?.serviceHoursRequired != null) {
    return { requiredHours: stay.program.serviceHoursRequired, targetSource: 'PROGRAM' }
  }
  return { requiredHours: null, targetSource: null }
}

/** Everything the resident record and the rail dot need, for one stay. */
export async function serviceSummary(stay, dayOfStay) {
  const { requiredHours, targetSource } = effectiveTarget(stay)
  const totals = (await serviceMinutesByStay([stay.id])).get(stay.id) ?? {
    verifiedMinutes: 0,
    pendingMinutes: 0,
  }
  const pace = servicePace({ dayOfStay, requiredHours, verifiedMinutes: totals.verifiedMinutes })

  return {
    ...totals,
    ...pace,
    targetSource,
    // Echoed so a client never has to divide by 60 to render the target form.
    quotaHoursPerMonth: MONTHLY_SERVICE_QUOTA_HOURS,
  }
}

function shape(e) {
  return {
    id: e.id,
    minutes: e.minutes,
    workedOn: e.workedOn,
    location: e.location,
    supervisorName: e.supervisorName,
    supervisorPhone: e.supervisorPhone,
    note: e.note,
    verifiedAt: e.verifiedAt,
    verifiedBy: e.verifiedBy,
    recordedBy: e.recordedBy,
    // Present only on an amendment. The predecessor's figures travel with it so
    // the row can say "was 8 h" without a second request.
    amendmentReason: e.amendmentReason,
    supersedes: e.supersedes
      ? { id: e.supersedes.id, minutes: e.supersedes.minutes, workedOn: e.supersedes.workedOn }
      : null,
  }
}

/** The current entries for a stay, newest work first. */
export async function listEntries(stayId) {
  const entries = await prisma.serviceEntry.findMany({
    where: { stayId, ...CURRENT_ONLY },
    orderBy: [{ workedOn: 'desc' }, { createdAt: 'desc' }],
    include: WITH_PEOPLE,
  })
  return entries.map(shape)
}

async function loadStay(stayId) {
  const stay = await prisma.stay.findUnique({
    where: { id: stayId },
    select: { id: true, status: true },
  })
  if (!stay) throw new HttpError(404, 'Stay not found')
  return stay
}

/**
 * Log an hour worked.
 *
 * A discharged stay may still take entries, deliberately, and for the ledger's
 * reason: a slip that arrives the week after somebody leaves is normal, and
 * refusing it would push the hours into a note nobody can total.
 */
export async function logEntry(input, actorId) {
  await loadStay(input.stayId)

  const entry = await prisma.serviceEntry.create({
    data: {
      stayId: input.stayId,
      minutes: input.minutes,
      workedOn: new Date(`${input.workedOn}T00:00:00.000Z`),
      location: input.location,
      supervisorName: input.supervisorName || null,
      supervisorPhone: input.supervisorPhone || null,
      note: input.note || null,
      recordedById: actorId,
    },
    include: WITH_PEOPLE,
  })
  return shape(entry)
}

/**
 * Verification: the one transition this table permits.
 *
 * The friendly errors here sit in front of a trigger and a column-level grant
 * that enforce the same rules — this turns what would be a 500 into a sentence.
 */
export async function verifyEntry(id, actorId) {
  const entry = await prisma.serviceEntry.findUnique({
    where: { id },
    select: { id: true, verifiedAt: true, supersededBy: { select: { id: true } } },
  })
  if (!entry) throw new HttpError(404, 'Service entry not found')
  if (entry.verifiedAt) {
    throw new HttpError(409, 'This entry is already verified. Amend it rather than re-verifying.')
  }
  if (entry.supersededBy) {
    throw new HttpError(409, 'This entry has been amended. Verify the amendment instead.')
  }

  const updated = await prisma.serviceEntry.update({
    where: { id },
    data: { verifiedAt: new Date(), verifiedById: actorId },
    include: WITH_PEOPLE,
  })
  return shape(updated)
}

/**
 * Amend an entry: a new row pointing at the original, with a reason.
 *
 * A PURE INSERT — nothing on the original changes, which is what lets this table
 * hold an UPDATE grant scoped to verification alone. Zero minutes is how an
 * entry is voided, and the CHECK permits zero only here.
 */
export async function amendEntry(id, input, actorId) {
  const original = await prisma.serviceEntry.findUnique({
    where: { id },
    include: { supersededBy: { select: { id: true } } },
  })
  if (!original) throw new HttpError(404, 'Service entry not found')
  if (original.supersededBy) {
    throw new HttpError(409, 'This entry has already been amended. Amend the latest version.')
  }

  const entry = await prisma.serviceEntry.create({
    data: {
      stayId: original.stayId,
      // Anything not restated carries over from the original, so an amendment
      // that only fixes the hours does not silently blank the location.
      minutes: input.minutes ?? original.minutes,
      workedOn: input.workedOn
        ? new Date(`${input.workedOn}T00:00:00.000Z`)
        : original.workedOn,
      location: input.location ?? original.location,
      supervisorName: input.supervisorName ?? original.supervisorName,
      supervisorPhone: input.supervisorPhone ?? original.supervisorPhone,
      note: input.note ?? original.note,
      // An amendment starts unverified. The original's verification was an
      // attestation about numbers that have just changed, and carrying it over
      // would move somebody's name onto a claim they did not make.
      recordedById: actorId,
      supersedesId: original.id,
      amendmentReason: input.amendmentReason,
    },
    include: WITH_PEOPLE,
  })
  return shape(entry)
}

/**
 * The house-wide read behind /service: what needs signing off, and who is
 * falling behind. One request rather than two, the same shape as /census and
 * /schedule — a page that renders from one read cannot show two halves that
 * disagree because one of them loaded a second later.
 *
 * Names appear here, unlike the census tiles or the schedule board. This is a
 * work queue: you cannot verify somebody's hours without knowing whose they
 * are, and the page is staff-only like every other list of residents.
 */
export async function houseService() {
  const stays = await prisma.stay.findMany({
    where: { status: STAY_STATUS.ACTIVE },
    include: {
      resident: { select: { id: true, firstName: true, lastName: true } },
      program: { select: { name: true, serviceHoursRequired: true } },
    },
  })

  const totals = await serviceMinutesByStay(stays.map((s) => s.id))

  const pendingRows = await prisma.serviceEntry.findMany({
    where: {
      stayId: { in: stays.map((s) => s.id) },
      verifiedAt: null,
      ...CURRENT_ONLY,
    },
    // Oldest work first: a slip that has sat for a fortnight is the one at risk
    // of never being signed, and it is the one an auditor asks about.
    orderBy: [{ workedOn: 'asc' }, { createdAt: 'asc' }],
    include: {
      ...WITH_PEOPLE,
      stay: { include: { resident: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })

  const nameOf = (r) => `${r.firstName} ${r.lastName}`

  const pending = pendingRows.map((e) => ({
    ...shape(e),
    residentId: e.stay.resident.id,
    residentName: nameOf(e.stay.resident),
  }))

  const progress = stays
    .map((stay) => {
      const { requiredHours, targetSource } = effectiveTarget(stay)
      const t = totals.get(stay.id) ?? { verifiedMinutes: 0, pendingMinutes: 0 }
      return {
        residentId: stay.resident.id,
        residentName: nameOf(stay.resident),
        programName: stay.program?.name ?? null,
        dayOfStay: dayOfStay(stay.intakeAt),
        targetSource,
        ...t,
        ...servicePace({
          dayOfStay: dayOfStay(stay.intakeAt),
          requiredHours,
          verifiedMinutes: t.verifiedMinutes,
        }),
      }
    })
    // Behind first and by how much, then everyone else by name. The people who
    // need something done about them are the reason to open the page.
    .sort(
      (a, b) =>
        Number(b.behind) - Number(a.behind) ||
        b.behindMinutes - a.behindMinutes ||
        a.residentName.localeCompare(b.residentName),
    )

  return {
    pending,
    progress,
    figures: {
      awaitingVerification: pending.length,
      awaitingMinutes: pending.reduce((n, e) => n + e.minutes, 0),
      behind: progress.filter((p) => p.behind).length,
      // Residents with no target at all: nothing is owed, so they sit in their
      // own quiet group rather than reading "0 of 0" among the rest.
      noTarget: progress.filter((p) => p.requiredMinutes == null).length,
    },
  }
}

/** Whole days since intake, counting the intake day as day 1. */
function dayOfStay(intakeAt) {
  return Math.max(1, Math.floor((Date.now() - new Date(intakeAt).getTime()) / 86_400_000) + 1)
}

/** The per-stay override. Null clears it, falling back to the phase default. */
export async function setStayTarget(stayId, requiredHours) {
  const stay = await loadStay(stayId)
  if (stay.status !== STAY_STATUS.ACTIVE) {
    throw new HttpError(409, 'This resident has no active stay.')
  }
  await prisma.stay.update({
    where: { id: stayId },
    data: { serviceHoursRequired: requiredHours },
  })
}
