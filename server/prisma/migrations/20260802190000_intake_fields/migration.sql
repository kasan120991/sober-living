-- AlterTable
ALTER TABLE "residents" ADD COLUMN     "ssnLast4" TEXT;

-- AlterTable
ALTER TABLE "stays" ADD COLUMN     "intakeNotes" TEXT,
ADD COLUMN     "sobrietyDate" DATE;

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "groupNumber" TEXT,
    "policyHolder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_residentId_key" ON "insurance_policies"("residentId");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Four digits, and only four ─────────────────────────────────────────────
-- The failure this exists to catch is somebody pasting a full SSN into a box
-- labelled "last 4". A facility has no use for the whole number, and holding
-- one turns a records breach into an identity-theft breach. Without this the
-- column would accept anything and nobody would notice until it mattered.
ALTER TABLE "residents"
  ADD CONSTRAINT "resident_ssn_last4_only" CHECK ("ssnLast4" IS NULL OR "ssnLast4" ~ '^[0-9]{4}$');

-- Blank strings pass NOT NULL and mean nothing.
ALTER TABLE "insurance_policies"
  ADD CONSTRAINT "insurance_provider_present" CHECK (length(btrim("provider")) > 0);
ALTER TABLE "insurance_policies"
  ADD CONSTRAINT "insurance_policy_number_present" CHECK (length(btrim("policyNumber")) > 0);

-- ── Row-level security ─────────────────────────────────────────────────────
-- Insurance belongs to a resident directly, like emergency_contacts. Same
-- fail-closed shape: with no actor context both predicates are false and the
-- table reads empty.
--
-- A resident may read their own policy. Whether they should be able to EDIT it
-- is a question for when the resident app exists; until then only staff write.
ALTER TABLE "insurance_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurance_policies" FORCE ROW LEVEL SECURITY;

CREATE POLICY insurance_policies_read ON "insurance_policies" FOR SELECT
  USING (app_is_staff() OR "residentId" = app_resident_id());

CREATE POLICY insurance_policies_write ON "insurance_policies" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());
