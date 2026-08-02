import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { STAY_STATUS } from '../domain/constants.js'

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
  return includeDischarged ? rows : rows.filter((r) => r.status === STAY_STATUS.ACTIVE)
}

export async function getResident(id) {
  const resident = await prisma.resident.findUnique({
    where: { id },
    include: {
      emergencyContacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      stays: {
        orderBy: { intakeAt: 'desc' },
        include: {
          program: { select: { id: true, name: true, level: true } },
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
    emergencyContacts: resident.emergencyContacts,
    current: current
      ? {
          stayId: current.id,
          intakeAt: current.intakeAt,
          expectedDischargeAt: current.expectedDischargeAt,
          dayOfStay: dayOfStay(current.intakeAt),
          referralSource: current.referralSource,
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
      },
    })

    const stay = await prisma.stay.create({
      data: {
        residentId: resident.id,
        cohort: input.cohort,
        programId: input.programId || null,
        intakeAt: input.intakeAt ? new Date(input.intakeAt) : new Date(),
        expectedDischargeAt: input.expectedDischargeAt ? new Date(input.expectedDischargeAt) : null,
        referralSource: input.referralSource || null,
      },
    })

    if (input.bedId) await assignBedTo(stay.id, input.bedId, input.cohort, actorId)

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
 */
async function assignBedTo(stayId, bedId, cohort, actorId, reason = 'transfer') {
  const bed = await prisma.bed.findUnique({ where: { id: bedId } })
  if (!bed) throw new HttpError(404, 'Bed not found')
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
