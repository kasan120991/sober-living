/**
 * Community service hours — the display half, alongside utils/money.js.
 *
 * Minutes cross the wire; hours are what a human reads. The conversion happens
 * here and at the route boundary on the server, and nowhere in between — the
 * same discipline as integer cents.
 */

/** Mirrors MONTHLY_SERVICE_QUOTA_HOURS in server/src/domain/constants.js. */
export const MONTHLY_SERVICE_QUOTA_HOURS = 20

/** 210 → "3.5 h". Trailing ".0" is dropped: "6 h" reads better than "6.0 h". */
export function hours(minutes) {
  if (minutes == null) return '—'
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`
}

/** 210 → "3 h 30 m", for a single entry where the exact figure matters. */
export function hoursLong(minutes) {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} m`
  return m ? `${h} h ${m} m` : `${h} h`
}

/**
 * Flex weights for the progress bar, and the pace marker's position.
 *
 * Returned as weights rather than percentages because the bar is a flex row —
 * the same technique AppCohortCapacity uses, so the two bars stay one system.
 *
 * `pacePercent` is null when there is nothing to mark: no target, or the
 * expectation has already reached the target (a resident who is simply done).
 */
export function progressOf(service) {
  const required = service?.requiredMinutes
  if (!required) return null

  const verified = Math.min(service.verifiedMinutes, required)
  // Pending is clamped to what is left, so an over-logged month cannot push the
  // bar past its own track.
  const pending = Math.min(service.pendingMinutes, Math.max(0, required - verified))
  const remaining = Math.max(0, required - verified - pending)

  const pacePercent =
    service.expectedMinutes > 0 && service.expectedMinutes < required
      ? (service.expectedMinutes / required) * 100
      : null

  return { verified, pending, remaining, required, pacePercent }
}

/**
 * The sentence under the bar. This is variant B's contribution to variant A:
 * a marker is legible but has to be learned once, and one line of prose means
 * it never has to be.
 */
export function paceSentence(service) {
  if (!service?.requiredMinutes) return 'No target set for this stay.'

  const months = service.monthsElapsed
  const elapsed = months === 0
    ? 'Less than a month into this stay, so nothing is due yet.'
    : `${months} whole ${months === 1 ? 'month' : 'months'} into this stay, so ${hours(service.expectedMinutes)} ${months === 1 ? 'was' : 'were'} due by now.`

  if (!service.behind) return `${elapsed} On track.`
  return `${elapsed} ${hours(service.behindMinutes)} short.`
}
