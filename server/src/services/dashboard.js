import { prisma } from '../db/client.js'
import { LEDGER_ENTRY_TYPE, STAY_STATUS } from '../domain/constants.js'
import { overdueApartmentChecks, unaccountedResidents } from './checks.js'
import { balancesByStay } from './ledger.js'
import { overdueByStay } from './invoices.js'
import { fridayNag } from './billing.js'
import { bellMaintenanceWhere, requestState } from './maintenance.js'
import { cohortCapacity, unhousedWithOptions } from './residents.js'
import { scheduleWindow } from './schedule/read.js'
import { listSignOuts } from './signOuts.js'

/**
 * The landing page, in one read.
 *
 * Everything here is composed from the services the modules already have —
 * the same derivations the bell, the pill, the sign-outs page and the schedule
 * board use — so this page cannot disagree with any of them. Nothing is
 * stored, nothing is new policy; a dashboard row and its source page always
 * answer the same question the same way.
 *
 * Names appear in this payload (it is a work queue, like /service), but
 * nothing clinical does — the module 5/6 rule about ambient disclosure applies
 * to this screen more than any other, because it greets every unlock.
 *
 * This is also the most-refetched read in the app: every realtime
 * invalidation lands here. It stays cheap because each piece is one bounded
 * query — do not add per-resident loops to it.
 */

/**
 * Who owes money: every active stay with a positive derived balance, largest
 * first. "Outstanding" KEEPS its name now that invoicing exists: it is still
 * the complete list, and overdue is a property of some rows rather than a
 * different list. Overdue sorts to the top and carries a badge.
 *
 * The total is the sum of the rows beneath it, computed here so the card and
 * the list cannot drift apart. It is a sum of derived balances, never a stored
 * one — `verify-ledger.js` still asserts no balance column exists anywhere.
 * `overdueCents` is the same sum over the overdue rows, for the card's split.
 */
async function outstandingBalances() {
  const stays = await prisma.stay.findMany({
    where: { status: STAY_STATUS.ACTIVE },
    select: {
      id: true,
      resident: { select: { id: true, firstName: true, lastName: true } },
      program: { select: { name: true } },
    },
  })
  if (!stays.length) return { totalCents: 0, owing: [] }

  const stayIds = stays.map((s) => s.id)
  const [balances, lastPayments, overdue] = await Promise.all([
    balancesByStay(stayIds),
    // "Last payment Jul 18" is what turns a number into a judgement call a
    // manager can make at a glance — owing $500 having paid last week is a
    // different situation from owing $500 in silence for a month.
    prisma.ledgerEntry.groupBy({
      by: ['stayId'],
      where: { stayId: { in: stayIds }, type: LEDGER_ENTRY_TYPE.PAYMENT },
      _max: { occurredAt: true },
    }),
    // ONE grouped query, shared with the resident record — module 14's "no
    // per-resident query loops on this read" rule, and the reason the record's
    // red dot and this panel cannot disagree about who is overdue.
    overdueByStay(stayIds),
  ])
  const lastPaymentByStay = new Map(lastPayments.map((r) => [r.stayId, r._max.occurredAt]))

  const owing = stays
    .map((s) => ({
      residentId: s.resident.id,
      residentName: `${s.resident.firstName} ${s.resident.lastName}`,
      programName: s.program?.name ?? null,
      balanceCents: balances.get(s.id) ?? 0,
      lastPaymentAt: lastPaymentByStay.get(s.id) ?? null,
      overdue: overdue.get(s.id) ?? null,
    }))
    .filter((r) => r.balanceCents > 0)
    // Overdue first, then largest. Two keys rather than one because "owes the
    // most" and "is past due" are different urgencies, and the second is the
    // one with a date attached to it.
    .sort(
      (a, b) =>
        Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) || b.balanceCents - a.balanceCents,
    )

  return {
    totalCents: owing.reduce((t, r) => t + r.balanceCents, 0),
    overdueCents: owing.reduce((t, r) => t + (r.overdue ? r.balanceCents : 0), 0),
    owing,
  }
}

export async function dashboard() {
  const [
    signOuts,
    unhoused,
    capacity,
    schedule,
    urgent,
    balances,
    checksOverdue,
    notAccounted,
    nag,
  ] = await Promise.all([
    listSignOuts(),
    unhousedWithOptions(),
    cohortCapacity(),
    // One schedule call feeds two panels: `needsRoll` looks backwards on its
    // own fortnight window regardless of the span asked for, and the one-day
    // window is the "Today" list (a rolling week first; narrowed 2026-08-06).
    scheduleWindow({ days: 1 }),
    // The same union the bell reads — one knob, so a row here and a row there
    // cannot disagree about which repairs are shouting.
    prisma.maintenanceRequest.findMany({
      where: bellMaintenanceWhere(),
      include: { apartment: { select: { id: true, name: true } } },
      orderBy: { reportedAt: 'asc' },
    }),
    outstandingBalances(),
    // The hourly round's two situations, from the same helpers as the bell —
    // one knob, so this panel and the bell cannot disagree.
    overdueApartmentChecks(),
    unaccountedResidents(),
    // The Friday nag. DASHBOARD ONLY, and deliberately not the bell: the bell
    // is glanced at on a shared phone by techs, who cannot open /billing at
    // all, and an item nobody looking at it can act on is noise. This panel is
    // already not identical to the bell — overdue sign-outs and community
    // service were both removed from it — so a row that is only here has
    // precedent. Recorded so it is not "fixed" later.
    fridayNag(),
  ])

  return {
    // ALL open sign-outs, not just overdue: the page derives overdue against
    // its own ticking clock, exactly as the census tiles do, so a resident
    // crossing the grace window surfaces without a refetch.
    signedOut: signOuts.open,

    // The bell's action items, minus overdue sign-outs (they are the panel
    // above, and one situation should not be two rows) and minus anything
    // from community service (left out by request — it stays on /service).
    attention: {
      unhoused,
      needsRoll: schedule.needsRoll,
      checksOverdue,
      notAccounted,
      // `priority` and `state` ride along so the panel can tell the two
      // reasons apart: an URGENT repair always renders (hiding a hazard is not
      // on), while merely-aged ones are capped with an overflow row, the same
      // treatment rolls get. Without these the client would have to re-derive
      // the target rule and could disagree with the server about it.
      urgentMaintenance: urgent.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        state: requestState(r),
        reportedAt: r.reportedAt,
        apartment: r.apartment,
      })),
      // Null unless a billing day has gone past unbilled — the row is absent
      // rather than false, so the panel's "absence means fine" rule holds.
      billingDue: nag.due ? { waiting: nag.waiting, since: nag.since } : null,
    },

    balances,

    // Per cohort, never one total — the client may render one figure only if
    // it also shows the split, because a free women's bed cannot take a man.
    capacity,

    // BAND FORM, the same `{ shared, lanes }` shape as GET /schedule and for
    // the same reason: no server endpoint returns a flat schedule list. The
    // client concatenates the two provably-disjoint bands, as the board does.
    upcoming: {
      from: schedule.from,
      to: schedule.to,
      shared: schedule.shared,
      lanes: schedule.lanes,
    },
  }
}
