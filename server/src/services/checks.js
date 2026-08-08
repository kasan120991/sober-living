import { prisma, runInTransaction } from '../db/client.js'
import { HttpError } from '../middleware/authorize.js'
import { CHECK_RESIDENT_STATUS, CHECK_STATE, PRESENCE, STAY_STATUS } from '../domain/constants.js'
import { facilityHourKey, facilityStartOfToday, facilityWallClockToUtc } from '../lib/facilityTime.js'
import { presenceOf } from './signOuts.js'

/**
 * Apartment checks: the hourly round. Staff walk each apartment every hour,
 * 24/7, account for everyone who should be on site, and note what each present
 * resident is doing.
 *
 * Everything hour-shaped is DERIVED from `checkedAt` on read — hour buckets,
 * DUE, OVERDUE, MISSED — never stored. Same pattern as sign-out presence: no
 * cron, no state to go stale. Buckets are facility wall-clock labels
 * (facilityHourKey); the ALARM is rolling and bucket-free, so DST fall-back
 * and spring-forward need no special case anywhere.
 */

/** The round cadence: one check per apartment per hour. */
export const CHECK_INTERVAL_MS = 60 * 60_000

/**
 * How far past the hour a round may run before the app starts shouting.
 * Facility policy (chosen 2026-08-06): fifteen minutes, the same figure as
 * OVERDUE_GRACE_MS on sign-outs — one consistent idea of "late".
 *
 * THE one knob. The page, the bell and the dashboard all derive overdue
 * through checkOverdueCutoff(), so changing it here changes it everywhere.
 */
export const CHECK_GRACE_MS = 15 * 60_000

/** Apartments whose latest check is older than this instant are overdue. */
export function checkOverdueCutoff(now = new Date()) {
  return new Date(now.getTime() - (CHECK_INTERVAL_MS + CHECK_GRACE_MS))
}

/**
 * Who was signed out AT a given instant — the one definition.
 *
 * A sign-out covers `[outAt, returnedAt)`, with an open one running to now.
 * Extracted from amendCheck on 2026-08-08 when the resident record's trail
 * needed the same question answered: two copies of "who was out then" is how
 * the amendment validator and the display come to disagree about it, and one of
 * those two is evidence.
 *
 * The soft-delete extension keeps removed-in-error sign-outs out of this by
 * construction, which is also why a check line stores no signOutId — see the
 * ApartmentCheckResident note in schema.prisma.
 */
export function signedOutAtWhere(stayIds, instant) {
  return {
    stayId: { in: [...stayIds] },
    outAt: { lte: instant },
    OR: [{ returnedAt: null }, { returnedAt: { gte: instant } }],
  }
}

/** The current view: checks no amendment has superseded. */
const CURRENT_ONLY = { supersededBy: { is: null } }

const NAME = { select: { id: true, firstName: true, lastName: true } }
const fullName = (r) => `${r.firstName} ${r.lastName}`

/**
 * An apartment's standing in the round, from its latest current check.
 * No check ever reads OVERDUE, not blank — an apartment nobody has walked is
 * exactly what the alarm exists for.
 */
function checkStateOf(lastCheckedAt, now) {
  if (!lastCheckedAt) return CHECK_STATE.OVERDUE
  if (facilityHourKey(lastCheckedAt) === facilityHourKey(now)) return CHECK_STATE.CHECKED
  if (lastCheckedAt < checkOverdueCutoff(now)) return CHECK_STATE.OVERDUE
  return CHECK_STATE.DUE
}

/**
 * Who should be accounted for in this apartment right now.
 *
 * Occupants of the apartment's beds, with presence derived from open
 * sign-outs. Serves GET /checks/roster/:apartmentId AND the re-derivation
 * inside recordCheck's transaction — one source, so the sheet and the save
 * cannot disagree about who belongs on the check.
 */
export async function rosterFor(apartmentId) {
  const apartment = await prisma.apartment.findUnique({
    where: { id: apartmentId },
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
                  resident: NAME,
                  program: { select: { name: true } },
                  signOuts: {
                    where: { returnedAt: null },
                    select: { id: true, outAt: true, expectedReturnAt: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!apartment) throw new HttpError(404, 'Apartment not found')

  const now = new Date()
  const people = apartment.beds
    .filter((b) => b.assignments.length > 0)
    .map((b) => {
      const stay = b.assignments[0].stay
      const openSignOut = stay.signOuts[0] ?? null
      return {
        stayId: stay.id,
        residentId: stay.resident.id,
        fullName: fullName(stay.resident),
        bedLabel: b.label,
        programName: stay.program?.name ?? null,
        // State and times only, never a destination — the sheet is read in a
        // hallway with residents around, the census-tile rule.
        presence: presenceOf(openSignOut, now),
      }
    })

  return {
    apartment: { id: apartment.id, name: apartment.name, cohort: apartment.cohort },
    people,
  }
}

/** Validates one submission's lines against a roster's open sign-outs. */
function validateLines(lines, outStayIds) {
  for (const line of lines) {
    const isOut = outStayIds.has(line.stayId)
    if (line.status === CHECK_RESIDENT_STATUS.PRESENT && !line.note?.trim()) {
      throw new HttpError(400, 'Each present resident needs a note of what they were doing.')
    }
    if (line.status === CHECK_RESIDENT_STATUS.SIGNED_OUT && !isOut) {
      throw new HttpError(409, 'Someone marked signed out has no open sign-out. Reload and try again.')
    }
    if (line.status === CHECK_RESIDENT_STATUS.NOT_FOUND && isOut) {
      throw new HttpError(
        409,
        'A signed-out resident is accounted for by the sign-out. Mark them signed out — or present, if they are on site.',
      )
    }
  }
}

/** Refuses a submission whose stayIds are not exactly `expected`. */
function requireExactCoverage(lines, expected, message) {
  const submitted = new Set(lines.map((l) => l.stayId))
  if (submitted.size !== lines.length) {
    throw new HttpError(400, 'A resident appears twice on this check.')
  }
  const missing = [...expected].some((id) => !submitted.has(id))
  const extra = [...submitted].some((id) => !expected.has(id))
  if (missing || extra) throw new HttpError(409, message)
}

const WITH_DETAIL = {
  residents: { include: { stay: { include: { resident: NAME } } } },
  recordedBy: { select: { id: true, fullName: true } },
}

function shapeLine(l) {
  return {
    stayId: l.stayId,
    residentId: l.stay.resident.id,
    fullName: fullName(l.stay.resident),
    status: l.status,
    note: l.note,
  }
}

function accountedOf(lines) {
  const count = (status) => lines.filter((l) => l.status === status).length
  return {
    present: count(CHECK_RESIDENT_STATUS.PRESENT),
    signedOut: count(CHECK_RESIDENT_STATUS.SIGNED_OUT),
    notFound: count(CHECK_RESIDENT_STATUS.NOT_FOUND),
  }
}

function shapeCheck(c) {
  return {
    id: c.id,
    apartmentId: c.apartmentId,
    checkedAt: c.checkedAt,
    note: c.note,
    recordedBy: c.recordedBy,
    amended: Boolean(c.supersedesId),
    amendmentReason: c.amendmentReason,
    accounted: accountedOf(c.residents),
    residents: c.residents.map(shapeLine),
  }
}

/** One check in full, for the amend sheet. */
export async function getCheck(id) {
  const check = await prisma.apartmentCheck.findUnique({
    where: { id },
    include: {
      ...WITH_DETAIL,
      apartment: { select: { id: true, name: true } },
      supersededBy: { select: { id: true } },
    },
  })
  if (!check) throw new HttpError(404, 'Check not found')
  return {
    ...shapeCheck(check),
    apartment: check.apartment,
    superseded: Boolean(check.supersededBy),
  }
}

/**
 * Record one round of one apartment.
 *
 * `checkedAt` is ALWAYS the server clock. A client-supplied time is an
 * invitation to back-fill the 2 PM round at 4; a round genuinely saved late
 * lands in the hour it was saved, which is the honest record.
 *
 * The roster is RE-DERIVED inside the transaction and the submission must
 * cover it exactly — an assignment or sign-out that changed between the
 * sheet loading and Save turns into a 409 and a reload, never into a check
 * that misdescribes who was there to be counted.
 */
export function recordCheck(input, actorId) {
  return runInTransaction(async () => {
    const { people } = await rosterFor(input.apartmentId)
    const expected = new Set(people.map((p) => p.stayId))
    requireExactCoverage(input.lines, expected, 'The roster changed — reload and record again.')

    const outNow = new Set(
      people.filter((p) => p.presence.state !== PRESENCE.IN).map((p) => p.stayId),
    )
    validateLines(input.lines, outNow)

    const check = await prisma.apartmentCheck.create({
      data: {
        apartmentId: input.apartmentId,
        checkedAt: new Date(),
        note: input.note?.trim() || null,
        recordedById: actorId,
        residents: {
          create: input.lines.map((l) => ({
            stayId: l.stayId,
            status: l.status,
            note: l.note?.trim() || null,
          })),
        },
      },
      include: WITH_DETAIL,
    })
    return shapeCheck(check)
  })
}

/**
 * Correct a check with an amendment — a pure INSERT, per the amendment
 * pattern in the schema footer.
 *
 * The amendment describes the SAME visit: it carries the original's
 * apartment and `checkedAt` verbatim (it corrects what was observed, never
 * when, so it stays in its own hour bucket), and restated lines must cover
 * exactly the original's line set — the visit already happened, and letting
 * an amendment add or drop people is how a check stops being evidence of
 * that hour. Line rules are re-validated as of the original instant.
 */
export function amendCheck(id, input, actorId) {
  return runInTransaction(async () => {
    const original = await prisma.apartmentCheck.findUnique({
      where: { id },
      include: { residents: true, supersededBy: { select: { id: true } } },
    })
    if (!original) throw new HttpError(404, 'Check not found')
    if (original.supersededBy) {
      throw new HttpError(409, 'This check has already been amended. Amend the latest version.')
    }

    const lines =
      input.lines ??
      original.residents.map((r) => ({ stayId: r.stayId, status: r.status, note: r.note ?? undefined }))
    const expected = new Set(original.residents.map((r) => r.stayId))
    requireExactCoverage(
      lines,
      expected,
      'An amendment covers exactly the residents of the check it corrects.',
    )

    // Who was signed out AT THE ORIGINAL INSTANT — not now. (The soft-delete
    // extension keeps removed-in-error sign-outs out of this.)
    const openThen = await prisma.signOut.findMany({
      where: signedOutAtWhere(expected, original.checkedAt),
      select: { stayId: true },
    })
    validateLines(lines, new Set(openThen.map((s) => s.stayId)))

    const check = await prisma.apartmentCheck.create({
      data: {
        apartmentId: original.apartmentId,
        checkedAt: original.checkedAt,
        // Anything not restated carries over, so an amendment fixing one
        // line does not silently blank the apartment note.
        note: input.note !== undefined ? input.note.trim() || null : original.note,
        recordedById: actorId,
        supersedesId: original.id,
        amendmentReason: input.amendmentReason,
        residents: {
          create: lines.map((l) => ({
            stayId: l.stayId,
            status: l.status,
            note: l.note?.trim() || null,
          })),
        },
      },
      include: WITH_DETAIL,
    })
    return shapeCheck(check)
  })
}

/** The latest current check of every apartment, one query over the composite index. */
function latestChecks(include) {
  return prisma.apartmentCheck.findMany({
    where: CURRENT_ONLY,
    orderBy: [{ apartmentId: 'asc' }, { checkedAt: 'desc' }],
    distinct: ['apartmentId'],
    include,
  })
}

/**
 * The whole board in one read: figures, per-apartment standing, today's log.
 *
 * Three bounded queries and JS assembly — this is refetched on every realtime
 * invalidation, so it must stay dashboard-grade. No per-resident loops.
 */
export async function houseChecks() {
  const now = new Date()
  const startOfToday = facilityStartOfToday(now)

  const [apartments, todays, latest] = await Promise.all([
    prisma.apartment.findMany({
      orderBy: { name: 'asc' },
      include: {
        beds: {
          where: { deletedAt: null },
          include: {
            assignments: {
              where: { endedAt: null },
              include: {
                stay: {
                  select: { id: true, signOuts: { where: { returnedAt: null }, select: { id: true } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.apartmentCheck.findMany({
      where: { checkedAt: { gte: startOfToday }, ...CURRENT_ONLY },
      orderBy: { checkedAt: 'desc' },
      include: {
        residents: { select: { status: true } },
        recordedBy: { select: { id: true, fullName: true } },
      },
    }),
    latestChecks({
      residents: {
        include: {
          stay: {
            select: {
              id: true,
              status: true,
              resident: NAME,
              signOuts: { where: { returnedAt: null }, select: { id: true } },
            },
          },
        },
      },
      recordedBy: { select: { id: true, fullName: true } },
    }),
  ])

  const lastByApartment = new Map(latest.map((c) => [c.apartmentId, c]))
  const hourNow = facilityHourKey(now)

  const shapedApartments = apartments.map((a) => {
    const occupants = a.beds.filter((b) => b.assignments.length > 0)
    const onSite = occupants.filter((b) => b.assignments[0].stay.signOuts.length === 0)
    const last = lastByApartment.get(a.id) ?? null
    return {
      id: a.id,
      name: a.name,
      cohort: a.cohort,
      occupants: occupants.length,
      onSite: onSite.length,
      lastCheck: last
        ? {
            id: last.id,
            at: last.checkedAt,
            byName: last.recordedBy.fullName,
            accounted: accountedOf(last.residents),
            amended: Boolean(last.supersedesId),
          }
        : null,
      state: checkStateOf(last?.checkedAt ?? null, now),
    }
  })
  // Most overdue first: never-checked, then oldest last check; CHECKED sinks.
  shapedApartments.sort((x, y) => {
    const ax = x.lastCheck ? new Date(x.lastCheck.at).getTime() : 0
    const ay = y.lastCheck ? new Date(y.lastCheck.at).getTime() : 0
    return ax - ay
  })

  // Not accounted for right now: NOT_FOUND on the latest check, still an
  // active stay, no open sign-out. Clears itself the moment any of those
  // change — derived, like everything else on this read.
  const notAccounted = latest.flatMap((c) =>
    c.residents.filter(
      (l) =>
        l.status === CHECK_RESIDENT_STATUS.NOT_FOUND &&
        l.stay.status === STAY_STATUS.ACTIVE &&
        l.stay.signOuts.length === 0,
    ),
  ).length

  // Today's elapsed hour buckets, newest first, by stepping REAL hours from
  // facility midnight and deduping the labels — the whole DST story.
  const bucketKeys = []
  for (let t = startOfToday.getTime(); t <= now.getTime(); t += CHECK_INTERVAL_MS) {
    const key = facilityHourKey(t)
    if (!bucketKeys.includes(key)) bucketKeys.push(key)
  }
  const apartmentNames = new Map(apartments.map((a) => [a.id, a.name]))
  const log = bucketKeys.reverse().map((hourKey) => {
    const checks = todays
      .filter((c) => facilityHourKey(c.checkedAt) === hourKey)
      .map((c) => ({
        id: c.id,
        apartmentId: c.apartmentId,
        apartmentName: apartmentNames.get(c.apartmentId) ?? null,
        at: c.checkedAt,
        byName: c.recordedBy.fullName,
        accounted: accountedOf(c.residents),
        amended: Boolean(c.supersedesId),
        amendmentReason: c.amendmentReason,
      }))
    const covered = new Set(checks.map((c) => c.apartmentId))
    return {
      hourKey,
      checks,
      // The current hour is DUE, not MISSED — no callout until it has passed.
      missing:
        hourKey === hourNow
          ? []
          : apartments.filter((a) => !covered.has(a.id)).map((a) => a.name),
    }
  })

  const checkedThisHour = shapedApartments.filter((a) => a.state === CHECK_STATE.CHECKED).length
  return {
    now,
    hour: { key: hourNow, checked: checkedThisHour, of: apartments.length },
    figures: {
      apartments: apartments.length,
      checkedThisHour,
      overdue: shapedApartments.filter((a) => a.state === CHECK_STATE.OVERDUE).length,
      checksToday: todays.length,
      missedToday: log.reduce((n, b) => n + b.missing.length, 0),
      notAccounted,
    },
    apartments: shapedApartments,
    log,
  }
}

/**
 * Apartments past the alarm, for the bell and the dashboard — the
 * urgentOpenWhere()/overdueWhere() pattern: modules export their own
 * derivation so every surface shares the one knob.
 */
export async function overdueApartmentChecks(now = new Date()) {
  const [apartments, latest] = await Promise.all([
    prisma.apartment.findMany({
      select: { id: true, name: true, cohort: true, createdAt: true },
      orderBy: { name: 'asc' },
    }),
    latestChecks({ recordedBy: { select: { fullName: true } } }),
  ])
  const lastBy = new Map(latest.map((c) => [c.apartmentId, c]))
  const cutoff = checkOverdueCutoff(now)
  return apartments
    .filter((a) => {
      const last = lastBy.get(a.id)
      return !last || last.checkedAt < cutoff
    })
    .map((a) => {
      const last = lastBy.get(a.id) ?? null
      return {
        apartment: { id: a.id, name: a.name, cohort: a.cohort },
        lastCheckAt: last?.checkedAt ?? null,
        byName: last?.recordedBy.fullName ?? null,
        // Longest-ignored sorts first; a never-checked apartment counts from
        // the day it was created.
        since: last?.checkedAt ?? a.createdAt,
      }
    })
}

/**
 * Residents whose latest check says NOT_FOUND and whom nothing has accounted
 * for since — no newer check, no open sign-out, stay still active. Derived on
 * read; clears itself, like every bell item.
 *
 * THE one predicate, and it is per-APARTMENT-latest-check on purpose: during
 * a bed move a resident's own newest line can say PRESENT on the new
 * apartment while the old apartment's latest check still carries their
 * NOT_FOUND — and that check stands until the old apartment is walked again.
 * The bell, the dashboard and the resident record all derive through here,
 * so they cannot disagree about who is unaccounted for.
 */
async function unaccountedLines({ stayId } = {}) {
  const latest = await latestChecks({
    apartment: { select: { name: true } },
    recordedBy: { select: { fullName: true } },
    residents: {
      where: { status: CHECK_RESIDENT_STATUS.NOT_FOUND, ...(stayId && { stayId }) },
      include: {
        stay: {
          select: {
            id: true,
            status: true,
            resident: NAME,
            signOuts: { where: { returnedAt: null }, select: { id: true } },
          },
        },
      },
    },
  })
  return latest.flatMap((c) =>
    c.residents
      .filter((l) => l.stay.status === STAY_STATUS.ACTIVE && l.stay.signOuts.length === 0)
      .map((l) => ({
        stayId: l.stayId,
        residentId: l.stay.resident.id,
        fullName: fullName(l.stay.resident),
        apartmentName: c.apartment.name,
        byName: c.recordedBy.fullName,
        at: c.checkedAt,
      })),
  )
}

export const unaccountedResidents = () => unaccountedLines()

/**
 * One resident's standing in the round, for the record's hero and its red
 * dot: are they unaccounted for right now (the bell's own derivation, scoped
 * to their stay), and when were they last seen on site.
 */
export async function residentCheckStatus(stayId) {
  const [unaccounted, lastPresent] = await Promise.all([
    unaccountedLines({ stayId }),
    prisma.apartmentCheckResident.findFirst({
      where: {
        stayId,
        status: CHECK_RESIDENT_STATUS.PRESENT,
        check: { supersededBy: { is: null } },
      },
      orderBy: [{ check: { checkedAt: 'desc' } }, { id: 'desc' }],
      include: {
        check: {
          include: {
            apartment: { select: { name: true } },
            recordedBy: { select: { fullName: true } },
          },
        },
      },
    }),
  ])
  const flag = unaccounted[0] ?? null
  return {
    notAccounted: flag
      ? { checkedAt: flag.at, apartmentName: flag.apartmentName, byName: flag.byName }
      : null,
    lastSeen: lastPresent
      ? {
          checkedAt: lastPresent.check.checkedAt,
          apartmentName: lastPresent.check.apartment.name,
          note: lastPresent.note,
          byName: lastPresent.check.recordedBy.fullName,
        }
      : null,
  }
}

/** The instants bounding one facility calendar day. */
function facilityDayBounds(dateStr) {
  const next = new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10)
  return {
    gte: facilityWallClockToUtc(dateStr, '00:00'),
    lt: facilityWallClockToUtc(next, '00:00'),
  }
}

const encodeCursor = (l) =>
  Buffer.from(`${l.check.checkedAt.toISOString()}|${l.id}`).toString('base64url')

function decodeCursor(s) {
  const raw = Buffer.from(s, 'base64url').toString()
  const split = raw.indexOf('|')
  const t = split > 0 ? new Date(raw.slice(0, split)) : null
  const id = split > 0 ? raw.slice(split + 1) : ''
  if (!t || Number.isNaN(t.getTime()) || !id) throw new HttpError(400, 'Invalid cursor')
  return { t, id }
}

/**
 * One resident's trail through the rounds — the record's Apartment checks
 * section. Read-only, active stay only (the Service/Ledger/Schedule
 * precedent), newest first, keyset-paginated because a 24/7 hourly round
 * writes this person ~24 lines a day.
 *
 * Superseded checks are filtered out, so an amended check appears ONCE, in
 * its original hour (amendments carry checkedAt verbatim), marked `amended`.
 */
export async function residentChecks(residentId, { date, cursor, limit = 50 } = {}) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  if (!stay) return { hasActiveStay: false, stayId: null, status: null, lines: [], nextCursor: null }

  // A date filter shows one whole facility day — small by construction, so
  // the cursor is ignored rather than combined.
  const c = !date && cursor ? decodeCursor(cursor) : null
  const where = {
    stayId: stay.id,
    check: {
      supersededBy: { is: null },
      ...(date && { checkedAt: facilityDayBounds(date) }),
    },
    // Prisma's native `cursor` cannot cross a relation, so keyset is a
    // hand-built (checkedAt, id) comparison. Line ids are uuid(7), so the id
    // tiebreak is deterministic even when two checks share an instant.
    ...(c && {
      AND: [
        {
          OR: [
            { check: { checkedAt: { lt: c.t } } },
            { check: { checkedAt: c.t }, id: { lt: c.id } },
          ],
        },
      ],
    }),
  }

  const rows = await prisma.apartmentCheckResident.findMany({
    where,
    orderBy: [{ check: { checkedAt: 'desc' } }, { id: 'desc' }],
    // One extra row detects whether a next page exists at all.
    take: limit + 1,
    include: {
      check: {
        include: {
          apartment: { select: { name: true } },
          recordedBy: { select: { fullName: true } },
        },
      },
    },
  })

  const page = rows.slice(0, limit)
  const purposeByLine = await signOutPurposes(stay.id, page)

  return {
    hasActiveStay: true,
    stayId: stay.id,
    // The hero rides on page one only — Load-more pages skip the two extra
    // queries and the client keeps the hero it already has.
    status: c ? null : await residentCheckStatus(stay.id),
    lines: page.map((l) => ({
      id: l.id,
      checkId: l.checkId,
      checkedAt: l.check.checkedAt,
      status: l.status,
      note: l.note,
      // WHY they were out, and deliberately never WHERE. See signOutPurposes().
      purpose: purposeByLine.get(l.id) ?? null,
      apartmentName: l.check.apartment.name,
      byName: l.check.recordedBy.fullName,
      amended: Boolean(l.check.supersedesId),
      amendmentReason: l.check.amendmentReason,
    })),
    nextCursor: !date && rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  }
}

/**
 * The PURPOSE of the sign-out covering each SIGNED_OUT line on a page.
 *
 * `destination` is never selected, and that is the point rather than an
 * oversight. CLAUDE.md withholds where somebody went from the census tile and
 * the check sheet — a board read over a resident's shoulder — and grants it only
 * to the bell and the dashboard, where somebody must act on an overdue return.
 * This trail is a third case and the argument against it is that it is a
 * HISTORY: a run of destinations over weeks reads as a pattern of where a
 * person goes, on a page any staff member can open. The purpose explains the
 * absence without recording where they physically were.
 *
 * Known and accepted (2026-08-08): `purpose` is unreviewed free text, so this
 * rule is enforced by WHICH COLUMN IS READ, not by what the column holds —
 * nothing stops somebody typing a place into it. The mitigation is at the point
 * of entry, where AppSignOutDialog steers the field toward a reason; there is no
 * mitigation available here, because the free-text field IS the thing being
 * shown.
 *
 * ONE QUERY FOR THE WHOLE PAGE, not one per line: the trail returns up to fifty
 * lines, and a lookup each is the per-row query loop CLAUDE.md forbids on a
 * composed read. The page's span bounds a single fetch and the containment is
 * resolved in memory.
 */
async function signOutPurposes(stayId, page) {
  const signedOut = page.filter((l) => l.status === CHECK_RESIDENT_STATUS.SIGNED_OUT)
  if (!signedOut.length) return new Map()

  const instants = signedOut.map((l) => l.check.checkedAt)
  const oldest = new Date(Math.min(...instants))
  const newest = new Date(Math.max(...instants))

  // Every sign-out whose interval overlaps the page at all. Bounded by the same
  // shape as signedOutAtWhere, widened from an instant to a span.
  const covering = await prisma.signOut.findMany({
    where: {
      stayId,
      outAt: { lte: newest },
      OR: [{ returnedAt: null }, { returnedAt: { gte: oldest } }],
    },
    select: { outAt: true, returnedAt: true, purpose: true },
    orderBy: { outAt: 'desc' },
  })
  if (!covering.length) return new Map()

  const out = new Map()
  for (const line of signedOut) {
    const at = line.check.checkedAt
    // Newest-first, so the first match is the sign-out in force at that instant
    // if two ever abut. A line whose sign-out was since soft-deleted simply
    // finds nothing and renders as it did before this existed.
    const match = covering.find((s) => s.outAt <= at && (!s.returnedAt || s.returnedAt >= at))
    if (match?.purpose) out.set(line.id, match.purpose)
  }
  return out
}
