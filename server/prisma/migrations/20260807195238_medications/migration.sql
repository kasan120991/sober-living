-- CreateEnum
CREATE TYPE "MedLogStatus" AS ENUM ('GIVEN', 'REFUSED', 'HELD');

-- CreateTable
CREATE TABLE "medications" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "instructions" TEXT,
    "prescriber" TEXT,
    "pharmacy" TEXT,
    "times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPrn" BOOLEAN NOT NULL DEFAULT false,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "endReason" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "med_logs" (
    "id" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "status" "MedLogStatus" NOT NULL,
    "observedById" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "note" TEXT,
    "supersedesId" TEXT,
    "amendmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "med_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medications_stayId_idx" ON "medications"("stayId");

-- CreateIndex
CREATE UNIQUE INDEX "medications_id_stayId_key" ON "medications"("id", "stayId");

-- CreateIndex
CREATE UNIQUE INDEX "med_logs_supersedesId_key" ON "med_logs"("supersedesId");

-- CreateIndex
CREATE INDEX "med_logs_stayId_scheduledFor_idx" ON "med_logs"("stayId", "scheduledFor" DESC);

-- CreateIndex
CREATE INDEX "med_logs_medicationId_idx" ON "med_logs"("medicationId");

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "med_logs" ADD CONSTRAINT "med_logs_medicationId_stayId_fkey" FOREIGN KEY ("medicationId", "stayId") REFERENCES "medications"("id", "stayId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "med_logs" ADD CONSTRAINT "med_logs_observedById_fkey" FOREIGN KEY ("observedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "med_logs" ADD CONSTRAINT "med_logs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "med_logs" ADD CONSTRAINT "med_logs_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "med_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of it is expressible in schema.prisma, and all of it
-- is what makes a med pass usable as evidence.
--
-- The two tables have DELIBERATELY DIFFERENT postures, and confusing them is
-- the mistake to avoid here:
--
--   medications — the standing instruction. Current state, freely updatable,
--                 soft-deletable. The maintenance_requests posture.
--   med_logs    — the dose as observed. Append-only, zero UPDATEs, corrected
--                 only by amendment. Stricter than service_entries, which keeps
--                 one write-once UPDATE for verification; a dose has no
--                 transition at all.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. A scalar list is ALWAYS a list, never NULL ──────────────────────────

-- Prisma emits a scalar list as a nullable column. It honoured `@default([])`
-- above but not NOT NULL, and that gap is not cosmetic: cardinality(NULL) is
-- NULL, so `cardinality("times") = 0` would be NULL and A CHECK PASSES ON NULL
-- — med_prn_has_no_times below would wave through a row with no times at all.
-- Same hole as issue #1, wearing an array costume (see drug_screens.substances).
ALTER TABLE "medications" ALTER COLUMN "times" SET NOT NULL;

-- ── 1. The shape of a medication ───────────────────────────────────────────

-- PRN and scheduled are the two kinds, and each excludes the other's shape. A
-- PRN med with times would appear as DUE on a board and be chased; a scheduled
-- med with no times is a standing instruction that instructs nothing and would
-- silently never appear at all — the worse of the two failures.
ALTER TABLE "medications" ADD CONSTRAINT "med_prn_has_no_times"
  CHECK (("isPrn" AND cardinality("times") = 0)
      OR (NOT "isPrn" AND cardinality("times") > 0));

-- Times are facility WALL-CLOCK strings, and the whole module reads them with
-- facilityWallClockToUtc(). One malformed element makes that return an Invalid
-- Date, which propagates to a dose nobody can mark.
--
-- Written as a regex over the JOINED array rather than per element on purpose:
-- unnest() is set-returning and a CHECK may not contain a subquery, so
-- array_to_string is the only way to say "every element" in an immutable
-- expression. The empty-array case is spelled out because array_to_string
-- returns '' there, which the pattern would reject.
ALTER TABLE "medications" ADD CONSTRAINT "med_times_are_wall_clock"
  CHECK (cardinality("times") = 0
      OR array_to_string("times", ',')
         ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$');

ALTER TABLE "medications" ADD CONSTRAINT "med_window_ordered"
  CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");

-- Discontinuing a medication is the sanctioned way to end one, and "why" is the
-- part an auditor asks about. The explicit IS NOT NULL is load-bearing for the
-- reason written on check_present_needs_note: length(btrim(NULL)) is NULL,
-- FALSE OR NULL is NULL, and a CHECK passes on NULL.
ALTER TABLE "medications" ADD CONSTRAINT "med_end_reason_paired"
  CHECK (("endsOn" IS NULL AND "endReason" IS NULL)
      OR ("endsOn" IS NOT NULL AND "endReason" IS NOT NULL
          AND length(btrim("endReason")) > 0));

-- ── 2. The shape of a dose ─────────────────────────────────────────────────

-- GIVEN is the ordinary case and needs no explanation. REFUSED and HELD are
-- both departures from the standing instruction, and a departure with no reason
-- is a half-filled form that reached the table. Same IS NOT NULL guard.
ALTER TABLE "med_logs" ADD CONSTRAINT "med_log_needs_note"
  CHECK ("status" = 'GIVEN'
      OR ("note" IS NOT NULL AND length(btrim("note")) > 0));

-- The reason IS the record: without it the chain shows that a dose log changed
-- and nothing about why. check_amendment_reason_paired verbatim.
ALTER TABLE "med_logs" ADD CONSTRAINT "med_log_amendment_reason_paired"
  CHECK (("supersedesId" IS NULL AND "amendmentReason" IS NULL)
      OR ("supersedesId" IS NOT NULL AND "amendmentReason" IS NOT NULL
          AND length(btrim("amendmentReason")) > 0));

-- ── 3. Dose logs are append-only ───────────────────────────────────────────

-- Two layers, because they stop different things: the REVOKE stops the app
-- role, which fails on privilege before a trigger is ever reached, and the
-- trigger stops a SUPERUSER, which bypasses RLS even with FORCE. A test that
-- conflates the two proves neither, so verify-meds.js asserts them separately.
--
-- No column-level GRANT survives the REVOKE, unlike drug_screens: that table
-- has a confirmation arc to transition and this one has nothing at all.
CREATE OR REPLACE FUNCTION "med_logs_are_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'med logs are append-only: correct a dose with an amendment (supersedesId + amendmentReason), never an UPDATE or DELETE.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "med_logs_no_update" BEFORE UPDATE ON "med_logs"
  FOR EACH ROW EXECUTE FUNCTION "med_logs_are_append_only"();
CREATE TRIGGER "med_logs_no_delete" BEFORE DELETE ON "med_logs"
  FOR EACH ROW EXECUTE FUNCTION "med_logs_are_append_only"();

REVOKE UPDATE, DELETE ON "med_logs" FROM soberlife_app;

-- `medications` is deliberately NOT revoked. A dose that changes is current
-- state, not a new fact about the past — the maintenance_requests split, where
-- the request stays updatable and only its trail is frozen.

-- ── 4. An amendment stays inside its own medication ────────────────────────

-- Cross-row, so a trigger rather than a CHECK — the same reason as
-- check_amendment_same_apartment. An amendment claiming a different medication
-- would be two internally-consistent records of a dose that never happened.
-- The stay is pinned too, though the composite foreign key already makes a
-- cross-stay pair impossible: stating it here means the failure arrives as a
-- sentence about amendments rather than as a foreign-key violation.
CREATE OR REPLACE FUNCTION "med_amendment_same_medication"() RETURNS TRIGGER AS $$
DECLARE target_med TEXT; target_stay TEXT;
BEGIN
  IF NEW."supersedesId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."id" = NEW."supersedesId" THEN
    RAISE EXCEPTION 'a dose log cannot amend itself';
  END IF;
  SELECT "medicationId", "stayId" INTO target_med, target_stay
    FROM "med_logs" WHERE "id" = NEW."supersedesId";
  IF target_med IS DISTINCT FROM NEW."medicationId"
     OR target_stay IS DISTINCT FROM NEW."stayId" THEN
    RAISE EXCEPTION 'a dose amendment must reference a log of the same medication and stay';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "med_amendment_scope" BEFORE INSERT ON "med_logs"
  FOR EACH ROW EXECUTE FUNCTION "med_amendment_same_medication"();

-- ── 5. One live log per scheduled dose ─────────────────────────────────────

-- A dose is one slot and can be answered once. A partial unique index cannot
-- express this: "live" means no OTHER row supersedes it, which is a fact about
-- a different row, and a partial index predicate may only see its own.
--
-- The amended row is excluded explicitly. At BEFORE INSERT the amendment does
-- not exist yet, so the row it is about to supersede still looks live and would
-- collide with itself.
--
-- PRN doses are exempt: scheduledFor is NULL, there is no slot to answer, and a
-- resident may genuinely take an as-needed medication twice in a day.
--
-- services/meds.js returns a friendly 409 before this fires. The trigger is the
-- enforcement and the 409 is only its face — the assignBedTo pattern.
CREATE OR REPLACE FUNCTION "med_log_one_live_per_dose"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."scheduledFor" IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM "med_logs" existing
     WHERE existing."medicationId" = NEW."medicationId"
       AND existing."scheduledFor" = NEW."scheduledFor"
       AND (NEW."supersedesId" IS NULL OR existing."id" <> NEW."supersedesId")
       AND NOT EXISTS (
         SELECT 1 FROM "med_logs" newer WHERE newer."supersedesId" = existing."id")
  ) THEN
    RAISE EXCEPTION 'this dose has already been recorded; correct it with an amendment rather than a second log';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "med_log_one_per_dose" BEFORE INSERT ON "med_logs"
  FOR EACH ROW EXECUTE FUNCTION "med_log_one_live_per_dose"();

-- ── 6. Row-level security ──────────────────────────────────────────────────

-- Both tables are resident data, and both take the sign_outs policy shape:
-- staff, or the resident's own stay. Unlike apartment_checks — whose HEADER is
-- staff-only because its free-text note can name other residents — nothing here
-- describes anyone but the one resident the row is about, so the own-stay read
-- is written now rather than deferred. It is what the resident portal will use
-- to show somebody their own medications, and CLAUDE.md's role table has always
-- promised exactly that.

ALTER TABLE "medications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medications" FORCE ROW LEVEL SECURITY;

CREATE POLICY medications_read ON "medications" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "medications"."stayId" AND s."residentId" = app_resident_id())
  );
CREATE POLICY medications_write ON "medications" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

ALTER TABLE "med_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "med_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY med_logs_read ON "med_logs" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "med_logs"."stayId" AND s."residentId" = app_resident_id())
  );
CREATE POLICY med_logs_write ON "med_logs" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());
