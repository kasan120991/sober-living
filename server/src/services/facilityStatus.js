import { prisma } from '../db/client.js'
import { BED_STATUS, STAY_STATUS } from '../domain/constants.js'
import { overdueWhere } from './signOuts.js'

/**
 * The one number in the header pill.
 *
 * Deliberately ONE, not three. A bar carrying "beds free", "unplaced" and
 * "overdue" side by side is a dashboard, and the moment two of them are
 * non-zero it competes with the bell for the same attention. So this returns
 * the single most urgent true thing, and falls back to capacity when the house
 * is quiet.
 *
 * Priority is the order a shift actually cares: someone unaccounted for beats
 * someone unplaced, which beats how much room is left.
 *
 * Counts only. No names, so this is safe to render on every screen regardless
 * of who is standing behind the phone — which is the difference between this
 * and the bell, where the detail lives.
 */
export async function facilityStatus() {
  const [freeBeds, unplaced, overdue] = await Promise.all([
    // Usable beds with nobody currently in them.
    prisma.bed.count({
      where: {
        status: BED_STATUS.ACTIVE,
        assignments: { none: { endedAt: null } },
      },
    }),
    prisma.stay.count({
      where: { status: STAY_STATUS.ACTIVE, bedAssignments: { none: { endedAt: null } } },
    }),
    // The intended top priority, live at last: open sign-outs past their
    // expected return plus the grace window.
    prisma.signOut.count({ where: overdueWhere() }),
  ])

  if (overdue > 0) {
    return { level: 'critical', count: overdue, label: 'overdue' }
  }
  if (unplaced > 0) {
    return { level: 'warning', count: unplaced, label: 'unplaced' }
  }
  return {
    level: 'quiet',
    count: freeBeds,
    label: freeBeds === 1 ? 'bed free' : 'beds free',
  }
}
