/**
 * Facility wall-clock time — the first consumer of FACILITY_TIMEZONE.
 *
 * Everything is stored as UTC instants. But "expected back at 5:30" means 5:30
 * on the facility's clock, whatever device or server timezone is involved — so
 * wall-clock input is interpreted HERE, server-side, against the one facility
 * timezone. Curfews, med windows and travel passes will reuse this.
 *
 * No timezone library: Intl.DateTimeFormat knows the IANA zone database, and
 * the offset can be derived from it.
 */
const TZ = process.env.FACILITY_TIMEZONE ?? 'America/New_York'

const WALL = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** What the facility clock reads at `instant`, expressed as a fake-UTC ms value. */
function wallClockMs(instant) {
  const p = Object.fromEntries(WALL.formatToParts(instant).map((x) => [x.type, x.value]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/**
 * '2026-08-02' + '17:30' on the facility clock → the UTC instant.
 *
 * Two passes: guess the offset by pretending the wall clock IS UTC, then
 * re-derive at the candidate instant so a DST boundary between the two does
 * not skew it. A spring-forward gap resolves just past the gap; an ambiguous
 * fall-back time resolves to the first occurrence — both fine for an
 * expected-return time.
 */
export function facilityWallClockToUtc(dateStr, timeStr) {
  const asIfUtc = Date.parse(`${dateStr}T${timeStr}:00Z`)
  const guess = asIfUtc - (wallClockMs(new Date(asIfUtc)) - asIfUtc)
  return new Date(asIfUtc - (wallClockMs(new Date(guess)) - guess))
}

/** Today's 'YYYY-MM-DD' on the facility clock — the default sign-out date. */
export function facilityToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

/**
 * The END of the Nth facility day from now — what a payment term means.
 *
 * "Net 3" is a promise about a DAY, not about a moment: an invoice sent at
 * 2:14 PM and one sent at 11:50 PM the same evening are both due at the end of
 * the same Thursday. Returning 23:59 on that day is what makes the date in the
 * ledger, the date on the hosted Stripe page and the instant `overdue` flips
 * all name the same thing.
 *
 * The arithmetic is done on the DATE KEY, never by adding `n * 86_400_000` to
 * an instant — across a DST boundary that lands on the wrong day. Same rule and
 * same reason as `addDays` in services/schedule/expand.js.
 */
export function facilityDueDate(now = new Date(), days = 0) {
  const key = facilityToday(now)
  const d = new Date(`${key}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return facilityWallClockToUtc(d.toISOString().slice(0, 10), '23:59')
}

/**
 * The instant to STORE for a field that is a calendar date wearing a DateTime.
 *
 * Several columns mean a day rather than a moment — `LedgerEntry.occurredAt`,
 * `Stay.intakeAt`, `Stay.expectedDischargeAt` — but are typed DateTime, so a
 * bare 'YYYY-MM-DD' from a form reaches `new Date()` and is read as UTC
 * midnight. That is 8pm the PREVIOUS day in New York, so a date somebody typed
 * was stored, and read back, as the day before.
 *
 * Anchored at facility NOON, which is the load-bearing part: far enough from
 * either midnight that the stored instant falls on the intended day whether it
 * is later read on the facility clock or sliced in UTC. That is what stops this
 * drifting back the next time somebody reaches for the wrong display helper.
 *
 * A real instant (Stripe's `paid_at`, a server clock) passes through untouched
 * — that is a moment, not a calendar date, and it already knows its own day.
 *
 * NOT for a `@db.Date` column (`workedOn`, `sobrietyDate`): Postgres keeps only
 * the date part there, so those are unambiguous already.
 */
export function facilityDayInstant(value) {
  if (!value) return new Date()
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return facilityWallClockToUtc(value.trim(), '12:00')
  }
  return new Date(value)
}

/** UTC instant → 'h:mm AM/PM' on the facility clock. */
export function formatFacilityTime(instant) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant))
}

/**
 * UTC instant → its facility hour bucket, as '2026-08-06 14'.
 *
 * A bucket is the wall-clock LABEL of a real instant, nothing more. On the
 * fall-back day two real hours share the '01' label; on the spring-forward day
 * no instant ever formats to '02'. Both are correct: buckets are presentation
 * (the checks log, the DUE state), and anything with an alarm on it measures
 * elapsed milliseconds between instants instead — see services/checks.js.
 */
export function facilityHourKey(instant) {
  const p = Object.fromEntries(WALL.formatToParts(new Date(instant)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}`
}

/** The UTC instant of facility midnight today — bounds "today's checks". */
export function facilityStartOfToday(now = new Date()) {
  return facilityWallClockToUtc(facilityToday(now), '00:00')
}
