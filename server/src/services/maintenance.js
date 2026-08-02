import { prisma } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { MAINTENANCE_CLOSED_STATUSES, MAINTENANCE_STATUS } from '../domain/constants.js'
import { shapeRequest } from './apartments.js'

const WITH_PEOPLE = {
  apartment: { select: { id: true, name: true, cohort: true } },
  reportedBy: { select: { id: true, fullName: true } },
  resolvedBy: { select: { id: true, fullName: true } },
}

export async function listRequests({ status, apartmentId } = {}) {
  const where = {}
  if (apartmentId) where.apartmentId = apartmentId
  if (status === 'open') {
    where.status = { in: [MAINTENANCE_STATUS.OPEN, MAINTENANCE_STATUS.IN_PROGRESS] }
  } else if (status) {
    where.status = status
  }

  const rows = await prisma.maintenanceRequest.findMany({
    where,
    include: WITH_PEOPLE,
    // Urgent first, then oldest — the thing that has been broken longest and
    // matters most sits at the top.
    orderBy: [{ priority: 'desc' }, { reportedAt: 'asc' }],
  })
  return rows.map(shapeRequest)
}

export async function createRequest({ apartmentId, title, description, priority }, actorId) {
  const apartment = await prisma.apartment.findUnique({ where: { id: apartmentId } })
  if (!apartment) throw new HttpError(404, 'Apartment not found')

  const created = await prisma.maintenanceRequest.create({
    data: { apartmentId, title, description, priority, reportedById: actorId },
    include: WITH_PEOPLE,
  })
  return shapeRequest(created)
}

export async function updateRequest(id, data, actorId) {
  const existing = await prisma.maintenanceRequest.findUnique({ where: { id } })
  if (!existing) throw new HttpError(404, 'Request not found')

  const closing = data.status && MAINTENANCE_CLOSED_STATUSES.includes(data.status)

  // A request that just disappears leaves no record of what was actually done
  // to the unit — and this record is part of why a bed was unusable.
  if (closing && !data.resolutionNote?.trim()) {
    throw new HttpError(400, 'Closing a request requires a note saying what was done.')
  }

  const patch = { ...data }
  if (closing) {
    patch.resolvedById = actorId
    patch.resolvedAt = new Date()
  }
  // Reopening clears the resolution, so a stale note never sits on open work.
  if (data.status && !closing && existing.resolvedAt) {
    patch.resolvedById = null
    patch.resolvedAt = null
    patch.resolutionNote = null
  }

  const updated = await prisma.maintenanceRequest.update({
    where: { id },
    data: patch,
    include: WITH_PEOPLE,
  })
  return shapeRequest(updated)
}
