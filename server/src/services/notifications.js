import { prisma } from '../db/client.js'
import { BED_STATUS, STAY_STATUS } from '../domain/constants.js'
import { formatFacilityTime } from '../lib/facilityTime.js'
import { overdueApartmentChecks, unaccountedResidents } from './checks.js'
import { urgentOpenWhere } from './maintenance.js'
import { overdueWhere } from './signOuts.js'

/**
 * What the bell knows.
 *
 * There is no Notification table and deliberately so. Everything here is
 * DERIVED from current state, which means it cannot go stale, cannot be
 * dismissed into a lie, and needs no job to keep it honest: a resident stops
 * appearing here the moment they get a bed, not when somebody remembers to
 * mark the notification read.
 *
 * The cost of that choice is that "unread" cannot mean anything, so the bell
 * shows a live count of open situations rather than a mail-style inbox. If the
 * facility later wants per-user dismissal, that is a real table and a real
 * decision about whether one person dismissing hides it from everyone.
 *
 * NOTE none of these carry a diagnosis, a screen result or a medication. A
 * resident's name against "has no bed" is operational, and every reader here is
 * already authorised for the roster. Nothing from module 5 or 6 belongs in a
 * bell without a separate think about who is standing behind the phone.
 */

/** Severity drives ordering and colour. Kept small on purpose. */
const LEVEL = { ACTION: 'action', WATCH: 'watch' }

export async function listNotifications() {
  const [overdue, unhoused, urgent, staleOpen, checksOverdue, notAccounted] = await Promise.all([
    // The loudest state in the app: someone off property past their expected
    // return (plus the grace window — see OVERDUE_GRACE_MS).
    prisma.signOut.findMany({
      where: overdueWhere(),
      include: {
        stay: {
          select: { resident: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
      orderBy: { expectedReturnAt: 'asc' },
    }),

    // Someone in the programme with nowhere to sleep tonight.
    prisma.stay.findMany({
      where: {
        status: STAY_STATUS.ACTIVE,
        bedAssignments: { none: { endedAt: null } },
      },
      include: { resident: { select: { id: true, firstName: true, lastName: true, cohort: true } } },
      orderBy: { intakeAt: 'asc' },
    }),

    prisma.maintenanceRequest.findMany({
      where: urgentOpenWhere(),
      include: { apartment: { select: { id: true, name: true } } },
      orderBy: { reportedAt: 'asc' },
    }),

    // A bed nobody can use is capacity the house is paying for.
    prisma.bed.findMany({
      where: { status: BED_STATUS.OUT_OF_SERVICE },
      include: { apartment: { select: { id: true, name: true } } },
    }),

    // The hourly round: an apartment past the alarm, and anyone the latest
    // check could not find. Both derive through services/checks.js — the one
    // knob — and clear themselves the moment a check or sign-out lands.
    overdueApartmentChecks(),
    unaccountedResidents(),
  ])

  const items = []

  for (const s of overdue) {
    items.push({
      id: `overdue:${s.id}`,
      level: LEVEL.ACTION,
      kind: 'OVERDUE_SIGN_OUT',
      title: `${s.stay.resident.firstName} ${s.stay.resident.lastName} has not returned`,
      // Destination is operational, and the person acting on this needs to
      // know where to start looking.
      detail: `Expected back ${formatFacilityTime(s.expectedReturnAt)} · ${s.destination}`,
      to: '/sign-outs',
      // Expected-return as the timestamp: the longest overdue sorts first.
      at: s.expectedReturnAt,
    })
  }

  for (const stay of unhoused) {
    items.push({
      id: `unhoused:${stay.id}`,
      level: LEVEL.ACTION,
      kind: 'UNHOUSED',
      title: `${stay.resident.firstName} ${stay.resident.lastName} has no bed`,
      detail: 'In the programme and not yet placed.',
      to: `/residents/${stay.resident.id}`,
      at: stay.intakeAt,
    })
  }

  for (const r of urgent) {
    items.push({
      id: `urgent:${r.id}`,
      level: LEVEL.ACTION,
      kind: 'URGENT_MAINTENANCE',
      title: r.title,
      detail: `Urgent · ${r.apartment.name}`,
      to: `/apartments/${r.apartment.id}`,
      at: r.reportedAt,
    })
  }

  for (const c of checksOverdue) {
    items.push({
      id: `check:${c.apartment.id}`,
      level: LEVEL.ACTION,
      kind: 'APARTMENT_CHECK_OVERDUE',
      title: `${c.apartment.name} has not been checked`,
      detail: c.lastCheckAt
        ? `Last check ${formatFacilityTime(c.lastCheckAt)} · ${c.byName}`
        : 'Never checked.',
      to: '/checks',
      // The longest-unwalked apartment sorts first.
      at: c.since,
    })
  }

  for (const r of notAccounted) {
    items.push({
      id: `notfound:${r.stayId}`,
      level: LEVEL.ACTION,
      kind: 'RESIDENT_NOT_ACCOUNTED',
      // A name against "not found" is operational, the same test the overdue
      // sign-out item passes: whoever acts needs to know who to look for.
      title: `${r.fullName} was not found at the last check`,
      detail: `${r.apartmentName} · ${formatFacilityTime(r.at)}`,
      to: '/checks',
      at: r.at,
    })
  }

  for (const bed of staleOpen) {
    items.push({
      id: `oos:${bed.id}`,
      level: LEVEL.WATCH,
      kind: 'BED_OUT_OF_SERVICE',
      title: `${bed.apartment.name} · ${bed.label} is out of service`,
      detail: bed.outOfServiceNote ?? 'No note recorded.',
      to: `/apartments/${bed.apartment.id}`,
      at: bed.updatedAt,
    })
  }

  // Things needing a decision first, then oldest first inside each level: the
  // situation that has been true longest is the one being ignored.
  const rank = { [LEVEL.ACTION]: 0, [LEVEL.WATCH]: 1 }
  items.sort((a, b) => rank[a.level] - rank[b.level] || new Date(a.at) - new Date(b.at))

  return {
    items,
    // Only the actionable ones drive the badge. A bed out of service is worth
    // seeing but is not a number anyone should feel behind on.
    actionCount: items.filter((i) => i.level === LEVEL.ACTION).length,
  }
}
