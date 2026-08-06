/**
 * Folding per-occurrence rows back into per-event sessions.
 *
 * The cohort split is a STORAGE concept, not a modelling one. Exactly one layer
 * knows about it in each direction: `createEvent` fans one flat payload out to
 * one occurrence per cohort, and this module folds them back. Nothing above
 * either sees two rows for one meeting.
 *
 * PURE — no database, no clock beyond what is passed in. It is a grouping, not a
 * date computation, which is why it is not inside `expand.js`: the resident
 * record needs the un-merged rows and would break.
 *
 * Sharedness is a per-DATE property, not a per-event one. `expand` only emits a
 * row for a date an occurrence actually runs, so a both-cohorts event whose
 * women's side ends earlier correctly becomes a men-only lane card on later
 * dates. That one choice is what makes this survive series editing.
 */
import { SESSION_STATE } from '../../domain/constants.js'

/** Both lanes, always, in this order. */
export const LANE_ORDER = ['MEN', 'WOMEN']

/**
 * A group can never exceed two rows: `one_live_occurrence_per_event_cohort` is
 * unique on (eventId, cohort) among live rows, so an event holds at most one
 * occurrence per cohort.
 */
function groupKey(row) {
  return `${row.eventId}|${row.date}`
}

/**
 * Do these rows describe the same meeting?
 *
 * Identical timing across an event's occurrences is enforced by `createEvent`
 * and by NOTHING IN THE DATABASE. Divergence is reachable from rows written
 * before the one-time-per-event rule, and from any future per-occurrence
 * reschedule. A merged card would have to pick one of two times and would
 * therefore lie about when the meeting starts, so when they disagree we refuse
 * to merge and fall back to drawing them in their own lanes — uglier, but true.
 */
function sameMeeting(rows) {
  const [first] = rows
  return rows.every(
    (r) =>
      r.startsAt.getTime() === first.startsAt.getTime() &&
      r.durationMinutes === first.durationMinutes,
  )
}

/**
 * Derived state for a session spanning more than one occurrence.
 *
 * TAKEN requires unanimity; MISSED needs only one gap. The failure directions
 * decide it. Under unanimity the worst case is a roll sitting in the queue that
 * somebody already half-took — a nuisance, and one tap fixes it. Under the
 * alternative, half the house has no attendance record for a meeting while
 * every screen in the app says the roll is done, which is exactly the evidence
 * loss this module exists to prevent and which an auditor cannot recover from.
 *
 * CANCELLED is unanimous for the mirror reason: if one side is cancelled and
 * the other is not, the meeting is happening for somebody and a roll is owed.
 */
function mergedState(rows) {
  if (rows.every((r) => r.state === SESSION_STATE.CANCELLED)) return SESSION_STATE.CANCELLED

  const live = rows.filter((r) => r.state !== SESSION_STATE.CANCELLED)
  if (live.every((r) => r.state === SESSION_STATE.TAKEN)) return SESSION_STATE.TAKEN
  if (live.some((r) => r.state === SESSION_STATE.MISSED)) return SESSION_STATE.MISSED
  return SESSION_STATE.SCHEDULED
}

/** The moment the record became complete — the LATEST stamp, not the first. */
function latestStamp(rows) {
  const stamped = rows.filter((r) => r.attendanceTakenAt)
  if (!stamped.length || stamped.length !== rows.length) return { at: null, by: null }
  const last = stamped.reduce((a, b) => (a.attendanceTakenAt > b.attendanceTakenAt ? a : b))
  return { at: last.attendanceTakenAt, by: last.attendanceTakenBy ?? null }
}

/**
 * Split expanded, count-decorated rows into a shared band and per-cohort lanes.
 *
 * A row that stands alone keeps `cohort` and `occurrenceId`. A merged row drops
 * both and carries `cohorts` and `occurrenceIds` instead — `cohort` is ABSENT
 * rather than null or 'BOTH', because a null cohort meaning "everyone" is what
 * module 3 forbids in storage, and putting one on the wire invites a client to
 * reintroduce it. `cohorts` is present on every row so client code stays
 * uniform.
 */
export function mergeSharedSessions(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = groupKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const shared = []
  const lane = []

  for (const group of groups.values()) {
    if (group.length === 1 || !sameMeeting(group)) {
      for (const row of group) lane.push({ ...row, cohorts: [row.cohort] })
      continue
    }

    const ordered = LANE_ORDER.map((c) => group.find((r) => r.cohort === c)).filter(Boolean)
    const [first] = ordered
    const stamp = latestStamp(ordered)

    shared.push({
      ...first,
      cohort: undefined,
      occurrenceId: undefined,
      cohorts: ordered.map((r) => r.cohort),
      occurrenceIds: ordered.map((r) => r.occurrenceId),
      state: mergedState(ordered),
      // Summed, and they cannot double-count: a stay has exactly one cohort and
      // the composite foreign keys mean it can only sit on that cohort's
      // occurrence, so the two rosters are disjoint by database construction.
      rosterCount: ordered.reduce((n, r) => n + (r.rosterCount ?? 0), 0),
      markedCount: ordered.reduce((n, r) => n + (r.markedCount ?? 0), 0),
      attendanceTakenAt: stamp.at,
      attendanceTakenBy: stamp.by,
      cancelReason: ordered.find((r) => r.cancelReason)?.cancelReason ?? null,
    })
  }

  const byTime = (a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title)
  return { shared: shared.sort(byTime), lane: lane.sort(byTime) }
}

/** `{ days: [{ date, sessions }], total }` — the shape a lane already has. */
export function bandOf(sessions, days) {
  return {
    days: days.map((date) => ({ date, sessions: sessions.filter((s) => s.date === date) })),
    total: sessions.length,
  }
}
