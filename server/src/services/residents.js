import { prisma, runInTransaction } from '../db/client.js'
import { facilityDayInstant } from '../lib/facilityTime.js'
import { HttpError } from '../middleware/authorize.js'
import { STAY_STATUS } from '../domain/constants.js'
import { balancesByStay, balanceOfStay } from './ledger.js'
import { residentCheckStatus } from './checks.js'
import { stayInvoiceSummary } from './invoices.js'
import { serviceSummary } from './communityService.js'
import { STAFF_ROLE } from '../domain/constants.js'

/// Who may see the last four of an SSN. Techs do not need it to run a med pass
/// or an apartment check, and the smallest audience is the right one for the
/// most directly abusable field on the record.
const SSN_ROLES = [STAFF_ROLE.ADMIN, STAFF_ROLE.HOUSE_MANAGER]

/**
 * A resident's current stay is the one that has not been discharged. There is
 * at most one; readmission creates a new Stay rather than reopening the old.
 */
const CURRENT_STAY = { where: { status: STAY_STATUS.ACTIVE }, take: 1 }

const STAY_WITH_BED = {
  include: {
    program: { select: { id: true, name: true, level: true } },
    bedAssignments: {
      where: { endedAt: null },
      include: { bed: { include: { apartment: { select: { id: true, name: true } } } } },
    },
  },
}

/** Whole days since intake, counting the intake day as day 1. */
function dayOfStay(intakeAt) {
  const ms = Date.now() - new Date(intakeAt).getTime()
  return Math.max(1, Math.floor(ms / 86_400_000) + 1)
}

function currentBedOf(stay) {
  const a = stay?.bedAssignments?.[0]
  if (!a) return null
  return {
    assignmentId: a.id,
    id: a.bed.id,
    label: a.bed.label,
    apartmentId: a.bed.apartment.id,
    apartmentName: a.bed.apartment.name,
    since: a.startedAt,
  }
}

function shapeRow(r) {
  const stay = r.stays?.[0] ?? null
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    fullName: `${r.firstName} ${r.lastName}`,
    cohort: r.cohort,
    stayId: stay?.id ?? null,
    intakeAt: stay?.intakeAt ?? null,
    expectedDischargeAt: stay?.expectedDischargeAt ?? null,
    dayOfStay: stay ? dayOfStay(stay.intakeAt) : null,
    program: stay?.program ?? null,
    bed: currentBedOf(stay),
    status: stay ? stay.status : STAY_STATUS.DISCHARGED,
  }
}

export async function listResidents({ includeDischarged = false } = {}) {
  const residents = await prisma.resident.findMany({
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    include: {
      stays: includeDischarged
        ? { orderBy: { intakeAt: 'desc' }, take: 1, ...STAY_WITH_BED }
        : { ...CURRENT_STAY, ...STAY_WITH_BED },
    },
  })

  const rows = residents.map(shapeRow)
  // A resident with no active stay has been discharged. Hidden by default —
  // the roster is about who is here now.
  const visible = includeDischarged ? rows : rows.filter((r) => r.status === STAY_STATUS.ACTIVE)

  // One grouped query for every balance on screen, rather than one per row.
  // Derived here and never stored — see services/ledger.js.
  const balances = await balancesByStay(visible.map((r) => r.stayId))
  return visible.map((r) => ({ ...r, balanceCents: r.stayId ? (balances.get(r.stayId) ?? 0) : null }))
}

/**
 * The full record.
 *
 * `viewerRole` is not optional in spirit: the last four of an SSN is omitted
 * from the response entirely for anyone below house manager. Filtering it in
 * the client would still put it on the wire and in the browser's memory, which
 * is the difference between hiding something and not disclosing it.
 */
/**
 * The phases a resident can be on, lowest first. Orientation is level 0 — the
 * restricted first stretch — so it sorts to the top and is what intake offers
 * by default.
 */
export async function listPrograms() {
  return prisma.program.findMany({
    orderBy: { level: 'asc' },
    select: { id: true, name: true, level: true },
  })
}

export async function getResident(id, { viewerRole } = {}) {
  const resident = await prisma.resident.findUnique({
    where: { id },
    include: {
      emergencyContacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      insurance: true,
      stays: {
        orderBy: { intakeAt: 'desc' },
        include: {
          // serviceHoursRequired is selected because effectiveTarget() falls
          // back to it when the stay carries no override.
          program: {
            select: { id: true, name: true, level: true, serviceHoursRequired: true },
          },
          bedAssignments: {
            orderBy: { startedAt: 'desc' },
            include: { bed: { include: { apartment: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  })
  if (!resident) throw new HttpError(404, 'Resident not found')

  const current = resident.stays.find((s) => s.status === STAY_STATUS.ACTIVE) ?? null

  return {
    id: resident.id,
    firstName: resident.firstName,
    lastName: resident.lastName,
    fullName: `${resident.firstName} ${resident.lastName}`,
    cohort: resident.cohort,
    dateOfBirth: resident.dateOfBirth,
    phone: resident.phone,
    email: resident.email,
    // Present as a key only when the viewer may see it, so a client cannot tell
    // the difference between "no SSN recorded" and "not allowed to see it".
    ...(SSN_ROLES.includes(viewerRole) ? { ssnLast4: resident.ssnLast4 } : {}),
    canSeeSsn: SSN_ROLES.includes(viewerRole),
    insurance: resident.insurance,
    emergencyContacts: resident.emergencyContacts,
    current: current
      ? {
          balanceCents: await balanceOfStay(current.id),
          // Minutes throughout, so nothing downstream ever compares an hour to
          // a minute. This is what lights the rail's amber dot — see
          // sectionDots() in the admin app, and servicePace() for the rule.
          service: await serviceSummary(current, dayOfStay(current.intakeAt)),
          // The round's answer to "where are they": the hero on the checks
          // section, the RED dot on the rail, and the Overview row. Derived
          // by the same helper the bell's RESIDENT_NOT_ACCOUNTED item uses —
          // one knob, so the record and the bell cannot disagree.
          checks: await residentCheckStatus(current.id),
          // What lights the LEDGER section's red dot. Derived through the same
          // helper the dashboard reads, so the record and the dashboard cannot
          // disagree about who is overdue — the module 4 pattern.
          invoices: await stayInvoiceSummary(current.id),
          stayId: current.id,
          intakeAt: current.intakeAt,
          expectedDischargeAt: current.expectedDischargeAt,
          dayOfStay: dayOfStay(current.intakeAt),
          referralSource: current.referralSource,
          sobrietyDate: current.sobrietyDate,
          intakeNotes: current.intakeNotes,
          program: current.program,
          bed: currentBedOf({ bedAssignments: current.bedAssignments.filter((a) => !a.endedAt) }),
        }
      : null,
    // Every episode, newest first. A returning resident has more than one —
    // the person record persists across all of them.
    stays: resident.stays.map((s) => ({
      id: s.id,
      status: s.status,
      intakeAt: s.intakeAt,
      dischargedAt: s.dischargedAt,
      dischargeType: s.dischargeType,
      dischargeReason: s.dischargeReason,
      program: s.program,
      beds: s.bedAssignments.map((a) => ({
        label: `${a.bed.apartment.name} · ${a.bed.label}`,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
      })),
    })),
  }
}

/**
 * Intake: the person, their episode, and optionally their bed — all or nothing.
 *
 * Without the transaction a failure partway leaves a resident with no stay,
 * which no screen in the app knows how to display.
 */
export async function intakeResident(input, actorId) {
  return runInTransaction(async () => {
    const resident = await prisma.resident.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        cohort: input.cohort,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        phone: input.phone || null,
        email: input.email || null,
        ssnLast4: input.ssnLast4 || null,
      },
    })

    const stay = await prisma.stay.create({
      data: {
        residentId: resident.id,
        cohort: input.cohort,
        programId: input.programId || null,
        // Both are DateTime columns holding a DAY somebody typed, so a bare
        // date goes through the facility clock — `new Date('2026-08-06')` is
        // UTC midnight, which is the 5th here, and an admission date off by a
        // day is wrong on every record that quotes it.
        intakeAt: facilityDayInstant(input.intakeAt),
        expectedDischargeAt: input.expectedDischargeAt
          ? facilityDayInstant(input.expectedDischargeAt)
          : null,
        referralSource: input.referralSource || null,
        // NOT facilityDayInstant: `sobrietyDate` is @db.Date, so Postgres keeps
        // only the date part and there is no instant to get wrong.
        sobrietyDate: input.sobrietyDate ? new Date(input.sobrietyDate) : null,
        intakeNotes: input.intakeNotes || null,
      },
    })

    if (input.bedId) await assignBedTo(stay.id, input.bedId, input.cohort, actorId)

    // Provider and policy number travel together — one without the other is not
    // a policy anyone could bill against, so a half-filled section is skipped
    // rather than written as a stub.
    if (input.insurance?.provider && input.insurance?.policyNumber) {
      await prisma.insurancePolicy.create({
        data: {
          residentId: resident.id,
          provider: input.insurance.provider,
          policyNumber: input.insurance.policyNumber,
          groupNumber: input.insurance.groupNumber || null,
          policyHolder: input.insurance.policyHolder || null,
        },
      })
    }

    if (input.emergencyContact?.name) {
      await prisma.emergencyContact.create({
        data: {
          residentId: resident.id,
          name: input.emergencyContact.name,
          relationship: input.emergencyContact.relationship || null,
          phone: input.emergencyContact.phone,
          isPrimary: true,
        },
      })
    }

    return resident
  })
}

/**
 * Assigns a bed, closing any assignment the stay currently holds.
 *
 * Cohort is passed through rather than trusted from the bed: the composite
 * foreign keys refuse a mismatch, so a wrong value fails loudly at the database
 * instead of housing someone in the other cohort's apartment.
 *
 * The cohort check below does NOT replace that — the foreign keys are still the
 * enforcement, and still hold against a direct psql session. It only gives the
 * mismatch a friendly face: without it a wrong pairing surfaces as a raw Prisma
 * error, which the error handler turns into a 500 "Internal server error" for
 * what is a correctable mistake. Assigning bed-first from the census board is
 * where getting these two arguments the wrong way round became reachable.
 */
async function assignBedTo(stayId, bedId, cohort, actorId, reason = 'transfer') {
  const bed = await prisma.bed.findUnique({ where: { id: bedId } })
  if (!bed) throw new HttpError(404, 'Bed not found')
  // Before the out-of-service check: the harder constraint should not be masked
  // by a softer message on a bed that could never have been used anyway.
  if (bed.cohort !== cohort) {
    throw new HttpError(409, 'That bed is in an apartment that serves the other cohort.')
  }
  if (bed.status !== 'ACTIVE') {
    throw new HttpError(409, 'That bed is out of service and cannot be assigned.')
  }

  const occupied = await prisma.bedAssignment.findFirst({
    where: { bedId, endedAt: null },
  })
  if (occupied) throw new HttpError(409, 'That bed is already occupied.')

  const existing = await prisma.bedAssignment.findFirst({
    where: { stayId, endedAt: null },
  })
  if (existing) {
    await prisma.bedAssignment.update({
      where: { id: existing.id },
      data: { endedAt: new Date(), endedReason: reason },
    })
  }

  return prisma.bedAssignment.create({
    data: { bedId, stayId, cohort, startedAt: new Date(), assignedById: actorId },
  })
}

export async function transferBed(residentId, bedId, actorId) {
  return runInTransaction(async () => {
    const stay = await prisma.stay.findFirst({
      where: { residentId, status: STAY_STATUS.ACTIVE },
    })
    if (!stay) throw new HttpError(409, 'This resident has no active stay.')
    return assignBedTo(stay.id, bedId, stay.cohort, actorId)
  })
}

export async function releaseBed(residentId, reason) {
  return runInTransaction(async () => {
    const stay = await prisma.stay.findFirst({
      where: { residentId, status: STAY_STATUS.ACTIVE },
    })
    if (!stay) throw new HttpError(409, 'This resident has no active stay.')

    const assignment = await prisma.bedAssignment.findFirst({
      where: { stayId: stay.id, endedAt: null },
    })
    if (!assignment) throw new HttpError(409, 'This resident is not in a bed.')

    return prisma.bedAssignment.update({
      where: { id: assignment.id },
      data: { endedAt: new Date(), endedReason: reason || 'released' },
    })
  })
}

export async function updateResident(id, data) {
  const resident = await prisma.resident.findUnique({ where: { id } })
  if (!resident) throw new HttpError(404, 'Resident not found')

  // Cohort is deliberately not editable here. It is half of the composite
  // foreign keys that keep the cohorts housed apart, and changing it under a
  // live stay is refused by Postgres anyway.
  const { cohort, ...editable } = data
  return prisma.resident.update({
    where: { id },
    data: {
      ...editable,
      dateOfBirth: editable.dateOfBirth ? new Date(editable.dateOfBirth) : undefined,
    },
  })
}

/**
 * Discharge closes the stay and frees the bed, in one transaction.
 *
 * Irreversible on purpose: a discharge is a record a licensing audit may
 * already have seen. A mistake is corrected by a new intake, not by rewriting
 * this one — see the amendment discipline in CLAUDE.md.
 */
export async function dischargeResident(residentId, { dischargeType, dischargeReason }) {
  if (!dischargeReason?.trim()) {
    throw new HttpError(400, 'A discharge needs a reason. It is the record that explains it.')
  }

  return runInTransaction(async () => {
    const stay = await prisma.stay.findFirst({
      where: { residentId, status: STAY_STATUS.ACTIVE },
    })
    if (!stay) throw new HttpError(409, 'This resident has already been discharged.')

    const assignment = await prisma.bedAssignment.findFirst({
      where: { stayId: stay.id, endedAt: null },
    })
    if (assignment) {
      await prisma.bedAssignment.update({
        where: { id: assignment.id },
        data: { endedAt: new Date(), endedReason: 'discharge' },
      })
    }

    return prisma.stay.update({
      where: { id: stay.id },
      data: {
        status: STAY_STATUS.DISCHARGED,
        dischargedAt: new Date(),
        dischargeType,
        dischargeReason: dischargeReason.trim(),
      },
    })
  })
}

// ── Emergency contacts ──────────────────────────────────────────────────────

export async function addContact(residentId, data) {
  const resident = await prisma.resident.findUnique({ where: { id: residentId } })
  if (!resident) throw new HttpError(404, 'Resident not found')
  return prisma.emergencyContact.create({ data: { residentId, ...data } })
}

export async function updateContact(id, data) {
  return prisma.emergencyContact.update({ where: { id }, data })
}

export async function removeContact(id) {
  return prisma.emergencyContact.delete({ where: { id } })
}

/** Beds a resident could move into: active, unoccupied, matching cohort. */
export async function availableBeds(cohort) {
  const beds = await prisma.bed.findMany({
    where: { cohort, status: 'ACTIVE' },
    include: {
      apartment: { select: { id: true, name: true } },
      assignments: { where: { endedAt: null }, select: { id: true } },
    },
    orderBy: [{ apartmentId: 'asc' }, { label: 'asc' }],
  })
  return beds
    .filter((b) => b.assignments.length === 0)
    .map((b) => ({ id: b.id, label: `${b.apartment.name} · ${b.label}` }))
}

/**
 * Bed capacity per cohort.
 *
 * Reported per cohort rather than as one figure because the pools are genuinely
 * separate — a free women's bed cannot take a man. A single "5 of 6 beds" would
 * hide exactly the situation that matters: one side full while the other has
 * room and someone waiting for it.
 */
export async function cohortCapacity() {
  const beds = await prisma.bed.findMany({
    select: {
      cohort: true,
      status: true,
      assignments: { where: { endedAt: null }, select: { id: true } },
    },
  })

  const blank = () => ({ total: 0, usable: 0, occupied: 0, free: 0, outOfService: 0 })
  const out = { MEN: blank(), WOMEN: blank() }

  for (const bed of beds) {
    const c = out[bed.cohort]
    c.total += 1
    if (bed.status === 'OUT_OF_SERVICE') {
      c.outOfService += 1
      continue
    }
    c.usable += 1
    if (bed.assignments.length) c.occupied += 1
  }
  for (const c of Object.values(out)) c.free = c.usable - c.occupied
  return out
}

/**
 * Residents with an active stay and no bed, each paired with the first free bed
 * in their cohort — so the roster can say "and one is free" and offer the
 * action, rather than only reporting the problem.
 */
export async function unhousedWithOptions() {
  const residents = await listResidents()
  const unhoused = residents.filter((r) => r.status === STAY_STATUS.ACTIVE && !r.bed)
  if (!unhoused.length) return []

  const byCohort = {}
  for (const cohort of new Set(unhoused.map((r) => r.cohort))) {
    byCohort[cohort] = await availableBeds(cohort)
  }

  // Hand out distinct beds, so two unhoused residents are not both pointed at
  // the same one.
  const taken = new Set()
  return unhoused.map((r) => {
    const bed = (byCohort[r.cohort] ?? []).find((b) => !taken.has(b.id)) ?? null
    if (bed) taken.add(bed.id)
    return { id: r.id, fullName: r.fullName, cohort: r.cohort, freeBed: bed }
  })
}

/**
 * Active residents of the given cohorts, for a schedule roster picker.
 *
 * Takes a LIST because an event may be for the men, the women, or both, and a
 * both-cohorts event is picked from one combined roster. One query and one sort
 * rather than two client-side calls, which would interleave badly and put the
 * ordering in the browser.
 *
 * Returns `stayId` alongside the name, and callers need it rather than the
 * resident id: schedule attendee rows hang off the STAY, the same as sign-outs
 * and the ledger, so that a discharge drops someone off every future session
 * with no write at all.
 *
 * The cohorts are a hard filter, not a convenience — and the caller must ask
 * for both explicitly. Everything downstream refuses a mismatch anyway, but a
 * picker that could show a cohort the event is not for is a merged schedule
 * waiting to be created by whoever is in a hurry.
 */
export async function listActiveResidentsByCohorts(cohorts) {
  const stays = await prisma.stay.findMany({
    where: { cohort: { in: cohorts }, status: STAY_STATUS.ACTIVE },
    include: {
      resident: { select: { id: true, firstName: true, lastName: true } },
      program: { select: { id: true, name: true, level: true } },
      bedAssignments: {
        where: { endedAt: null },
        include: { bed: { include: { apartment: { select: { name: true } } } } },
      },
    },
  })

  return stays
    .map((s) => ({
      stayId: s.id,
      residentId: s.resident.id,
      fullName: `${s.resident.firstName} ${s.resident.lastName}`,
      cohort: s.cohort,
      programName: s.program?.name ?? null,
      // Shown in the picker so two residents sharing a first name are
      // distinguishable without opening anything.
      bedLabel: s.bedAssignments[0]
        ? `${s.bedAssignments[0].bed.apartment.name} · ${s.bedAssignments[0].bed.label}`
        : null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}
