import { prisma } from '../db/client.js'
import { BED_STATUS, PRESENCE } from '../domain/constants.js'
import { unhousedWithOptions } from './residents.js'
import { presenceOf } from './signOuts.js'
import { passesCovering } from './passes.js'

/**
 * The census: who is in which bed right now, as one read.
 *
 * Occupancy is derived from live BedAssignments — the same rule as
 * services/apartments.js, and for the same reason: a stored occupancy flag
 * would drift, and this is the screen everyone believes.
 *
 * Sign-outs and passes (modules 8–9) will add a presence dimension to every
 * occupied bed — in the house, out until a time, OVERDUE, on pass. The tile
 * shape here is where that lands when it exists; an overdue return is the
 * loudest state this screen will ever show.
 */
export async function census() {
  const [apartments, unhoused] = await Promise.all([
    prisma.apartment.findMany({
      orderBy: { name: 'asc' },
      include: {
        beds: {
          where: { deletedAt: null },
          orderBy: { label: 'asc' },
          include: {
            assignments: {
              where: { endedAt: null },
              include: {
                stay: {
                  include: {
                    resident: { select: { id: true, firstName: true, lastName: true } },
                    program: { select: { name: true } },
                    // The open sign-out, if any — the partial unique index
                    // guarantees at most one. (The soft-delete extension adds
                    // deletedAt: null since this where says nothing about it.)
                    signOuts: {
                      where: { returnedAt: null },
                      select: { outAt: true, expectedReturnAt: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    unhousedWithOptions(),
  ])

  // One `now` for the whole read, so every tile agrees on who is overdue.
  const now = new Date()
  // One query for the whole board — the same read the check roster and the med
  // board use, so the three cannot disagree about who is away.
  const onPass = await passesCovering(now)
  const figures = {
    beds: 0,
    occupied: 0,
    free: 0,
    outOfService: 0,
    awaitingBed: unhoused.length,
    out: 0,
    overdue: 0,
    // Counted beside `occupied`, never instead of it: the bed is HELD.
    onPass: 0,
    passOverdue: 0,
  }

  const shaped = apartments.map((a) => ({
    id: a.id,
    name: a.name,
    cohort: a.cohort,
    bedCount: a.beds.length,
    occupiedCount: a.beds.filter((b) => b.assignments.length > 0).length,
    beds: a.beds.map((b) => {
      const live = b.assignments[0] ?? null
      figures.beds += 1
      if (live) figures.occupied += 1
      else if (b.status === BED_STATUS.ACTIVE) figures.free += 1
      if (b.status === BED_STATUS.OUT_OF_SERVICE) figures.outOfService += 1

      // State + times only, deliberately no destination: the board is glanced
      // at with residents around, and where somebody went is for the
      // sign-outs page, not a tile over a tech's shoulder.
      const presence = live
        ? presenceOf(live.stay.signOuts[0] ?? null, now, onPass.get(live.stay.id) ?? null)
        : null
      if (presence?.state === PRESENCE.OUT) figures.out += 1
      if (presence?.state === PRESENCE.OVERDUE) figures.overdue += 1
      // The bed is still OCCUPIED while somebody is on a pass — it is held, not
      // freed — so `onPass` is counted beside the others rather than instead of
      // `occupied`. A pass that emptied a tile would be a transfer.
      if (presence?.state === PRESENCE.ON_PASS) figures.onPass += 1
      if (presence?.state === PRESENCE.PASS_OVERDUE) figures.passOverdue += 1

      return {
        id: b.id,
        label: b.label,
        status: b.status,
        outOfServiceNote: b.outOfServiceNote,
        resident: live
          ? {
              id: live.stay.resident.id,
              fullName: `${live.stay.resident.firstName} ${live.stay.resident.lastName}`,
              programName: live.stay.program?.name ?? null,
            }
          : null,
        since: live?.startedAt ?? null,
        presence,
      }
    }),
  }))

  return { figures, apartments: shaped, unhoused }
}
