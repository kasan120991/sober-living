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

/// Models carrying resident data. Every read and write of these is audited.
export const PHI_MODELS = Object.freeze([
  'Resident',
  'Stay',
  'EmergencyContact',
  'BedAssignment',
  'Document',
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
])
