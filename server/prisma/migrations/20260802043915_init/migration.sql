-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Cohort" AS ENUM ('MEN', 'WOMEN');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'HOUSE_MANAGER', 'STAFF', 'RESIDENT');

-- CreateEnum
CREATE TYPE "BedStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "StayStatus" AS ENUM ('ACTIVE', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "DischargeType" AS ENUM ('SUCCESSFUL', 'AMA', 'ADMINISTRATIVE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('READ', 'CREATE', 'UPDATE', 'AMEND', 'SOFT_DELETE', 'LOGIN', 'LOGIN_FAILED', 'EXPORT');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RESIDENT_AGREEMENT', 'PHOTO_ID', 'INSURANCE', 'REFERRAL', 'INTAKE_FORM', 'DISCHARGE_SUMMARY', 'OTHER');

-- CreateTable
CREATE TABLE "apartments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "timezone" TEXT NOT NULL,
    "addressLine1" TEXT,
    "unitNumber" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "apartments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beds" (
    "id" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "BedStatus" NOT NULL DEFAULT 'ACTIVE',
    "outOfServiceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residents" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "phone" TEXT,
    "email" TEXT,
    "cohort" "Cohort" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stays" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "programId" TEXT,
    "status" "StayStatus" NOT NULL DEFAULT 'ACTIVE',
    "intakeAt" TIMESTAMP(3) NOT NULL,
    "expectedDischargeAt" TIMESTAMP(3),
    "dischargedAt" TIMESTAMP(3),
    "dischargeType" "DischargeType",
    "dischargeReason" TEXT,
    "referralSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_assignments" (
    "id" TEXT NOT NULL,
    "cohort" "Cohort" NOT NULL,
    "bedId" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bed_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "curfewLocalTime" TEXT,
    "serviceHoursRequired" INTEGER,
    "passEligible" BOOLEAN,
    "minDaysBeforePass" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "residentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" "StaffRole",
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "subjectResidentId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apartments_name_key" ON "apartments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "apartments_id_cohort_key" ON "apartments"("id", "cohort");

-- CreateIndex
CREATE UNIQUE INDEX "beds_apartmentId_label_key" ON "beds"("apartmentId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "beds_id_cohort_key" ON "beds"("id", "cohort");

-- CreateIndex
CREATE INDEX "residents_lastName_firstName_idx" ON "residents"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "residents_id_cohort_key" ON "residents"("id", "cohort");

-- CreateIndex
CREATE INDEX "stays_status_idx" ON "stays"("status");

-- CreateIndex
CREATE INDEX "stays_residentId_idx" ON "stays"("residentId");

-- CreateIndex
CREATE UNIQUE INDEX "stays_id_cohort_key" ON "stays"("id", "cohort");

-- CreateIndex
CREATE INDEX "emergency_contacts_residentId_idx" ON "emergency_contacts"("residentId");

-- CreateIndex
CREATE INDEX "bed_assignments_bedId_startedAt_idx" ON "bed_assignments"("bedId", "startedAt");

-- CreateIndex
CREATE INDEX "bed_assignments_stayId_idx" ON "bed_assignments"("stayId");

-- CreateIndex
CREATE UNIQUE INDEX "programs_name_key" ON "programs"("name");

-- CreateIndex
CREATE INDEX "documents_residentId_idx" ON "documents"("residentId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_residentId_key" ON "users"("residentId");

-- CreateIndex
CREATE INDEX "audit_log_subjectResidentId_at_idx" ON "audit_log"("subjectResidentId", "at");

-- CreateIndex
CREATE INDEX "audit_log_actorId_at_idx" ON "audit_log"("actorId", "at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_apartmentId_cohort_fkey" FOREIGN KEY ("apartmentId", "cohort") REFERENCES "apartments"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stays" ADD CONSTRAINT "stays_residentId_cohort_fkey" FOREIGN KEY ("residentId", "cohort") REFERENCES "residents"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stays" ADD CONSTRAINT "stays_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_bedId_cohort_fkey" FOREIGN KEY ("bedId", "cohort") REFERENCES "beds"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_stayId_cohort_fkey" FOREIGN KEY ("stayId", "cohort") REFERENCES "stays"("id", "cohort") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-added constraints Prisma cannot express in schema.prisma.
-- These are part of this migration on purpose: without them the schema
-- permits states the domain forbids.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. No double-booking a bed ─────────────────────────────────────────────
-- A bed has at most one live assignment. Without this, two staff assigning the
-- same bed at the same moment both succeed and the census silently lies.
CREATE UNIQUE INDEX "one_active_assignment_per_bed"
  ON "bed_assignments" ("bedId")
  WHERE "endedAt" IS NULL;

-- ── 2. A stay occupies at most one bed at a time ───────────────────────────
CREATE UNIQUE INDEX "one_active_bed_per_stay"
  ON "bed_assignments" ("stayId")
  WHERE "endedAt" IS NULL;

-- ── 3. The audit log is append-only, enforced by the database ──────────────
-- CLAUDE.md requires the audit log be immutable. Application discipline is not
-- enough: this must hold even against a direct psql session or a compromised
-- app credential.
CREATE OR REPLACE FUNCTION "audit_log_is_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_no_update"
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_is_append_only"();

CREATE TRIGGER "audit_log_no_delete"
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_is_append_only"();

-- ── 4. Bed history is append-only except for closing an assignment ─────────
-- Rows may be updated ONLY to set endedAt/endedReason. Rewriting who was in a
-- bed, or when, would destroy the record that answers "who slept in 12B on
-- March 12" — which is the entire reason this table exists.
CREATE OR REPLACE FUNCTION "bed_assignments_history_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bed_assignments is permanent history and cannot be deleted';
  END IF;

  IF NEW."bedId"      IS DISTINCT FROM OLD."bedId"
  OR NEW."stayId"     IS DISTINCT FROM OLD."stayId"
  OR NEW."cohort"     IS DISTINCT FROM OLD."cohort"
  OR NEW."startedAt"  IS DISTINCT FROM OLD."startedAt"
  OR NEW."assignedById" IS DISTINCT FROM OLD."assignedById" THEN
    RAISE EXCEPTION 'bed_assignments history is immutable; only endedAt/endedReason may change';
  END IF;

  IF OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    RAISE EXCEPTION 'a closed bed assignment cannot be reopened or re-dated';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bed_assignments_immutable"
  BEFORE UPDATE OR DELETE ON "bed_assignments"
  FOR EACH ROW EXECUTE FUNCTION "bed_assignments_history_guard"();

-- ── 5. Row-level security: NOT enabled here, deliberately ──────────────────
-- RLS is the planned second line of defence behind the Express authorization
-- middleware. It is not enabled in this migration because the policies depend
-- on the app setting a per-request session variable (the acting user), and that
-- plumbing does not exist until auth is built. Enabling it now would deny the
-- application access to its own data.
--
-- It lands in its own migration alongside auth. Do not forget it — see
-- CLAUDE.md, "Row-level security".
