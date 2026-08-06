/**
 * Turning recurrence rules into dated sessions. PURE — no database, no clock
 * beyond what is passed in.
 *
 * This module exists exactly once on purpose. The schedule page and the
 * resident record both answer "does this occurrence happen on Tuesday", and two
 * implementations is how the two screens come to disagree about whether Tuesday
 * exists. Everything date-shaped in the module funnels through here.
 *
 * TWO RULES, both of which have bitten this codebase's neighbours:
 *
 * 1. Dates are 'YYYY-MM-DD' STRINGS everywhere in here. Postgres `@db.Date`
 *    round-trips as a JS Date at UTC midnight, and reading one as a local date
 *    in America/New_York moves it to the previous day. Comparing strings has no
 *    such failure mode.
 *
 * 2. Never advance a date by adding 86_400_000 milliseconds. Across a DST
 *    boundary that shifts every subsequent session by an hour. Dates are
 *    advanced on the UTC calendar, and the wall-clock time is applied to each
 *    date separately by facilityWallClockToUtc() — which is what makes a weekly
 *    6pm still 6pm in November.
 */
import { RECURRENCE, SESSION_STATE } from '../../domain/constants.js'
import { facilityWallClockToUtc } from '../../lib/facilityTime.js'

/** 'YYYY-MM-DD' → the UTC-midnight instant that represents that calendar day. */
export function dateKeyToUtc(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

/** A UTC-midnight instant (or a @db.Date from Prisma) → 'YYYY-MM-DD'. */
export function utcToDateKey(d) {
  return new Date(d).toISOString().slice(0, 10)
}

/** 0=Sunday..6=Saturday for a calendar date, with no timezone in play. */
export function weekdayOf(dateKey) {
  return dateKeyToUtc(dateKey).getUTCDay()
}

/** The calendar date `n` days after `dateKey`. UTC arithmetic, never local. */
export function addDays(dateKey, n) {
  const d = dateKeyToUtc(dateKey)
  d.setUTCDate(d.getUTCDate() + n)
  return utcToDateKey(d)
}

/** Inclusive list of date keys from `from` to `to`. */
export function datesBetween(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * Does this occurrence happen on this calendar date?
 *
 * The single source of truth for that question. `materializeSession` calls it
 * before creating a row, which is what stops a caller conjuring a phantom
 * Sunday session for a Tuesday group by posting a date of their choosing.
 */
export function occursOn(occurrence, dateKey) {
  const startsOn = utcToDateKey(occurrence.startsOn)
  if (dateKey < startsOn) return false

  const endsOn = occurrence.endsOn ? utcToDateKey(occurrence.endsOn) : null
  if (endsOn && dateKey > endsOn) return false

  if (occurrence.recurrence === RECURRENCE.ONCE) return dateKey === startsOn
  return (occurrence.weekdays ?? []).includes(weekdayOf(dateKey))
}

/**
 * Derived session state. Never stored — same rule as PRESENCE.
 *
 * MISSED is the one that earns the enum: past, not cancelled, and nobody took
 * the roll. It is the only state that represents work owed, and it is what the
 * page's queue is built from.
 */
export function sessionStateOf({ session, endsAt, now }) {
  if (session?.cancelledAt) return SESSION_STATE.CANCELLED
  if (session?.attendanceTakenAt) return SESSION_STATE.TAKEN
  return endsAt < now ? SESSION_STATE.MISSED : SESSION_STATE.SCHEDULED
}

/**
 * Expand occurrences into dated sessions across an inclusive window.
 *
 * `sessionsByKey` carries the rows that HAVE been materialized, keyed
 * `occurrenceId|date`. Everything else is computed and has no id — which is why
 * the address of a session on the wire is (occurrenceId, date) and never an id.
 *
 * Times are resolved per date, so a per-date override and a DST boundary are
 * both handled by construction rather than by arithmetic.
 */
export function expand({ occurrences, from, to, sessionsByKey = new Map(), now = new Date() }) {
  const out = []

  for (const occurrence of occurrences) {
    for (const date of datesBetween(from, to)) {
      if (!occursOn(occurrence, date)) continue

      const session = sessionsByKey.get(`${occurrence.id}|${date}`) ?? null
      const startsAtLocal = session?.startsAtLocalOverride ?? occurrence.startsAtLocal
      const startsAt = facilityWallClockToUtc(date, startsAtLocal)
      const endsAt = new Date(startsAt.getTime() + occurrence.durationMinutes * 60_000)

      out.push({
        // The SCALAR column, not occurrence.event.id. The relation depends on
        // every caller remembering to include it; a caller that forgets yields
        // `undefined` here and silently breaks roll addressing at the one place
        // nothing would catch it.
        eventId: occurrence.eventId,
        occurrenceId: occurrence.id,
        date,
        cohort: occurrence.cohort,
        title: occurrence.event.title,
        location: occurrence.event.location,
        startsAt,
        endsAt,
        startsAtLocal,
        durationMinutes: occurrence.durationMinutes,
        recurrence: occurrence.recurrence,
        state: sessionStateOf({ session, endsAt, now }),
        // Present only once something date-specific has been recorded. A null
        // here means "no row yet", not "nothing happened".
        cancelReason: session?.cancelReason ?? null,
        attendanceTakenAt: session?.attendanceTakenAt ?? null,
        attendanceTakenBy: session?.attendanceTakenBy ?? null,
        rescheduled: Boolean(session?.startsAtLocalOverride),
      })
    }
  }

  // Chronological, then by title so a tie is stable rather than arbitrary.
  // Sorting happens here rather than in SQL because generated sessions have no
  // rows to ORDER BY — the price of computing them, and cheap while the window
  // is bounded by SCHEDULE_MAX_DAYS.
  return out.sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title))
}
