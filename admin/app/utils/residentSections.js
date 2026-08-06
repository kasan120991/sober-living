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
  {
    key: 'checks',
    label: 'Apartment checks',
    group: 'Record',
    built: false,
    module: 'Module 4 — Apartment checks',
    summary:
      'Scheduled and random inspections of the apartment this resident lives in, with ' +
      'per-item pass/fail, notes and photos, and which residents were present.',
  },

  // ── Clinical ──────────────────────────────────────────────────────────────
  // Techs see this group (decided 2026-08-02). That is not an exception to the
  // bell rule in CLAUDE.md module 13 — that rule governs *ambient* disclosure, a
  // name against a screen result appearing unbidden on a phone with residents
  // nearby. Opening a named resident's record is a deliberate navigation by
  // someone who already knows who they are looking at, and it is audited.
  {
    key: 'screens',
    label: 'Drug screens',
    group: 'Clinical',
    built: false,
    module: 'Module 5 — Drug screening',
    summary:
      'Test type, collection time, observing staff, result and chain of custody. Refusals ' +
      'and dilutes are distinct outcomes here, never collapsed into "fail" — which is why ' +
      'the theme carries --warning alongside --destructive.',
  },
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
 * The two dot rules, and deliberately only two (CLAUDE.md module 1):
 * amber is behind on service hours, red is an overdue balance.
 *
 * - **Amber is live** since module 7 (2026-08-05). The threshold is a monthly
 *   quota of 20 hours, accruing in whole months and capped at the target, and
 *   it is computed ON THE SERVER — `servicePace()` in
 *   services/communityService.js — so this file only reads a boolean. The
 *   resident portal will need the identical number, and two implementations is
 *   how two screens come to disagree about who is behind.
 * - **Red still needs invoicing** (module 11). A charge has no due date — only
 *   an invoice does — so before invoices exist "overdue" could only mean "owes
 *   anything", which would light red on nearly every resident and teach people
 *   to ignore the colour. Ship the dot with the invoice, not before it.
 *
 * No ticking clock. `behind` does change on the calendar alone, like an overdue
 * sign-out — but it crosses once a month rather than once an hour, so the next
 * page load is soon enough. Do not add a timer here by analogy with the census.
 */
export const SECTION_DOT = Object.freeze({ WARNING: 'warning', CRITICAL: 'critical' })

export function sectionDots(resident) {
  const dots = {}
  if (resident?.current?.service?.behind) dots.service = SECTION_DOT.WARNING
  return dots
}
