import { prisma } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { PRISMA } from '../lib/http.js'
import { BED_STATUS, MAINTENANCE_STATUS } from '../domain/constants.js'

/**
 * Occupancy is DERIVED, never stored.
 *
 * A bed is occupied when it has a BedAssignment with no endedAt. There is no
 * occupancy column and there must not be one — a second copy would drift the
 * first time an assignment half-fails, and the census would start lying.
 */
const LIVE_ASSIGNMENT = { where: { endedAt: null } }

function shapeBed(bed) {
  const live = bed.assignments?.[0] ?? null
  return {
    id: bed.id,
    label: bed.label,
    status: bed.status,
    outOfServiceNote: bed.outOfServiceNote,
    occupied: Boolean(live),
    // Resident identity is only included for staff; the route layer is what
    // gates access, and the audit extension records the read.
    resident: live?.stay?.resident
      ? {
          id: live.stay.resident.id,
          fullName: `${live.stay.resident.firstName} ${live.stay.resident.lastName}`,
        }
      : null,
    occupiedSince: live?.startedAt ?? null,
  }
}

export async function listApartments() {
  const apartments = await prisma.apartment.findMany({
    orderBy: { name: 'asc' },
    include: {
      beds: {
        where: { deletedAt: null },
        include: { assignments: LIVE_ASSIGNMENT },
      },
    },
  })

  return apartments.map((a) => {
    const beds = a.beds
    return {
      id: a.id,
      name: a.name,
      cohort: a.cohort,
      bedCount: beds.length,
      occupiedCount: beds.filter((b) => b.assignments.length > 0).length,
      outOfServiceCount: beds.filter((b) => b.status === BED_STATUS.OUT_OF_SERVICE).length,
    }
  })
}

export async function getApartment(id) {
  const apartment = await prisma.apartment.findUnique({
    where: { id },
    include: {
      beds: {
        where: { deletedAt: null },
        orderBy: { label: 'asc' },
        include: {
          assignments: {
            ...LIVE_ASSIGNMENT,
            include: { stay: { include: { resident: true } } },
          },
        },
      },
      maintenanceRequests: {
        where: { deletedAt: null },
        orderBy: [{ status: 'asc' }, { reportedAt: 'desc' }],
        include: {
          reportedBy: { select: { id: true, fullName: true } },
          resolvedBy: { select: { id: true, fullName: true } },
        },
      },
    },
  })
  if (!apartment) throw new HttpError(404, 'Apartment not found')

  return {
    id: apartment.id,
    name: apartment.name,
    cohort: apartment.cohort,
    beds: apartment.beds.map(shapeBed),
    maintenanceRequests: apartment.maintenanceRequests.map(shapeRequest),
    openRequestCount: apartment.maintenanceRequests.filter(
      (r) => r.status === MAINTENANCE_STATUS.OPEN || r.status === MAINTENANCE_STATUS.IN_PROGRESS,
    ).length,
  }
}

export function shapeRequest(r) {
  return {
    id: r.id,
    apartmentId: r.apartmentId,
    apartmentName: r.apartment?.name ?? undefined,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    reportedBy: r.reportedBy ?? null,
    reportedAt: r.reportedAt,
    resolvedBy: r.resolvedBy ?? null,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
  }
}

export async function createApartment(data) {
  try {
    return await prisma.apartment.create({ data })
  } catch (err) {
    if (err.code === PRISMA.UNIQUE_VIOLATION) {
      throw new HttpError(409, 'An apartment with that name already exists')
    }
    throw err
  }
}

export async function updateApartment(id, data) {
  const existing = await prisma.apartment.findUnique({
    where: { id },
    include: { beds: { where: { deletedAt: null }, select: { id: true } } },
  })
  if (!existing) throw new HttpError(404, 'Apartment not found')

  // Postgres already refuses this via the composite foreign key from Bed, but
  // the raw constraint error is unreadable. Catch it here and say why.
  if (data.cohort && data.cohort !== existing.cohort && existing.beds.length > 0) {
    throw new HttpError(
      409,
      'Cannot change cohort while this apartment has beds. Remove the beds first — ' +
        'this is what keeps men and women from sharing a unit.',
    )
  }

  try {
    return await prisma.apartment.update({ where: { id }, data })
  } catch (err) {
    if (err.code === PRISMA.UNIQUE_VIOLATION) {
      throw new HttpError(409, 'An apartment with that name already exists')
    }
    throw err
  }
}

export async function deleteApartment(id) {
  const apartment = await prisma.apartment.findUnique({
    where: { id },
    include: { beds: { where: { deletedAt: null }, select: { id: true } } },
  })
  if (!apartment) throw new HttpError(404, 'Apartment not found')

  // Refusing rather than cascading: soft-deleting the beds too would orphan the
  // bed history that answers "who slept in 12B on March 12".
  if (apartment.beds.length > 0) {
    throw new HttpError(
      409,
      `Cannot remove an apartment that still has ${apartment.beds.length} bed(s). Remove the beds first.`,
    )
  }

  return prisma.apartment.delete({ where: { id } })
}
