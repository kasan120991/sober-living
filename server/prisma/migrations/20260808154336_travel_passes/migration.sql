-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED', 'CANCELLED', 'RETURNED');

-- AlterEnum
ALTER TYPE "CheckResidentStatus" ADD VALUE 'ON_PASS';

-- CreateTable
CREATE TABLE "travel_passes" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT,
    "departAt" TIMESTAMP(3) NOT NULL,
    "returnBy" TIMESTAMP(3) NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnAcknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "travel_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travel_passes_stayId_departAt_idx" ON "travel_passes"("stayId", "departAt");

-- CreateIndex
CREATE INDEX "travel_passes_status_idx" ON "travel_passes"("status");

-- AddForeignKey
ALTER TABLE "travel_passes" ADD CONSTRAINT "travel_passes_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_passes" ADD CONSTRAINT "travel_passes_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_passes" ADD CONSTRAINT "travel_passes_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_passes" ADD CONSTRAINT "travel_passes_returnAcknowledgedById_fkey" FOREIGN KEY ("returnAcknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of it is expressible in schema.prisma.
--
-- NOTE ON THE ENUM ABOVE: `ALTER TYPE ... ADD VALUE` may run inside a
-- transaction on Postgres 12+, but the new value cannot be USED until that
-- transaction commits. So nothing below may mention 'ON_PASS' — and nothing
-- needs to: "a line may only be ON_PASS if a pass covers that instant" is a
-- CROSS-ROW rule, exactly like the existing SIGNED_OUT rule, and lives in
-- services/checks.js beside it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The shape of a pass ────────────────────────────────────────────────

ALTER TABLE "travel_passes" ADD CONSTRAINT "pass_window_ordered"
  CHECK ("returnBy" > "departAt");

-- A review is a person and a moment together or neither. The explicit
-- IS NOT NULL is load-bearing throughout this file for the reason written on
-- check_present_needs_note: a CHECK passes on NULL, so a half-stated branch
-- lets the row through instead of rejecting it.
ALTER TABLE "travel_passes" ADD CONSTRAINT "pass_review_paired"
  CHECK (
    ("status" = 'REQUESTED' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL)
    OR ("status" <> 'REQUESTED' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
  );

-- A refusal with no stated reason is exactly what a resident appeals and the
-- facility cannot defend. Cancelling an approved pass is the same act from the
-- other direction, so it carries the same requirement.
ALTER TABLE "travel_passes" ADD CONSTRAINT "pass_refusal_needs_reason"
  CHECK (
    "status" NOT IN ('DENIED', 'CANCELLED')
    OR ("reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0)
  );

-- A return and the staff member who acknowledged it arrive together or not at
-- all — the sign_outs rule verbatim — and only on a pass that is RETURNED.
ALTER TABLE "travel_passes" ADD CONSTRAINT "pass_return_paired"
  CHECK (
    ("status" = 'RETURNED' AND "returnedAt" IS NOT NULL AND "returnAcknowledgedById" IS NOT NULL)
    OR ("status" <> 'RETURNED' AND "returnedAt" IS NULL AND "returnAcknowledgedById" IS NULL)
  );

-- ── 2. The request half is immutable; only the arc may move ───────────────

-- A WHOLE-ROW comparison rather than a list of column names, so a column added
-- in six months is immutable BY DEFAULT rather than silently mutable because
-- nobody extended the list. drug_screens' trigger, same reasoning.
--
-- `deletedAt` and `updatedAt` are in the whitelist because this table is
-- soft-deletable: a request filed in error is withdrawn, not edited. The
-- service refuses that once the pass has been reviewed.
CREATE OR REPLACE FUNCTION "travel_pass_arc"() RETURNS TRIGGER AS $$
DECLARE arc TEXT[] := ARRAY[
  'status','reviewedById','reviewedAt','reviewNote',
  'returnedAt','returnAcknowledgedById','deletedAt','updatedAt'];
BEGIN
  IF (to_jsonb(NEW) - arc) IS DISTINCT FROM (to_jsonb(OLD) - arc) THEN
    RAISE EXCEPTION 'a travel pass request is immutable: destination, dates and who asked cannot change. Withdraw it and file another.';
  END IF;

  -- No status change is a soft delete or a re-save; the immutability check
  -- above is the whole guard for those.
  IF OLD."status" = NEW."status" THEN RETURN NEW; END IF;

  IF OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'DENIED') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" IN ('CANCELLED', 'RETURNED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'the pass arc runs REQUESTED -> APPROVED|DENIED -> CANCELLED|RETURNED, once and one way (attempted % -> %)', OLD."status", NEW."status";
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "travel_pass_arc_guard" BEFORE UPDATE ON "travel_passes"
  FOR EACH ROW EXECUTE FUNCTION "travel_pass_arc"();

-- ── 3. Row-level security ─────────────────────────────────────────────────

-- The sign_outs shape: staff, or the resident's own stay. A resident may read
-- their own passes — which is what the portal will show them, and what
-- CLAUDE.md's role table has always promised.
ALTER TABLE "travel_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "travel_passes" FORCE ROW LEVEL SECURITY;

CREATE POLICY travel_passes_read ON "travel_passes" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "travel_passes"."stayId" AND s."residentId" = app_resident_id())
  );
CREATE POLICY travel_passes_write ON "travel_passes" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- The privilege agrees with the trigger rather than relying on it: the app role
-- fails on privilege before a trigger is reached, and a superuser — which
-- bypasses RLS even with FORCE — fails on the trigger. The grant is exactly the
-- arc and nothing else. DELETE stays revoked: a withdrawn request is soft, so
-- the row survives.
REVOKE UPDATE, DELETE ON "travel_passes" FROM soberlife_app;
GRANT UPDATE ("status", "reviewedById", "reviewedAt", "reviewNote",
              "returnedAt", "returnAcknowledgedById", "deletedAt", "updatedAt")
  ON "travel_passes" TO soberlife_app;
