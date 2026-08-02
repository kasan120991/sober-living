import { prisma } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { PRISMA } from '../lib/http.js'
import { BED_STATUS, STAFF_ROLE } from '../domain/constants.js'

/** A/B/C… or 1/2/3… — the two ways a facility labels beds in a unit. */
export function generateLabels(scheme, count, startAfter = null) {
  const labels = []
  if (scheme === 'numeric') {
    const start = startAfter ? Number(startAfter) + 1 : 1
    for (let i = 0; i < count; i++) labels.push(String(start + i))
    return labels
  }
  // alpha
  const startIndex = startAfter ? startAfter.toUpperCase().charCodeAt(0) - 64 : 0
  for (let i = 0; i < count; i++) {
    labels.push(String.fromCharCode(65 + startIndex + i))
  }
  return labels
}

export async function createBeds(apartmentId, { labels, scheme, count }) {
  const apartment = await prisma.apartment.findUnique({
    where: { id: apartmentId },
    include: { beds: { where: { deletedAt: null }, select: { label: true } } },
  })
  if (!apartment) throw new HttpError(404, 'Apartment not found')

  const existing = new Set(apartment.beds.map((b) => b.label.toUpperCase()))

  let wanted = labels
  if (!wanted) {
    // Bulk: continue from the last existing label rather than restarting at A,
    // so adding 2 beds to an apartment that already has A–C gives D and E.
    const sorted = [...existing].sort()
    wanted = generateLabels(scheme, count, sorted[sorted.length - 1] ?? null)
  }

  const collisions = wanted.filter((l) => existing.has(l.toUpperCase()))
  if (collisions.length) {
    throw new HttpError(
      409,
      `This apartment already has bed(s) ${collisions.join(', ')}. Bed labels must be unique within an apartment.`,
    )
  }

  // `cohort` is copied from the apartment so the composite foreign key holds —
  // a bed cannot claim a cohort its apartment does not have.
  try {
    await prisma.bed.createMany({
      data: wanted.map((label) => ({
        apartmentId,
        cohort: apartment.cohort,
        label,
      })),
    })
  } catch (err) {
    if (err.code === PRISMA.UNIQUE_VIOLATION) {
      throw new HttpError(409, 'One of those bed labels already exists in this apartment')
    }
    throw err
  }

  return prisma.bed.findMany({
    where: { apartmentId, label: { in: wanted } },
    orderBy: { label: 'asc' },
  })
}

/**
 * Field-level authorization.
 *
 * An admin owns the physical layout and may rename a bed. A house manager may
 * only change whether it is usable — which they need to do the moment a window
 * latch breaks, without waiting on an admin.
 */
const MANAGER_EDITABLE = new Set(['status', 'outOfServiceNote'])

export async function updateBed(id, data, actorRole) {
  if (actorRole !== STAFF_ROLE.ADMIN) {
    const forbidden = Object.keys(data).filter((k) => !MANAGER_EDITABLE.has(k))
    if (forbidden.length) {
      throw new HttpError(
        403,
        `Only an administrator can change ${forbidden.join(', ')} on a bed.`,
      )
    }
  }

  const bed = await prisma.bed.findUnique({ where: { id } })
  if (!bed) throw new HttpError(404, 'Bed not found')

  // Clearing the note when a bed returns to service, so a stale reason cannot
  // linger on an available bed.
  const patch = { ...data }
  if (patch.status === BED_STATUS.ACTIVE) patch.outOfServiceNote = null

  try {
    return await prisma.bed.update({ where: { id }, data: patch })
  } catch (err) {
    if (err.code === PRISMA.UNIQUE_VIOLATION) {
      throw new HttpError(409, 'That bed label is already used in this apartment')
    }
    throw err
  }
}

export async function deleteBed(id) {
  const bed = await prisma.bed.findUnique({
    where: { id },
    include: { assignments: { where: { endedAt: null }, select: { id: true } } },
  })
  if (!bed) throw new HttpError(404, 'Bed not found')

  // A live assignment means someone is living in it. Removing the bed would
  // strand a stay with nowhere to be.
  if (bed.assignments.length > 0) {
    throw new HttpError(
      409,
      'Cannot remove an occupied bed. Move or discharge the resident first.',
    )
  }

  return prisma.bed.delete({ where: { id } })
}
