/**
 * Facility wall-clock display. COPIED constants, not imported across folders —
 * the values mirror server/src/lib/facilityTime.js and services/signOuts.js,
 * per the convention in CLAUDE.md.
 *
 * The client re-derives presence (OUT vs OVERDUE) against a ticking clock
 * because the crossing mutates nothing server-side — no write, no socket
 * event. The server's derivation stays the API truth; this is the same rule
 * applied to a moving `now`.
 */
export const FACILITY_TIMEZONE = 'America/New_York'

/** Mirrors OVERDUE_GRACE_MS in server/src/services/signOuts.js. */
export const OVERDUE_GRACE_MS = 15 * 60_000

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: FACILITY_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
})

/** UTC instant → 'h:mm AM/PM' on the facility clock. */
export function formatFacilityTime(iso) {
  return TIME.format(new Date(iso))
}

const HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: FACILITY_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** The facility clock right now, as 'HH:MM' — the default for a time input. */
export function facilityTimeNow(now = new Date()) {
  return HHMM.format(now)
}

/**
 * 'HH:MM' → 'h:mm AM/PM'. A wall-clock string is ALREADY facility time.
 *
 * Deliberately a pure string transform with no Date and no timezone anywhere:
 * `startsAtLocal` is a wall clock the server stores as a string precisely so it
 * survives DST, and running it through `new Date()` to format it would
 * re-interpret it as an instant — the exact bug class services/schedule/expand.js
 * warns about. So this is not `formatFacilityTime`, which takes a UTC instant,
 * and the two are not interchangeable.
 *
 * Exists so a stored wall clock reads the same as every other time in the app:
 * "6:00 PM", never "18:00".
 */
export function formatWallClock(hhmm) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm ?? '')) return hhmm ?? ''
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/** The facility calendar date of an instant, 'YYYY-MM-DD'. */
export function facilityDateOf(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FACILITY_TIMEZONE }).format(new Date(iso))
}

/** Today on the facility calendar, 'YYYY-MM-DD'. */
export function facilityDateNow(now = new Date()) {
  return facilityDateOf(now)
}

/**
 * Calendar arithmetic on 'YYYY-MM-DD' strings, done on the UTC calendar.
 *
 * Never advance a date by adding 86_400_000 to a local Date: across a DST
 * boundary that lands on the wrong day. The server's expander follows the same
 * rule, and the two have to agree about which dates exist.
 */
export function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * A JS Date → 'YYYY-MM-DD' read from its LOCAL fields, with no timezone
 * conversion at all.
 *
 * NOT `facilityDateOf()`, and the difference is the whole point. That one
 * re-interprets an instant in America/New_York, which is right for a UTC
 * instant off the wire and WRONG here: FullCalendar hands its callbacks Dates
 * built from the naive wall-clock strings we fed it, so their local fields
 * already ARE facility time. Passing one through `facilityDateOf` would convert
 * it a second time and shift the date by a day for any browser west of Eastern.
 *
 * Only for Dates that came out of FullCalendar. Anything from the API keeps
 * using `facilityDateOf`.
 */
export function localDateKeyOf(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A Date whose LOCAL clock reads the facility's current wall clock. */
export function facilityNowAsLocal(now = new Date()) {
  return new Date(`${facilityDateNow(now)}T${facilityTimeNow(now)}:00`)
}

/** 0=Sunday..6=Saturday for a date key, with no timezone in play. */
export function weekdayOf(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

/**
 * 'YYYY-MM-DD' → "Monday, August 3", or "Today" / "Tomorrow" / "Yesterday".
 *
 * Formatted in UTC deliberately: the key is already a facility calendar date,
 * so re-interpreting it in a timezone is what would shift it a day.
 */
export function humanDate(dateKey, { short = false, relative = true } = {}) {
  if (relative) {
    const today = facilityDateNow()
    if (dateKey === today) return 'Today'
    if (dateKey === addDays(today, 1)) return 'Tomorrow'
    if (dateKey === addDays(today, -1)) return 'Yesterday'
  }
  const d = new Date(`${dateKey}T00:00:00.000Z`)
  return (short ? SHORT_DATE : LONG_DATE).format(d)
}

/** "4 days ago" / "in 2 days" for a date key, against the facility calendar. */
export function daysAgoLabel(dateKey, today = facilityDateNow()) {
  const ms = new Date(`${dateKey}T00:00:00.000Z`) - new Date(`${today}T00:00:00.000Z`)
  const days = Math.round(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  if (days === 1) return 'tomorrow'
  return days < 0 ? `${-days} days ago` : `in ${days} days`
}

/** How late, measured from the expected return itself: '2h 41m' or '41m'. */
export function overdueLabel(expectedReturnAt, nowMs = Date.now()) {
  const late = Math.max(0, nowMs - new Date(expectedReturnAt).getTime())
  const h = Math.floor(late / 3_600_000)
  const m = Math.floor((late % 3_600_000) / 60_000)
  return h ? `${h}h ${m}m` : `${m}m`
}

/** Presence against a moving clock. Grace delays the alarm, not the label. */
export function presenceState(presence, nowMs = Date.now()) {
  if (!presence || !presence.expectedReturnAt) return 'IN'
  return nowMs - new Date(presence.expectedReturnAt).getTime() > OVERDUE_GRACE_MS
    ? 'OVERDUE'
    : 'OUT'
}
