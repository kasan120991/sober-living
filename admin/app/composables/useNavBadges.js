/**
 * The sidebar's count badges.
 *
 * ONE map, bell-kind → nav destination, so the rail and the bell cannot
 * disagree about what needs attention.
 *
 * THIS MAKES NO REQUEST. It reads the same `useState` the bell already fills —
 * once per navigation, on every panel open, and on every realtime `changed`
 * (plugins/realtime.client.js calls refreshBell, debounced 200ms). A number in
 * the nav is not worth a second read of something already on the client, and
 * because the socket already drives that read the badges update live for free.
 *
 * That is a real coupling and worth stating: if the bell ever stops being
 * fetched on every page, these go stale silently. `AppNotifications` is
 * rendered by `AppPageHeader` on every screen, which is what makes it safe.
 */

/**
 * Red means a clock has run out; amber means it has not.
 *
 * THE SERVER decides which — `NOTIFICATION_SEVERITY` in
 * services/notifications.js — because for `URGENT_MAINTENANCE` the client has
 * neither the priority nor the target and would have to parse a sentence. These
 * are the same two words `facilityStatus()` and `SECTION_DOT` already use; a
 * third vocabulary for one judgement is how two surfaces come to disagree.
 */
export const NAV_TONE = Object.freeze({ CRITICAL: 'critical', WARNING: 'warning' })

/**
 * Bell kind → the nav entry its count belongs under. Two kinds share /checks,
 * which is the point of a map rather than a field on the nav item.
 *
 * KEYED BY `kind`, NEVER BY THE ITEM'S OWN `to`. An UNHOUSED item links to
 * `/residents/${id}` — the person, because placing them is what you do next —
 * so bucketing by `to` would scatter one badge into a bucket per resident, on
 * routes no nav entry has, and leave /residents bare. The kind is the stable
 * fact; where a single item happens to send you is not.
 *
 * MED_PASS_DUE IS DELIBERATELY ABSENT, recorded so it is not "fixed" later: it
 * is one aggregate item carrying its count inside its title, so a badge built
 * from it would read "1" beside a bell row saying "3 doses not yet recorded" —
 * two numbers for one fact, on the same screen. Badging Med Pass means giving
 * that item a real count field first, which is a module 6 decision. It is not a
 * privacy question: module 13 cleared the shape on 2026-08-07 — a count and a
 * time, never a name and never a medication.
 */
const BADGED = Object.freeze({
  APARTMENT_CHECK_OVERDUE: '/checks',
  RESIDENT_NOT_ACCOUNTED: '/checks',
  OVERDUE_SIGN_OUT: '/sign-outs',
  PASS_OVERDUE: '/passes',
  URGENT_MAINTENANCE: '/maintenance',
  UNHOUSED: '/residents',
})

export function useNavBadges() {
  // `situations`, not `events`. The bell renders the events; these badges are
  // the derived situations' remaining consumer in the UI, which is exactly why
  // GET /notifications still returns both halves in one response.
  const { situations } = useNotifications()

  /**
   * `{ [navPath]: { count, tone } }` — a destination with nothing wrong is
   * ABSENT, never a zero. The rule the census tiles and the resident rail
   * already follow: a quiet house has to look quiet, or the colours stop
   * meaning anything on the day one of them matters.
   */
  const badges = computed(() => {
    const out = {}
    for (const item of situations.value) {
      // WATCH items are excluded, exactly as they are from the bell's own
      // count: a bed out of service is worth seeing and is not a number
      // anyone should feel behind on (CLAUDE.md module 12).
      if (item.level !== 'action') continue
      const to = BADGED[item.kind]
      if (!to) continue
      const entry = (out[to] ??= { count: 0, tone: NAV_TONE.WARNING })
      entry.count += 1
      // RED WINS the moment one thing in the bucket is late — the same rule the
      // maintenance detail line follows ("overdue wins when a request is
      // both"). Amber over a bucket holding a resident nobody can find would be
      // a lie told in colour, and the count beside it would not correct it.
      if (item.severity === NAV_TONE.CRITICAL) entry.tone = NAV_TONE.CRITICAL
    }
    return out
  })

  /**
   * The accessible name for a nav link, badge or no badge.
   *
   * The badge itself is aria-hidden — it is `pointer-events-none` and sits
   * OUTSIDE the anchor, so a screen reader would otherwise announce a stray
   * number after the label. Phrased like the bell's own aria-label so the two
   * surfaces read the same, and reused for the collapsed tooltip, which is the
   * only place the count survives the icon rail.
   */
  const labelFor = (label, badge) => (badge ? `${label} — ${badge.count} needing attention` : label)

  return { badges, labelFor }
}
