/**
 * The resident record's sections — one list, read by both the rail and the page.
 *
 * The record page is a status rail (CLAUDE.md module 1). A tab per module stops
 * working somewhere around six, and twelve of them turns the strip into a
 * horizontal scroll on the phone the techs carry — so whatever is off-screen may
 * as well not exist, for the role that most needs speed.
 *
 * Sections whose module is unbuilt are still listed and still reachable, and
 * render `AppStub`. That is deliberate: the rail is a statement of what a
 * resident record holds, and an omitted entry reads as "not a thing here"
 * rather than "not yet".
 *
 * The groups are load-bearing, not cosmetic. A policy that applies to a class of
 * module — withholding Clinical from a role, say — is one rule against one
 * group, instead of a decision re-made every time a module is added.
 */

export const RESIDENT_GROUPS = Object.freeze(['Record', 'Clinical', 'Administrative'])

export const RESIDENT_SECTIONS = Object.freeze([
  // ── Record ────────────────────────────────────────────────────────────────
  {
    key: 'overview',
    label: 'Overview',
    group: 'Record',
    built: true,
  },
  {
    key: 'schedule',
    label: 'Schedule',
    group: 'Record',
    built: true,
  },
  {
    key: 'signOuts',
    label: 'Sign-outs',
    group: 'Record',
    built: true,
  },
  {
    key: 'passes',
    label: 'Travel passes',
    group: 'Record',
    built: false,
    module: 'Module 9 — Travel passes',
    summary:
      'Multi-day approved absences, request → review → approve or deny with a reason. The ' +
      'bed is held rather than freed, and the census will show "on pass" instead of empty.',
  },
  { key: 'checks', label: 'Apartment checks', group: 'Record', built: true },

  // ── Clinical ──────────────────────────────────────────────────────────────
  // Techs see this group (decided 2026-08-02). That is not an exception to the
  // bell rule in CLAUDE.md module 13 — that rule governs *ambient* disclosure, a
  // name against a screen result appearing unbidden on a phone with residents
  // nearby. Opening a named resident's record is a deliberate navigation by
  // someone who already knows who they are looking at, and it is audited.
  { key: 'screens', label: 'Drug screens', group: 'Clinical', built: true },
  {
    key: 'meds',
    label: 'Medications',
    group: 'Clinical',
    built: false,
    module: 'Module 6 — Medication administration',
    summary:
      'The resident\'s med list and the log of given / refused / missed / held with the ' +
      'observing staff member. The facility\'s actual model — observed self-administration ' +
      'or staff-dispensed — is open question 3 and decides how heavy this gets.',
  },

  // ── Administrative ────────────────────────────────────────────────────────
  {
    key: 'service',
    label: 'Community service',
    group: 'Administrative',
    built: true,
  },
  {
    key: 'ledger',
    label: 'Ledger',
    group: 'Administrative',
    built: true,
  },
  {
    key: 'contacts',
    label: 'Contacts',
    group: 'Administrative',
    built: true,
  },
  {
    key: 'stays',
    label: 'Stay history',
    group: 'Administrative',
    built: true,
  },
  {
    key: 'documents',
    label: 'Documents',
    group: 'Administrative',
    built: false,
    module: 'Deferred — see module 1',
    summary:
      'Scanned IDs, agreements and the intake photo. Deferred deliberately: it needs object ' +
      'storage, encryption at rest, and every read brokered through the API so it is ' +
      'authorised and audited. That is its own slice, not a file input.',
  },
])

export const sectionsInGroup = (group) => RESIDENT_SECTIONS.filter((s) => s.group === group)

export const sectionByKey = (key) => RESIDENT_SECTIONS.find((s) => s.key === key) ?? null

/**
 * The dot rules (CLAUDE.md module 1): amber is behind on service hours;
 * **red is the record's loudest fact** — redefined 2026-08-06, when it had
 * been reserved for balance-overdue since 2026-08-02.
 *
 * - **Amber is live** since module 7 (2026-08-05). The threshold is a monthly
 *   quota of 20 hours, accruing in whole months and capped at the target, and
 *   it is computed ON THE SERVER — `servicePace()` in
 *   services/communityService.js — so this file only reads a boolean. The
 *   resident portal will need the identical number, and two implementations is
 *   how two screens come to disagree about who is behind.
 * - **Red is live, meaning unaccounted-for**: the last apartment check could
 *   not find them and nothing has accounted for them since. Computed ON THE
 *   SERVER by the same helper the bell's RESIDENT_NOT_ACCOUNTED item uses —
 *   `residentCheckStatus()` in services/checks.js — so the record and the
 *   bell cannot disagree; this file only reads for a non-null flag.
 *   Balance-overdue joins red when invoicing (module 11) gives a charge a due
 *   date; until then a red dot for money would light on nearly everyone and
 *   teach people to ignore the colour.
 *
 * No ticking clock. `behind` crosses once a month; `notAccounted` changes only
 * on data events (a check, a sign-out, a discharge), each of which emits a
 * realtime invalidation. Do not add a timer here by analogy with the census.
 */
export const SECTION_DOT = Object.freeze({ WARNING: 'warning', CRITICAL: 'critical' })

export function sectionDots(resident) {
  const dots = {}
  if (resident?.current?.service?.behind) dots.service = SECTION_DOT.WARNING
  if (resident?.current?.checks?.notAccounted) dots.checks = SECTION_DOT.CRITICAL
  return dots
}
