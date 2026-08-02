-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CHARGE', 'PAYMENT', 'CREDIT');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "correctsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_stayId_occurredAt_idx" ON "ledger_entries"("stayId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of this is expressible in schema.prisma, and all of
-- it is the point: without it a "ledger" is just a table someone can rewrite.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The amount is always positive ───────────────────────────────────────
-- The sign lives in "type". Without this, a caller can "undo" a charge by
-- posting a negative one, and the ledger silently grows two conventions for the
-- same fact — at which point no sum is trustworthy.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_amount_positive" CHECK ("amountCents" > 0);

-- A blank description passes NOT NULL and tells a reader nothing.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_description_present" CHECK (length(btrim("description")) > 0);

-- ── 2. The ledger is append-only, enforced by the database ─────────────────
-- Stricter than bed_assignments, which may be updated to close an assignment.
-- Nothing here is ever updated: a mistake is a new entry with "correctsId" set.
-- This has to hold against a direct psql session, not just against our routes —
-- a money record that the application can quietly rewrite is not evidence.
CREATE OR REPLACE FUNCTION "ledger_entries_is_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted. Correct a mistake with a new entry referencing correctsId.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_no_update"
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_is_append_only"();

CREATE TRIGGER "ledger_entries_no_delete"
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_is_append_only"();

-- Note the correctsId foreign key is ON DELETE SET NULL, which Prisma generates
-- for an optional relation. It is unreachable: DELETE is refused by the trigger
-- above and the privilege is revoked below. Left as generated so `prisma migrate
-- diff` stays quiet rather than reporting permanent drift.

-- ── 3. A correction stays inside its own stay ──────────────────────────────
-- Pointing a correction at another resident's line would produce two ledgers
-- that each look internally consistent and are both wrong. Cross-row, so it
-- cannot be a CHECK.
CREATE OR REPLACE FUNCTION "ledger_correction_same_stay"()
RETURNS TRIGGER AS $$
DECLARE
  target_stay TEXT;
BEGIN
  IF NEW."correctsId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "stayId" INTO target_stay FROM "ledger_entries" WHERE "id" = NEW."correctsId";

  IF target_stay IS DISTINCT FROM NEW."stayId" THEN
    RAISE EXCEPTION 'a ledger correction must reference an entry on the same stay';
  END IF;

  IF NEW."id" = NEW."correctsId" THEN
    RAISE EXCEPTION 'a ledger entry cannot correct itself';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_correction_scope"
  BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_correction_same_stay"();

-- ── 4. Row-level security ──────────────────────────────────────────────────
-- A ledger entry belongs to a resident through its stay, exactly as a bed
-- assignment does. Fail-closed like every other policy: with no actor context
-- set, both predicates are false and the table reads as empty.
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY ledger_entries_read ON "ledger_entries" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (
      SELECT 1 FROM "stays" s
       WHERE s."id" = "ledger_entries"."stayId"
         AND s."residentId" = app_resident_id()
    )
  );

-- Residents may read what they owe. Only staff may post to it.
CREATE POLICY ledger_entries_write ON "ledger_entries" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- Belt and braces, matching audit_log and bed_assignments: the attempt fails on
-- privilege before the trigger is even reached.
REVOKE UPDATE, DELETE ON "ledger_entries" FROM soberlife_app;
