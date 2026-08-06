/**
 * Schedule vocabulary. COPIED constants, not imported across folders — these
 * mirror server/src/domain/constants.js and the enums in schema.prisma, per the
 * convention in CLAUDE.md.
 */

/** Matches the `Recurrence` enum. */
export const RECURRENCE = Object.freeze({ ONCE: 'ONCE', WEEKLY: 'WEEKLY' })

/** Matches the `AttendanceStatus` enum. Absent and excused stay distinct. */
export const ATTENDANCE_STATUS = Object.freeze({
  ATTENDED: 'ATTENDED',
  ABSENT: 'ABSENT',
  EXCUSED: 'EXCUSED',
})

/** Derived on the server from timestamps — never stored. Mirrors SESSION_STATE. */
export const SESSION_STATE = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  CANCELLED: 'CANCELLED',
  TAKEN: 'TAKEN',
  MISSED: 'MISSED',
})

/** 0=Sunday..6=Saturday, matching the server's weekday numbering exactly. */
export const WEEKDAYS = Object.freeze([
  { value: 0, label: 'Sun', full: 'Sunday' },
  { value: 1, label: 'Mon', full: 'Monday' },
  { value: 2, label: 'Tue', full: 'Tuesday' },
  { value: 3, label: 'Wed', full: 'Wednesday' },
  { value: 4, label: 'Thu', full: 'Thursday' },
  { value: 5, label: 'Fri', full: 'Friday' },
  { value: 6, label: 'Sat', full: 'Saturday' },
])

export const COHORT_LABEL = Object.freeze({ MEN: 'Men', WOMEN: 'Women' })

/**
 * How a session's cohorts read: "Men", "Women", or "Both".
 *
 * A word, never a hue — colour on this board is reserved for session state, and
 * two systems competing for it is how a board stops being readable at a glance.
 */
export function cohortsLabel(cohorts) {
  if (cohorts?.length === 2) return 'Both'
  return COHORT_LABEL[cohorts?.[0]] ?? ''
}

export const ATTENDANCE_LABEL = Object.freeze({
  ATTENDED: 'Attended',
  ABSENT: 'Absent',
  EXCUSED: 'Excused',
})

/** Short form for the segmented control, where three words will not fit. */
export const ATTENDANCE_SHORT = Object.freeze({
  ATTENDED: 'Here',
  ABSENT: 'Absent',
  EXCUSED: 'Excused',
})

/**
 * How a recurrence reads in a sentence: "Every Tue", "Mon, Wed, Fri", "Daily".
 * Daily is worth its own case — seven chips saying the same thing is noise.
 */
export function recurrenceLabel({ recurrence, weekdays }) {
  if (recurrence === RECURRENCE.ONCE) return 'One-off'
  if (!weekdays?.length) return 'Weekly'
  if (weekdays.length === 7) return 'Daily'
  const names = WEEKDAYS.filter((d) => weekdays.includes(d.value)).map((d) => d.label)
  return names.length === 1 ? `Every ${names[0]}` : names.join(', ')
}

/**
 * 'HH:MM' + minutes → 'HH:MM', clamped at 23:59.
 *
 * Wall-clock arithmetic, deliberately not `new Date(start + ms)`. Adding
 * milliseconds to a naive local Date is wrong across the BROWSER's own DST
 * boundary — the same class of bug services/schedule/expand.js warns about
 * server-side, and worth being consistent about even where the risk is small.
 */
export function addMinutesToWallClock(startsAtLocal, minutes) {
  const [h, m] = startsAtLocal.split(':').map(Number)
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 60))}:${p(total % 60)}`
}

/**
 * A stable id for one session on one date, for a calendar.
 *
 * The cohort segment is load-bearing, not decoration. When band.js REFUSES to
 * merge a divergent pair, one event on one date produces two lane rows — and
 * FullCalendar treats same-id events as one group, so dragging one would drag
 * both. That is exactly the lie the refuse-to-merge fallback exists to prevent,
 * reintroduced by the calendar.
 */
export function sessionEventId(session) {
  return `${session.eventId}|${session.date}|${(session.cohorts ?? []).join('+')}`
}

/**
 * How one session's state reads — THE only state→appearance mapping.
 *
 * There were three of these: stateTone() here (dead), stateChip()/chipClass()
 * inlined in pages/schedule/index.vue, and stateClass() in
 * AppScheduleCalendar.vue. Three copies of one rule is how the queue band and
 * the tiles come to disagree about what "taken" looks like.
 *
 * `marker` is what goes INSIDE a calendar tile, and it carries the weight now
 * that tiles are solid: the board draws every session in primary (the pulse
 * look, chosen 2026-08-05), so state can no longer be the tile's colour. See
 * CLAUDE.md module 3 — the roll queue above the board is the compensating
 * surface, and it is why that band is not optional.
 *
 * `className` is empty for everything except CANCELLED, which is the one state
 * that keeps a treatment rather than a word: an auditor reads a cancelled
 * session as "the meeting did not happen", which is a different claim from
 * "it happened, here is the roll".
 *
 * @param {{state: string, markedCount?: number, rosterCount?: number}} session
 * @returns {{tone: string|null, label: string|null, marker: string|null, className: string}}
 */
export function sessionStateDisplay(session) {
  const marked = session?.markedCount ?? 0
  const roster = session?.rosterCount ?? 0

  if (session?.state === SESSION_STATE.CANCELLED) {
    return { tone: 'muted', label: 'Cancelled', marker: 'Cancelled', className: 'sl-cancelled' }
  }
  if (session?.state === SESSION_STATE.TAKEN) {
    const count = `${marked}/${roster}`
    return { tone: 'success', label: `Roll taken · ${count}`, marker: `✓ ${count}`, className: '' }
  }
  if (session?.state === SESSION_STATE.MISSED) {
    return { tone: 'warning', label: 'Roll due', marker: '! Roll due', className: '' }
  }
  // SCHEDULED says nothing. Nothing is wrong, so nothing is announced — the same
  // rule the census tiles and the resident rail's dots follow.
  return { tone: null, label: null, marker: null, className: '' }
}

/**
 * How ONE PERSON's attendance at one session reads.
 *
 * Beside sessionStateDisplay() rather than folded into it, because they are
 * different vocabularies about different subjects: a session is scheduled,
 * cancelled, taken or missed; a person attended, was absent, or was excused. The
 * only thing they share is the tone scale, which is why they share `toneClass`.
 *
 * Absent and excused stay distinct all the way to the chip — "he did not come"
 * and "he was allowed not to come" are different facts, and collapsing them
 * destroys the one that defends the facility.
 */
export function attendanceDisplay(status) {
  if (status === ATTENDANCE_STATUS.ATTENDED) {
    return { tone: 'success', label: ATTENDANCE_LABEL.ATTENDED }
  }
  if (status === ATTENDANCE_STATUS.ABSENT) {
    return { tone: 'destructive', label: ATTENDANCE_LABEL.ABSENT }
  }
  if (status === ATTENDANCE_STATUS.EXCUSED) {
    return { tone: 'warning', label: ATTENDANCE_LABEL.EXCUSED }
  }
  return { tone: null, label: '—' }
}

/**
 * Chip classes for a tone from sessionStateDisplay() or attendanceDisplay().
 *
 * `destructive` exists for ABSENT only. No session STATE uses it — on the board
 * red would compete with `--warning` meaning "roll due" — but an absence is a
 * fact about a person, on a screen where nothing else is claiming the colour.
 */
export function toneClass(tone) {
  if (tone === 'success') return 'bg-success/15 text-success'
  if (tone === 'warning') return 'bg-warning/15 text-warning'
  if (tone === 'destructive') return 'bg-destructive/15 text-destructive'
  if (tone === 'muted') return 'bg-muted text-muted-foreground'
  return 'text-muted-foreground'
}

/**
 * A stay's attendance record, summarised.
 *
 * Counts, never a percentage: `recent` is capped at ten and a new resident has
 * one or two marks, so "1 of 2" carries its own sample size where "50%" would
 * imply a measurement. The same reason every other figure in this app reads
 * "N of M" — verified hours of required, marked of roster, selected of total.
 *
 * @returns {null|{total, attended, absent, excused, since, bars}} null when
 *   nothing has been recorded — a 0-of-0 bar reads as a failing grade.
 */
export function attendanceSummary(recent) {
  const rows = recent ?? []
  if (!rows.length) return null

  const count = (s) => rows.filter((r) => r.status === s).length
  const attended = count(ATTENDANCE_STATUS.ATTENDED)
  const absent = count(ATTENDANCE_STATUS.ABSENT)
  const excused = count(ATTENDANCE_STATUS.EXCUSED)

  return {
    total: rows.length,
    attended,
    absent,
    excused,
    // Ordered newest-first by the server, so the oldest is last.
    since: rows[rows.length - 1]?.date ?? null,
    // Flex weights for the h-2 track. Zero-weight segments are dropped by the
    // template rather than rendered at flex:0, which would still show a gap.
    bars: { attended, excused, absent },
  }
}
