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

/** UTC instant → 'h:mm AM/PM' on the facility clock. */
export function formatFacilityTime(instant) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant))
}
