// Domain states. These MUST stay in sync with the enum blocks in
// prisma/schema.prisma — the schema is the type system, this is the mirror the
// application code reads. Frozen so a typo is a TypeError, not a silent string.

export const COHORT = Object.freeze({
  MEN: 'MEN',
  WOMEN: 'WOMEN',
})

export const STAFF_ROLE = Object.freeze({
  ADMIN: 'ADMIN',
  HOUSE_MANAGER: 'HOUSE_MANAGER',
  STAFF: 'STAFF',
  RESIDENT: 'RESIDENT',
})

export const BED_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
})

export const STAY_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISCHARGED: 'DISCHARGED',
})

export const DISCHARGE_TYPE = Object.freeze({
  SUCCESSFUL: 'SUCCESSFUL',
  AMA: 'AMA',
  ADMINISTRATIVE: 'ADMINISTRATIVE',
  TRANSFER: 'TRANSFER',
})

export const LEDGER_ENTRY_TYPE = Object.freeze({
  CHARGE: 'CHARGE',
  PAYMENT: 'PAYMENT',
  CREDIT: 'CREDIT',
})

/// Set on a CHARGE, never on a payment or credit — the database enforces it.
export const LEDGER_CATEGORY = Object.freeze({
  RENT: 'RENT',
  LAUNDRY: 'LAUNDRY',
  TRIP: 'TRIP',
  PROGRAM_FEE: 'PROGRAM_FEE',
  DAMAGE: 'DAMAGE',
  /// What a resident pays to send a non-negative screen for lab confirmation.
  /// Its own category rather than PROGRAM_FEE because categories exist so
  /// "what did we bill in X last quarter" is answerable without grepping
  /// descriptions — see module 11.
  LAB_FEE: 'LAB_FEE',
  OTHER: 'OTHER',
})

/// Which way each type moves a balance. Used to derive the balance rather than
/// spelling the arithmetic out at each call site, where one wrong sign would be
/// a resident being told they owe money they do not.
export const LEDGER_SIGN = Object.freeze({
  CHARGE: 1,
  PAYMENT: -1,
  CREDIT: -1,
})

export const AUDIT_ACTION = Object.freeze({
  READ: 'READ',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  AMEND: 'AMEND',
  SOFT_DELETE: 'SOFT_DELETE',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  EXPORT: 'EXPORT',
})

export const DOCUMENT_TYPE = Object.freeze({
  RESIDENT_AGREEMENT: 'RESIDENT_AGREEMENT',
  PHOTO_ID: 'PHOTO_ID',
  INSURANCE: 'INSURANCE',
  REFERRAL: 'REFERRAL',
  INTAKE_FORM: 'INTAKE_FORM',
  DISCHARGE_SUMMARY: 'DISCHARGE_SUMMARY',
  OTHER: 'OTHER',
})

export const MAINTENANCE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
})

export const MAINTENANCE_PRIORITY = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  URGENT: 'URGENT',
})

/// The two transitions that leave a permanent row. Starting work and changing
/// priority are ordinary updates and appear nowhere here — the facility asked
/// for a trail of the consequential transitions, not an event log.
export const MAINTENANCE_EVENT_KIND = Object.freeze({
  CLOSED: 'CLOSED',
  REOPENED: 'REOPENED',
})

/// A request in one of these states is finished and needs a resolution note.
export const MAINTENANCE_CLOSED_STATUSES = Object.freeze([
  MAINTENANCE_STATUS.RESOLVED,
  MAINTENANCE_STATUS.CANCELLED,
])

/// Still live work. The complement of MAINTENANCE_CLOSED_STATUSES, spelled out
/// because it is what every "is this outstanding" read filters on.
export const MAINTENANCE_OPEN_STATUSES = Object.freeze([
  MAINTENANCE_STATUS.OPEN,
  MAINTENANCE_STATUS.IN_PROGRESS,
])

/**
 * How long a request of each priority may sit before it is overdue.
 *
 * THE one knob, the OVERDUE_GRACE_MS / MONTHLY_SERVICE_QUOTA_HOURS idiom:
 * `overdueRequestWhere()` in services/maintenance.js is built from this and is
 * shared by the page, the bell and the dashboard, so the three cannot disagree
 * about what is late. Facility policy, chosen 2026-08-07.
 *
 * Measured from `reportedAt`, not from the last time anybody touched it —
 * "how long has this been broken" is the question, and re-prioritising a
 * request or assigning it to somebody does not make the tenant's shower work.
 *
 * Derived on read, never stored: no cron, no flag, and a target that changes
 * re-reads every request correctly rather than needing a backfill.
 */
export const MAINTENANCE_TARGET_MS = Object.freeze({
  [MAINTENANCE_PRIORITY.URGENT]: 24 * 60 * 60_000,
  [MAINTENANCE_PRIORITY.NORMAL]: 7 * 24 * 60 * 60_000,
  [MAINTENANCE_PRIORITY.LOW]: 30 * 24 * 60 * 60_000,
})

/**
 * Models whose every read and write is written to the audit log.
 *
 * Named for what it does, not for what it holds: the first five carry resident
 * data and are the 42 CFR Part 2 concern, while Apartment, Bed and
 * MaintenanceRequest are facility configuration. Config is audited because
 * changing it changes the meaning of historical records — renaming an apartment
 * or taking a bed out of service alters how past bed history reads, and an
 * auditor asking "why does 12D show empty in March" deserves an answer.
 */
export const AUDITED_MODELS = Object.freeze([
  // Resident data
  'Resident',
  'Stay',
  'EmergencyContact',
  'BedAssignment',
  'Document',
  'LedgerEntry',
  'InsurancePolicy',
  'SignOut',
  'ScheduleAttendee',
  'ScheduleAttendance',
  'ServiceEntry',
  'ApartmentCheck',
  'ApartmentCheckResident',
  'DrugScreen',
  'Invoice',
  'InvoiceLine',
  // Facility configuration
  'Apartment',
  'Bed',
  'MaintenanceRequest',
  'MaintenanceEvent',
  // The schedule is configuration too, and audited for the same reason as an
  // apartment: changing it changes how historical attendance reads. An auditor
  // asking "why does the Tuesday group show empty in March" deserves an answer.
  'ScheduleEvent',
  'ScheduleOccurrence',
  'ScheduleSession',
])

/// Models with a deletedAt column. Everything here is filtered on read, and
/// deletion is always a soft delete. Note BedAssignment and AuditLog are
/// deliberately absent — those two are append-only history.
export const SOFT_DELETE_MODELS = Object.freeze([
  'Apartment',
  'Bed',
  'Resident',
  'Stay',
  'EmergencyContact',
  'Program',
  'Document',
  'InsurancePolicy',
  'User',
  'MaintenanceRequest',
  'SignOut',
  'ScheduleEvent',
  'ScheduleOccurrence',
  'ScheduleAttendee',
  // ScheduleSession and ScheduleAttendance are deliberately absent, and this is
  // not an oversight to be tidied up later. A session row exists only because
  // it carries a record, so CANCEL is the operation and delete is not one; and
  // a mark is corrected by changing its status, never removed.
  //
  // ServiceEntry is absent for the same class of reason and has no deletedAt at
  // all: it is corrected by an AMENDMENT — a new row pointing at the original —
  // and the database refuses both UPDATE and DELETE.
  //
  // ApartmentCheck and ApartmentCheckResident are absent for the same reason,
  // and go further: there is no verification transition, so the database
  // refuses every UPDATE, not just most of them.
  //
  // DrugScreen is absent too, and sits between the two: it is corrected by
  // amendment like both, but keeps a scoped UPDATE grant for the confirmation
  // arc, because the resident's decision and the lab's result are later facts
  // about the same screen rather than edits to it.
  //
  // Invoice and InvoiceLine are absent as well. An invoice is VOIDED, never
  // deleted — a sent demand for money is evidence that it was sent — and an
  // invoice line is append-only outright: a charge is billed exactly once,
  // forever, which is what stops a void from quietly re-billing anybody.
])

/// Presence on the census board. DERIVED from a sign-out's returnedAt and
/// expectedReturnAt against the clock — never stored, so deliberately not a
/// schema enum. A stored flag would need a job to flip it and would lie the
/// minute the job lagged.
export const PRESENCE = Object.freeze({
  IN: 'IN',
  OUT: 'OUT',
  OVERDUE: 'OVERDUE',
})

/// How one resident was accounted for on one apartment check. Matches the
/// `CheckResidentStatus` enum in schema.prisma.
export const CHECK_RESIDENT_STATUS = Object.freeze({
  PRESENT: 'PRESENT',
  SIGNED_OUT: 'SIGNED_OUT',
  NOT_FOUND: 'NOT_FOUND',
})

/// An apartment's standing in the hourly round. DERIVED from its latest
/// check's checkedAt against the clock — deliberately NOT a schema enum,
/// exactly like PRESENCE and SESSION_STATE. A stored state would need a job
/// to flip DUE to OVERDUE and would lie the minute the job lagged.
export const CHECK_STATE = Object.freeze({
  /// A current check exists in the current facility hour.
  CHECKED: 'CHECKED',
  /// No check this hour yet; the rolling alarm has not fired.
  DUE: 'DUE',
  /// More than an hour plus grace since the last check — or no check ever.
  OVERDUE: 'OVERDUE',
  /// History only: an elapsed hour bucket with no check.
  MISSED: 'MISSED',
})

/// An invoice's state, mirroring Stripe's. Matches `InvoiceStatus` in
/// schema.prisma. There is deliberately no OVERDUE: that is `dueAt` against a
/// clock, derived on read like PRESENCE and CHECK_STATE.
export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
})

/**
 * The payment term: an invoice is due at the END of the Nth facility day after
 * it is sent (facility policy, 2026-08-07).
 *
 * This REPLACES "due on receipt", which was not a term so much as a bug: with
 * `dueAt` set to the moment of sending and `overdue` derived as `dueAt < now`,
 * every invoice this app had ever produced was overdue about a second after it
 * went out. A separate 7-day `INVOICE_DOT_GRACE_DAYS` hid that from the record's
 * red dot but never from the ledger's own label, which is where it was caught.
 *
 * That grace is GONE rather than reduced, and the dot now lights the moment an
 * invoice is overdue. Three days of terms is the grace; a second grace stacked
 * on top would be two knobs for one idea and the next reader would have to work
 * out which one a screen was showing. The `OVERDUE_GRACE_MS` idiom still stands
 * where it was born — sign-outs, where the deadline is a promise a resident made
 * and the alarm should lag it.
 */
export const INVOICE_NET_DAYS = 3

/**
 * What a line on a Stripe invoice is allowed to SAY.
 *
 * Derived from the category, NEVER from the ledger's own description. A
 * description is unreviewed free text a manager typed into a box — it can say
 * "Rent, after the relapse" — and sending it verbatim would ship arbitrary
 * prose about somebody in a SUD program to a third party and every
 * subprocessor downstream.
 *
 * LAB_FEE is the sharpest case: "Lab confirmation fee" on a sober living
 * facility's Stripe account narrows to *this person had a non-negative
 * screen*. The clearance of 2026-08-06 covers identity, not clinical
 * inference. "Testing fee" names a real service and implies no outcome.
 *
 * A fixed set is also what makes the rule TESTABLE — verify-ledger.js asserts
 * over the whole enum. "Be careful what you type" is not a rule.
 */
export const STRIPE_LINE_LABEL = Object.freeze({
  RENT: 'Rent',
  LAUNDRY: 'Laundry',
  TRIP: 'Activity fee',
  PROGRAM_FEE: 'Program fee',
  DAMAGE: 'Property repair',
  LAB_FEE: 'Testing fee',
  OTHER: 'Program charge',
})

/// The account this facility bills in. One place, so nothing hardcodes 'usd'.
export const INVOICE_CURRENCY = 'usd'

/// The account a Stripe webhook's ledger writes are attributed to. It exists
/// because `recordedById` is NOT NULL and no human posted the row — and it is
/// honest: attributing a card payment to whoever sent the invoice would put
/// their name on money they never touched.
export const STRIPE_SYSTEM_EMAIL = 'stripe@system.soberlife'

/// The outcome of a drug screen — the cup's, and later the lab's. Matches the
/// `ScreenResult` enum in schema.prisma.
///
/// REFUSAL and DILUTE are their own outcomes and are never collapsed into a
/// failure: "he would not give a sample" and "the sample was watered down" are
/// different facts with different consequences. This is why the theme carries
/// --warning beside --destructive.
export const SCREEN_RESULT = Object.freeze({
  NEGATIVE: 'NEGATIVE',
  POSITIVE: 'POSITIVE',
  REFUSAL: 'REFUSAL',
  DILUTE: 'DILUTE',
  /// Collected and NOT READ on site. Deliberately not the same as "at the
  /// lab", which is CONFIRMATION_STATUS.REQUESTED — two different waits, and
  /// conflating them is the bug this comment exists to prevent. Reads as
  /// "Not read" in the UI.
  PENDING: 'PENDING',
})

/// Why a screen happened. Matches `ScreenReason`. Recorded, never generated:
/// there is no randomizer and no cron.
export const SCREEN_REASON = Object.freeze({
  RANDOM: 'RANDOM',
  FOR_CAUSE: 'FOR_CAUSE',
})

/// What kind of test it was. Matches `ScreenMethod`.
export const SCREEN_METHOD = Object.freeze({
  URINE: 'URINE',
  ORAL_FLUID: 'ORAL_FLUID',
  BREATH: 'BREATH',
})

/// Where a screen sits in the lab-confirmation arc. Matches
/// `ConfirmationStatus`. DECLINED is a value of its own because "he was
/// offered confirmation and declined" is a record, never an absence.
export const CONFIRMATION_STATUS = Object.freeze({
  NOT_OFFERED: 'NOT_OFFERED',
  PENDING_DECISION: 'PENDING_DECISION',
  DECLINED: 'DECLINED',
  REQUESTED: 'REQUESTED',
  RETURNED: 'RETURNED',
})

/// The panel. Matches the `Substance` enum in schema.prisma, which is what
/// makes the database reject an off-list value.
export const SUBSTANCE = Object.freeze({
  ALCOHOL: 'ALCOHOL',
  AMPHETAMINES: 'AMPHETAMINES',
  BARBITURATES: 'BARBITURATES',
  BENZODIAZEPINES: 'BENZODIAZEPINES',
  BUPRENORPHINE: 'BUPRENORPHINE',
  COCAINE: 'COCAINE',
  FENTANYL: 'FENTANYL',
  MDMA: 'MDMA',
  METHADONE: 'METHADONE',
  METHAMPHETAMINE: 'METHAMPHETAMINE',
  OPIATES: 'OPIATES',
  OXYCODONE: 'OXYCODONE',
  PCP: 'PCP',
  THC: 'THC',
  OTHER: 'OTHER',
})

/**
 * What the facility charges a resident who ELECTS lab confirmation of a
 * non-negative screen (facility policy, chosen 2026-08-06). Integer CENTS,
 * like every figure of money in this app.
 *
 * THE one knob, the OVERDUE_GRACE_MS / MONTHLY_SERVICE_QUOTA_HOURS idiom:
 * services/screens.js posts through it and `GET /screens` echoes it back as
 * `feeCents` so the confirmation dialog quotes the same number the ledger
 * will receive. Never hardcode 5000 in a Vue file — that is how a dialog comes
 * to quote a figure the ledger disagrees with.
 */
export const LAB_CONFIRMATION_FEE_CENTS = 5000

/// How a scheduled occurrence repeats. Matches the `Recurrence` enum in
/// schema.prisma. Two values on purpose — see the schema comment.
export const RECURRENCE = Object.freeze({
  ONCE: 'ONCE',
  WEEKLY: 'WEEKLY',
})

/// What happened for one person at one dated session. Matches the
/// `AttendanceStatus` enum in schema.prisma. Absent and excused stay distinct.
export const ATTENDANCE_STATUS = Object.freeze({
  ATTENDED: 'ATTENDED',
  ABSENT: 'ABSENT',
  EXCUSED: 'EXCUSED',
})

/// 0..6, matching JS getUTCDay(). Computed from the facility CALENDAR date, so
/// no timezone is involved in deciding which weekday a date is — the date
/// string is parsed as UTC and read as UTC, start to finish.
export const WEEKDAY = Object.freeze({
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
})

/// The state of a dated session. DERIVED from cancelledAt / attendanceTakenAt
/// and the clock — deliberately NOT a schema enum, exactly like PRESENCE above.
/// A stored state would need a job to flip SCHEDULED to MISSED and would lie
/// the minute the job lagged.
export const SESSION_STATE = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  CANCELLED: 'CANCELLED',
  TAKEN: 'TAKEN',
  /// Past, not cancelled, and nobody took the roll. The one that needs chasing.
  MISSED: 'MISSED',
})

/**
 * The expected community-service pace: twenty hours a month.
 *
 * Facility policy (chosen 2026-08-05). THE one knob — the amber dot on the
 * resident record, the pace marker on the progress bar and the "behind by"
 * figure all derive from it through servicePace(), so changing it here changes
 * it everywhere.
 *
 * It is a PACE, not the obligation. The obligation is the target, which comes
 * from Program.serviceHoursRequired or a per-stay override.
 */
export const MONTHLY_SERVICE_QUOTA_HOURS = 20

/**
 * A "month" of a stay, for the quota above. Thirty days from intake, not a
 * calendar month.
 *
 * Calendar months would need a policy for the partial first and last one — a
 * resident who intakes on the 28th does not owe twenty hours in three days —
 * and thirty days from their own intake date simply does not have that problem.
 */
export const SERVICE_DAYS_PER_MONTH = 30

/// How far ahead a schedule read may expand, in days. Bounded on purpose:
/// expansion is cheap only while the window is, and it is clamped server-side
/// so a hand-written `?days=3650` cannot turn a page read into a report.
export const SCHEDULE_MAX_DAYS = 62
