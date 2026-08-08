/**
 * Reading the schedule.
 *
 * The board (`scheduleWindow`) is the expander's only consumer since 2026-08-08,
 * when the resident record's diary was replaced by the Attendance section —
 * `residentAttendance` below reads recorded marks and expands nothing.
 *
 * Note what is NOT in a session on the wire: no resident names. The board
 * carries counts, and names appear only when someone deliberately opens a roll.
 * Same rule as the census tile, and for the same reason — this screen is read
 * over somebody's shoulder.
 */
import { prisma } from '../../db/client.js'
import { HttpError } from '../../middleware/authorize.js'
import {
  ATTENDANCE_STATUS,
  COHORT,
  SCHEDULE_MAX_DAYS,
  SESSION_STATE,
  STAY_STATUS,
} from '../../domain/constants.js'
import { facilityToday } from '../../lib/facilityTime.js'
import { addDays, expand, utcToDateKey } from './expand.js'
import { LANE_ORDER, bandOf, mergeSharedSessions } from './band.js'

/**
 * How far back the un-taken-roll queue looks. Two weeks: long enough that a
 * roll missed over a holiday weekend still surfaces, short enough that turning
 * the feature on does not present months of history as a to-do list.
 */
const ROLL_LOOKBACK_DAYS = 14

/**
 * Clamped window. A hand-written `?days=3650` is a report, not a page read, and
 * expansion is only cheap while the window is bounded.
 */
export function windowFrom({ date, days }) {
  const from = date ?? facilityToday()
  const span = Math.min(Math.max(Number(days) || 1, 1), SCHEDULE_MAX_DAYS)
  return { from, to: addDays(from, span - 1), days: span }
}

/** Live occurrences with their event, for expansion. */
async function occurrencesForWindow() {
  return prisma.scheduleOccurrence.findMany({
    include: { event: { select: { id: true, title: true, location: true, description: true } } },
  })
}

/**
 * Roster size per occurrence, counting ACTIVE stays only.
 *
 * This is the discharge story: a closed stay drops out of the count with no
 * write anywhere, because nothing was materialized to go and clean up.
 */
async function rosterCounts(occurrenceIds) {
  if (!occurrenceIds.length) return new Map()
  const rows = await prisma.scheduleAttendee.findMany({
    where: {
      occurrenceId: { in: occurrenceIds },
      stay: { status: STAY_STATUS.ACTIVE },
    },
    select: { occurrenceId: true },
  })
  const counts = new Map()
  for (const r of rows) counts.set(r.occurrenceId, (counts.get(r.occurrenceId) ?? 0) + 1)
  return counts
}

/** Materialized sessions in the window, keyed `occurrenceId|date`. */
async function materializedByKey(occurrenceIds, from, to) {
  if (!occurrenceIds.length) return new Map()
  const rows = await prisma.scheduleSession.findMany({
    where: {
      occurrenceId: { in: occurrenceIds },
      sessionDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    include: {
      attendanceTakenBy: { select: { id: true, fullName: true } },
      _count: { select: { attendance: true } },
    },
  })
  return new Map(rows.map((s) => [`${s.occurrenceId}|${utcToDateKey(s.sessionDate)}`, s]))
}

/**
 * The board read. Returns LANES, never a flat list of sessions.
 *
 * That shape is the enforcement of CLAUDE.md's "never render a combined
 * schedule by accident": a client physically cannot merge the two cohorts
 * without deliberately concatenating two arrays. Same trick cohortCapacity()
 * uses — per-cohort figures rather than one total.
 */
export async function scheduleWindow({ date, days } = {}) {
  const now = new Date()
  const { from, to, days: span } = windowFrom({ date, days })

  // The queue looks BACKWARDS, and does so on its own window rather than the
  // board's. A roll missed last Thursday is exactly the thing that needs
  // chasing, and it would never appear if the queue only saw the days the board
  // happens to be showing.
  const queueFrom = addDays(facilityToday(), -ROLL_LOOKBACK_DAYS)
  const outerFrom = queueFrom < from ? queueFrom : from

  const occurrences = await occurrencesForWindow()
  const ids = occurrences.map((o) => o.id)
  const [counts, sessionsByKey] = await Promise.all([
    rosterCounts(ids),
    materializedByKey(ids, outerFrom, to),
  ])

  const withCounts = (s) => {
    const row = sessionsByKey.get(`${s.occurrenceId}|${s.date}`)
    return {
      ...s,
      rosterCount: counts.get(s.occurrenceId) ?? 0,
      markedCount: row?._count.attendance ?? 0,
      attendanceTakenBy: row?.attendanceTakenBy ?? null,
    }
  }

  // Merge BEFORE anything downstream looks at the rows. A both-cohorts event
  // must become one session here, or it renders twice on the board and appears
  // twice in the queue.
  const board = mergeSharedSessions(expand({ occurrences, from, to, sessionsByKey, now }).map(withCounts))
  const queue = mergeSharedSessions(
    expand({ occurrences, from: queueFrom, to: facilityToday(), sessionsByKey, now }).map(withCounts),
  )

  // Named dayKeys, not days — `days` is this function's own span parameter.
  const dayKeys = datesOf(from, span)

  // Lanes carry ONLY single-cohort sessions. A both-cohorts event lives in the
  // shared band and in neither lane — that exclusion is the whole
  // anti-double-render guarantee, and there is an assertion for it, because an
  // implementation that emits the band AND leaves the rows in the lanes passes
  // every other check while drawing the board twice.
  const lanes = LANE_ORDER.map((cohort) => {
    const mine = board.lane.filter((s) => s.cohort === cohort)
    return { cohort, ...bandOf(mine, dayKeys) }
  })

  return {
    from,
    to,
    days: dayKeys,
    shared: bandOf(board.shared, dayKeys),
    lanes,
    // The queue behind the board's top band: rolls that were never taken,
    // oldest first. Derived on every read, so it clears itself the moment
    // somebody takes one — the same "no Notification table" reasoning.
    //
    // Built from the MERGED list, so a both-cohorts event is one item that one
    // action clears — taking its roll stamps both sides in the same
    // transaction, so a half-cleared entry is not representable.
    //
    // An empty roster is excluded on purpose: an occurrence nobody is on has no
    // roll to take, and listing it would be a permanent item nobody can clear.
    needsRoll: [...queue.shared, ...queue.lane]
      .filter((s) => s.state === SESSION_STATE.MISSED && s.rosterCount > 0)
      .sort((a, b) => a.startsAt - b.startsAt),
  }
}

function datesOf(from, span) {
  return Array.from({ length: span }, (_, i) => addDays(from, i))
}

const encodeAttendanceCursor = (a) =>
  Buffer.from(`${a.session.sessionDate.toISOString()}|${a.id}`).toString('base64url')

function decodeAttendanceCursor(s) {
  const raw = Buffer.from(s, 'base64url').toString()
  const split = raw.indexOf('|')
  const t = split > 0 ? new Date(raw.slice(0, split)) : null
  const id = split > 0 ? raw.slice(split + 1) : ''
  if (!t || Number.isNaN(t.getTime()) || !id) throw new HttpError(400, 'Invalid cursor')
  return { t, id }
}

/**
 * One resident's ATTENDANCE — the record's Attendance section.
 *
 * Renamed from `residentSchedule` on 2026-08-08, when the facility replaced the
 * record's Schedule tab with Attendance and removed its 14-day diary. That
 * dropped `upcoming`, and with it this function's only use of `expand()`,
 * `materializedByKey()` and the window — what is left is a straight paginated
 * read. "What is this person scheduled for" is answered on /schedule, which
 * owns the events; the record answers what happened.
 *
 * THE SUMMARY COUNTS THE WHOLE STAY, NOT THE PAGE, and that is the whole reason
 * it is computed here rather than in the client. `attendanceSummary()` in the
 * admin app derived its counts from the ten rows it had been sent, which was
 * true while ten rows were all there were. Against a paginated history the same
 * code would describe page one while the heading claims to describe the stay —
 * a figure that quietly shrinks as you scroll.
 */
export async function residentAttendance(residentId, { cursor, limit = 50 } = {}) {
  const stay = await prisma.stay.findFirst({
    where: { residentId, status: STAY_STATUS.ACTIVE },
    select: { id: true },
  })
  // No active stay is not an error — a discharged resident's record still opens.
  if (!stay) return { hasActiveStay: false, stayId: null, summary: null, marks: [], nextCursor: null }

  const c = cursor ? decodeAttendanceCursor(cursor) : null

  // Ordered by the SESSION's date, not by when the mark was typed.
  //
  // `createdAt desc` meant "the most recently recorded marks", which is a
  // different list the moment anybody back-fills a roll — and the section reads
  // this as a chronology. The tiebreak is the id rather than `createdAt` so the
  // keyset below is total: two marks sharing a session date still have a stable
  // order, which is what stops a page boundary repeating or skipping a row.
  const rows = await prisma.scheduleAttendance.findMany({
    where: {
      stayId: stay.id,
      // Prisma's native cursor cannot cross the `session` relation, so this is a
      // hand-built (sessionDate, id) comparison — the same shape residentChecks()
      // and residentMeds() use, for the same reason.
      ...(c && {
        OR: [
          { session: { sessionDate: { lt: c.t } } },
          { session: { sessionDate: c.t }, id: { lt: c.id } },
        ],
      }),
    },
    orderBy: [{ session: { sessionDate: 'desc' } }, { id: 'desc' }],
    // One extra row detects whether a next page exists at all.
    take: limit + 1,
    include: {
      recordedBy: { select: { id: true, fullName: true } },
      session: {
        select: {
          sessionDate: true,
          occurrence: { select: { event: { select: { title: true } } } },
        },
      },
    },
  })

  const page = rows.slice(0, limit)

  return {
    hasActiveStay: true,
    stayId: stay.id,
    // Rides on page one only — Load-more pages skip the aggregate and the client
    // keeps the summary it already has. The checks/meds precedent.
    summary: c ? null : await attendanceTotals(stay.id),
    marks: page.map((a) => ({
      id: a.id,
      date: utcToDateKey(a.session.sessionDate),
      title: a.session.occurrence.event.title,
      status: a.status,
      note: a.note,
      recordedBy: a.recordedBy,
      recordedAt: a.createdAt,
    })),
    nextCursor: rows.length > limit ? encodeAttendanceCursor(page[page.length - 1]) : null,
  }
}

/**
 * Every mark on a stay, counted by status, plus the date the record starts.
 *
 * A grouped query rather than a scan: the counts must describe the stay however
 * many pages the client has loaded. `since` is the OLDEST session date, which is
 * what "since 1 May" in the heading means — deliberately not the oldest row on
 * the current page, which would creep backwards as somebody scrolled.
 */
async function attendanceTotals(stayId) {
  const [grouped, oldest] = await Promise.all([
    prisma.scheduleAttendance.groupBy({
      by: ['status'],
      where: { stayId },
      _count: { _all: true },
    }),
    prisma.scheduleAttendance.findFirst({
      where: { stayId },
      orderBy: [{ session: { sessionDate: 'asc' } }, { id: 'asc' }],
      select: { session: { select: { sessionDate: true } } },
    }),
  ])

  const count = (s) => grouped.find((g) => g.status === s)?._count?._all ?? 0
  const attended = count(ATTENDANCE_STATUS.ATTENDED)
  const absent = count(ATTENDANCE_STATUS.ABSENT)
  const excused = count(ATTENDANCE_STATUS.EXCUSED)
  const total = attended + absent + excused

  // Null rather than a row of zeroes when nothing has been recorded: the section
  // hides the band entirely in that case, because a 0-of-0 bar reads as a
  // failing grade rather than as an absence of information.
  if (!total) return null

  return {
    total,
    attended,
    absent,
    excused,
    since: oldest ? utcToDateKey(oldest.session.sessionDate) : null,
    bars: { attended, excused, absent },
  }
}

/**
 * `?cohort=MEN` or `?cohort=MEN,WOMEN` (or the param repeated) → a canonical
 * ordered list.
 *
 * A MISSING param stays a 400 rather than defaulting to everyone. Defaulting
 * would be the nullable-cohort-means-everyone shape module 3 forbids, smuggled
 * in as a convenience — "everyone" has to be asked for.
 */
export function parseCohorts(raw) {
  const list = [
    ...new Set(
      (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
  if (!list.length || list.some((c) => c !== COHORT.MEN && c !== COHORT.WOMEN)) {
    throw new HttpError(400, 'cohort is required')
  }
  return LANE_ORDER.filter((c) => list.includes(c))
}
