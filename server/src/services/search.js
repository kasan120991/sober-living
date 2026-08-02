import { prisma } from '../db/client.js'
import { STAY_STATUS } from '../domain/constants.js'

/**
 * Global search, for the header field.
 *
 * This is the largest deliberate disclosure surface in the app and is built as
 * such. Under 42 CFR Part 2, confirming that a named person is in a SUD
 * programme IS the disclosure — a box that matches partial names is a way to
 * ask "is Ruben Castillo in your facility?" and get an answer. So:
 *
 *   - staff only, enforced in the route. The RESIDENT role never reaches it.
 *   - a minimum query length, so it cannot be walked one letter at a time to
 *     enumerate the roster.
 *   - a hard result cap, for the same reason.
 *   - it returns only what the roster already shows the same person. No dates
 *     of birth, no SSN fragment, no balance, no notes.
 *   - **the query string is never logged or audited.** The query is a name.
 *     The audit entry records which resident ids came back, which is the
 *     access that actually happened, and is what CLAUDE.md asks for.
 */

/** Below this, a search is enumeration rather than a lookup. */
const MIN_QUERY = 2
const LIMIT_PER_KIND = 6

export async function search(term) {
  const q = String(term ?? '').trim()
  if (q.length < MIN_QUERY) return { residents: [], apartments: [], tooShort: true }

  const [residents, apartments] = await Promise.all([
    prisma.resident.findMany({
      where: {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: LIMIT_PER_KIND,
      include: {
        stays: {
          where: { status: STAY_STATUS.ACTIVE },
          take: 1,
          include: {
            bedAssignments: {
              where: { endedAt: null },
              include: { bed: { include: { apartment: { select: { name: true } } } } },
            },
          },
        },
      },
    }),

    prisma.apartment.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: LIMIT_PER_KIND,
      select: { id: true, name: true, cohort: true, _count: { select: { beds: true } } },
    }),
  ])

  return {
    residents: residents.map((r) => {
      const stay = r.stays[0]
      const assignment = stay?.bedAssignments?.[0]
      return {
        id: r.id,
        fullName: `${r.firstName} ${r.lastName}`,
        cohort: r.cohort,
        // Deliberately the same two facts the roster shows, and nothing more.
        active: Boolean(stay),
        bed: assignment
          ? `${assignment.bed.apartment.name} · ${assignment.bed.label}`
          : null,
      }
    }),
    apartments: apartments.map((a) => ({
      id: a.id,
      name: a.name,
      cohort: a.cohort,
      bedCount: a._count.beds,
    })),
    tooShort: false,
  }
}
