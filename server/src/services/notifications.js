import { prisma } from '../db/client.js'
import { BED_STATUS, STAY_STATUS } from '../domain/constants.js'
import { formatFacilityTime } from '../lib/facilityTime.js'
import { overdueApartmentChecks, unaccountedResidents } from './checks.js'
import { MAINTENANCE_STATE, bellMaintenanceWhere, requestState } from './maintenance.js'
import { unmarkedDoses } from './meds.js'
import { overduePasses } from './passes.js'
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

/** Level drives ordering and the badge count. Kept small on purpose. */
const LEVEL = { ACTION: 'action', WATCH: 'watch' }

/**
 * How LATE a situation is — a different question from whether it needs a person.
 *
 * `level` answers "does somebody have to do something?" and drives actionCount.
 * `severity` answers "has a clock run out?", which is what a red badge means.
 * The two do not collapse: an ACTION item is often only WARNING — nobody is
 * late because a resident has no bed — and a WATCH item is never CRITICAL.
 *
 * IT IS DECIDED HERE BECAUSE FOR ONE KIND THE CLIENT CANNOT DECIDE IT.
 * `URGENT_MAINTENANCE` is the union of urgent-and-open with past-its-own-target
 * (`bellMaintenanceWhere()`), and telling those apart needs `priority` and
 * `reportedAt` against MAINTENANCE_TARGET_MS — neither of which crosses the
 * wire. The only alternative was parsing the `detail` sentence, which would
 * make a string load-bearing. This is the dashboard's own precedent, where
 * `attention.urgentMaintenance` carries `state` and `priority` so the client
 * need not re-derive the rule.
 *
 * The vocabulary is the app's existing one, deliberately not a third set of
 * names for one judgement: `facilityStatus()` returns critical / warning, and
 * the resident rail's SECTION_DOT uses the same two words. Every per-kind
 * choice below was already made by one of those two — overdue is critical and
 * unplaced is warning in `facilityStatus()`; `notAccounted` is CRITICAL in
 * `sectionDots()`.
 *
 * EVERY item carries it, watch items included. A field that is sometimes
 * absent is a third state nobody decided.
 *
 * NOT a module 13 disclosure: it is a severity flag on a situation this same
 * item already states in full — no name, no count, nothing clinical. And module
 * 12's "the payload is `{ at }` and nothing else" rule governs the `changed`
 * SOCKET, where RLS does not apply to a fan-out. This is the authenticated,
 * staff-gated HTTP read, decided per request.
 */
export const NOTIFICATION_SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  WARNING: 'warning',
})
const SEV = NOTIFICATION_SEVERITY

export async function listNotifications() {
  const [overdue, unhoused, urgent, staleOpen, checksOverdue, notAccounted, medsDue, passesLate] = await Promise.all([
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

    // Urgent-and-open at any age, OR open past its own priority's target.
    // A union, not a replacement: an urgent request filed twenty minutes ago
    // is a hazard and belongs here before any clock has run, while a normal
    // request that has sat a fortnight was invisible everywhere until
    // 2026-08-07. One knob, shared with the dashboard.
    prisma.maintenanceRequest.findMany({
      where: bellMaintenanceWhere(),
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

    // The med pass: doses due now with nothing recorded. COUNTS AND A TIME
    // ONLY — see below, and see unmarkedDoses() for why DUE and never MISSED.
    unmarkedDoses(),

    // Passes past their return time plus the hour of grace. Derived through
    // the module's own knob, so the bell and /passes cannot disagree.
    overduePasses(),
  ])

  const items = []

  for (const s of overdue) {
    items.push({
      id: `overdue:${s.id}`,
      level: LEVEL.ACTION,
      // `facilityStatus()` already calls an overdue return critical, and this
      // file's own comment calls it "the loudest state in the app".
      severity: SEV.CRITICAL,
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
      // WARNING, not critical, and the split is `facilityStatus()`'s: unplaced
      // is a thing to do today, not a clock that has run out. Nobody is late.
      severity: SEV.WARNING,
      kind: 'UNHOUSED',
      title: `${stay.resident.firstName} ${stay.resident.lastName} has no bed`,
      detail: 'In the programme and not yet placed.',
      to: `/residents/${stay.resident.id}`,
      at: stay.intakeAt,
    })
  }

  for (const r of urgent) {
    // The detail says WHICH of the two reasons put it here, because they call
    // for different things: an urgent repair needs somebody now, an overdue one
    // needs chasing. Overdue wins when a request is both — it is the louder
    // fact. `URGENT_MAINTENANCE` stays the kind: the client maps it to an icon,
    // and renaming it would be a client change for no gain.
    const overdue = requestState(r) === MAINTENANCE_STATE.OVERDUE
    items.push({
      id: `urgent:${r.id}`,
      level: LEVEL.ACTION,
      // The one kind whose severity a client cannot derive — see
      // NOTIFICATION_SEVERITY. It costs nothing here because `overdue` is
      // already computed on the line above for the detail, and it follows the
      // same rule that sentence does: overdue wins when a request is both.
      severity: overdue ? SEV.CRITICAL : SEV.WARNING,
      kind: 'URGENT_MAINTENANCE',
      title: r.title,
      detail: `${overdue ? 'Overdue' : 'Urgent'} · ${r.apartment.name}`,
      // /maintenance, not /apartments/:id — the apartment page is
      // manager-only, so this item used to send a tech to a screen they
      // cannot open. The bell is all-staff and so is its destination.
      to: '/maintenance',
      at: r.reportedAt,
    })
  }

  for (const c of checksOverdue) {
    items.push({
      id: `check:${c.apartment.id}`,
      level: LEVEL.ACTION,
      // Past the rolling alarm — a clock has run out by construction.
      severity: SEV.CRITICAL,
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
      // `sectionDots()` gives this SECTION_DOT.CRITICAL on the resident record
      // — "the record's loudest fact". The same judgement, the same word.
      severity: SEV.CRITICAL,
      kind: 'RESIDENT_NOT_ACCOUNTED',
      // A name against "not found" is operational, the same test the overdue
      // sign-out item passes: whoever acts needs to know who to look for.
      title: `${r.fullName} was not found at the last check`,
      detail: `${r.apartmentName} · ${formatFacilityTime(r.at)}`,
      to: '/checks',
      at: r.at,
    })
  }

  // The med pass, and this item is the ANSWER to the warning in this file's
  // own header — "nothing from module 5 or 6 belongs in a bell without a
  // separate think about who is standing behind the phone." The think happened
  // on 2026-08-07 and the answer is: a count and a time, nothing else.
  //
  // No resident name and no medication, ever. A count says the pass has not
  // been run, which is operational; a name against a medication is a clinical
  // disclosure to whoever is reading over the shoulder of the person holding a
  // shared house phone. That is why this item is shaped unlike its neighbours
  // — RESIDENT_NOT_ACCOUNTED names somebody deliberately, and the difference
  // between the two is the whole of module 13's rule.
  if (medsDue) {
    items.push({
      id: 'meds:due',
      level: LEVEL.ACTION,
      // WARNING deliberately: this counts DUE doses only, never MISSED, so by
      // construction nothing here is past its two-hour grace yet.
      severity: SEV.WARNING,
      kind: 'MED_PASS_DUE',
      title:
        medsDue.count === 1 ? '1 dose not yet recorded' : `${medsDue.count} doses not yet recorded`,
      detail: `${medsDue.label} med pass · ${medsDue.residents} ${medsDue.residents === 1 ? 'resident' : 'residents'}`,
      to: '/meds',
      at: medsDue.at,
    })
  }

  for (const p of passesLate) {
    items.push({
      id: `pass:${p.id}`,
      level: LEVEL.ACTION,
      // The dashboard row for this same pass already takes a destructive badge
      // (module 14, 2026-08-08); this is that decision said once more.
      severity: SEV.CRITICAL,
      kind: 'PASS_OVERDUE',
      title: `${p.fullName} is not back from their pass`,
      // The DESTINATION rides here, exactly as it does on the overdue sign-out
      // item and for the same reason: whoever acts on this needs to know where
      // to start looking. The census tile still withholds it — that board is
      // glanced at with residents around, and this is a work queue.
      detail: `Due back ${formatFacilityTime(p.returnBy)} · ${p.destination}`,
      to: '/passes',
      // Return time as the timestamp: the longest overdue sorts first.
      at: p.returnBy,
    })
  }

  for (const bed of staleOpen) {
    items.push({
      id: `oos:${bed.id}`,
      level: LEVEL.WATCH,
      // A watch item is never critical — that is what makes it a watch item.
      severity: SEV.WARNING,
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
