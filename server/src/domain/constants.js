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

/// A request in one of these states is finished and needs a resolution note.
export const MAINTENANCE_CLOSED_STATUSES = Object.freeze([
  MAINTENANCE_STATUS.RESOLVED,
  MAINTENANCE_STATUS.CANCELLED,
])

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
  // Facility configuration
  'Apartment',
  'Bed',
  'MaintenanceRequest',
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
  'User',
  'MaintenanceRequest',
])
