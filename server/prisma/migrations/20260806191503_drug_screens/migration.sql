-- CreateEnum
CREATE TYPE "ScreenResult" AS ENUM ('NEGATIVE', 'POSITIVE', 'REFUSAL', 'DILUTE', 'PENDING');

-- CreateEnum
CREATE TYPE "ScreenReason" AS ENUM ('RANDOM', 'FOR_CAUSE');

-- CreateEnum
CREATE TYPE "ScreenMethod" AS ENUM ('URINE', 'ORAL_FLUID', 'BREATH');

-- CreateEnum
CREATE TYPE "Substance" AS ENUM ('ALCOHOL', 'AMPHETAMINES', 'BARBITURATES', 'BENZODIAZEPINES', 'BUPRENORPHINE', 'COCAINE', 'FENTANYL', 'MDMA', 'METHADONE', 'METHAMPHETAMINE', 'OPIATES', 'OXYCODONE', 'PCP', 'THC', 'OTHER');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('NOT_OFFERED', 'PENDING_DECISION', 'DECLINED', 'REQUESTED', 'RETURNED');

-- AlterEnum
ALTER TYPE "LedgerCategory" ADD VALUE 'LAB_FEE';

-- CreateTable
CREATE TABLE "drug_screens" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "reason" "ScreenReason" NOT NULL,
    "method" "ScreenMethod" NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "witnessedById" TEXT NOT NULL,
    "result" "ScreenResult" NOT NULL,
    "substances" "Substance"[],
    "specimenId" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "confirmation" "ConfirmationStatus" NOT NULL DEFAULT 'NOT_OFFERED',
    "residentDecisionAt" TIMESTAMP(3),
    "decisionRecordedById" TEXT,
    "feeLedgerEntryId" TEXT,
    "labName" TEXT,
    "labReference" TEXT,
    "labSentAt" TIMESTAMP(3),
    "labResult" "ScreenResult",
    "labSubstances" "Substance"[],
    "labReturnedAt" TIMESTAMP(3),
    "labRecordedById" TEXT,
    "supersedesId" TEXT,
    "amendmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drug_screens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drug_screens_supersedesId_key" ON "drug_screens"("supersedesId");

-- CreateIndex
CREATE INDEX "drug_screens_stayId_collectedAt_idx" ON "drug_screens"("stayId", "collectedAt" DESC);

-- CreateIndex
CREATE INDEX "drug_screens_confirmation_idx" ON "drug_screens"("confirmation");

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_witnessedById_fkey" FOREIGN KEY ("witnessedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_decisionRecordedById_fkey" FOREIGN KEY ("decisionRecordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_feeLedgerEntryId_fkey" FOREIGN KEY ("feeLedgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_labRecordedById_fkey" FOREIGN KEY ("labRecordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_screens" ADD CONSTRAINT "drug_screens_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "drug_screens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of it is expressible in schema.prisma, and all of
-- it is what makes a screen usable as evidence.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Scalar lists are ALWAYS a list, never NULL ──────────────────────────
--
-- Prisma emits a scalar list as a NULLABLE column with no default, so a row
-- that simply does not mention `substances` gets NULL rather than {} — while
-- the client can only ever represent it as an array. That gap is invisible
-- until a CHECK asks about the column, and then it is issue #1 all over again:
-- cardinality(NULL) is NULL, and a CHECK passes on NULL.
--
-- Closing it here means the IS NOT NULL clauses below are belt-and-braces
-- rather than a trap, and "empty" has exactly one representation.
ALTER TABLE "drug_screens" ALTER COLUMN "substances" SET DEFAULT ARRAY[]::"Substance"[];
ALTER TABLE "drug_screens" ALTER COLUMN "substances" SET NOT NULL;
ALTER TABLE "drug_screens" ALTER COLUMN "labSubstances" SET DEFAULT ARRAY[]::"Substance"[];
ALTER TABLE "drug_screens" ALTER COLUMN "labSubstances" SET NOT NULL;

-- ── 1. The shape of a screen ───────────────────────────────────────────────

-- A collection instant is not the future and not last week. Both columns are
-- on this row, so a same-row CHECK is the right tool. The back-fill this
-- permits is a shift, not a week.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_collected_at_sane"
  CHECK ("collectedAt" <= "createdAt" + interval '1 minute'
     AND "collectedAt" >= "createdAt" - interval '24 hours');

-- A positive names what was found, and nothing else carries substances.
-- cardinality() rather than array_length(), which returns NULL — not 0 — for
-- an empty array. That is issue #1's hole wearing an array costume.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_substances_paired"
  CHECK (
    ("result" = 'POSITIVE' AND "substances" IS NOT NULL AND cardinality("substances") > 0)
    OR ("result" <> 'POSITIVE' AND "substances" IS NOT NULL AND cardinality("substances") = 0)
  );

-- A specimen with no seal number cannot be tied to a lab report — CLAUDE.md's
-- "chain of custody matters, capture it". A refusal produced no specimen.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_specimen_id_present"
  CHECK ("result" IN ('NEGATIVE', 'REFUSAL')
      OR ("specimenId" IS NOT NULL AND length(btrim("specimenId")) > 0));

-- ── 2. The confirmation arc's shape ────────────────────────────────────────

-- Confirmation is offered EXACTLY when there is something to confirm: a
-- positive or a dilute. A negative needs no lab; a refusal produced no
-- specimen to send; a PENDING cup has not been read, so there is no
-- non-negative to offer against yet — when it is read, that is an amendment,
-- and an amendment is a fresh INSERT free to land in any consistent state.
-- Written as an equivalence so neither side can drift from the other.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_offered_iff_confirmable"
  CHECK (("result" IN ('POSITIVE', 'DILUTE')) = ("confirmation" <> 'NOT_OFFERED'));

-- The decision arrives with its author, or not at all. A decision nobody
-- stands behind is not the record that defends the facility.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_decision_paired"
  CHECK (
    ("confirmation" IN ('DECLINED', 'REQUESTED', 'RETURNED')
       AND "residentDecisionAt" IS NOT NULL AND "decisionRecordedById" IS NOT NULL)
    OR ("confirmation" IN ('NOT_OFFERED', 'PENDING_DECISION')
       AND "residentDecisionAt" IS NULL AND "decisionRecordedById" IS NULL)
  );

-- The lab is named when the specimen goes to it, and only then.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_lab_named_when_sent"
  CHECK (
    ("confirmation" IN ('REQUESTED', 'RETURNED')
       AND "labName" IS NOT NULL AND length(btrim("labName")) > 0)
    OR ("confirmation" NOT IN ('REQUESTED', 'RETURNED') AND "labName" IS NULL)
  );

-- The whole return arrives together or not at all.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_lab_return_paired"
  CHECK (
    ("confirmation" = 'RETURNED'
       AND "labResult" IS NOT NULL AND "labReturnedAt" IS NOT NULL
       AND "labRecordedById" IS NOT NULL)
    OR ("confirmation" <> 'RETURNED'
       AND "labResult" IS NULL AND "labReturnedAt" IS NULL
       AND "labRecordedById" IS NULL)
  );

-- A lab speaks a SUBSET of the vocabulary. It cannot report a REFUSAL (that is
-- a fact about the person, recorded at collection) and never a PENDING (which
-- means "not read on site" — a different wait entirely from "at the lab").
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_lab_result_vocabulary"
  CHECK ("labResult" IS NULL OR "labResult" IN ('NEGATIVE', 'POSITIVE', 'DILUTE'));

-- IS DISTINCT FROM, not <>: labResult is nullable, and `NULL <> 'POSITIVE'` is
-- NULL, which a CHECK passes on. Issue #1's hole in its third costume.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_lab_substances_paired"
  CHECK (
    ("labResult" = 'POSITIVE' AND "labSubstances" IS NOT NULL AND cardinality("labSubstances") > 0)
    OR ("labResult" IS DISTINCT FROM 'POSITIVE'
        AND "labSubstances" IS NOT NULL AND cardinality("labSubstances") = 0)
  );

-- Money only ever accompanies an election. A charge on a DECLINED screen is
-- somebody being billed for a service they turned down.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_charge_only_when_requested"
  CHECK ("feeLedgerEntryId" IS NULL OR "confirmation" IN ('REQUESTED', 'RETURNED'));

-- The reason IS the record. Explicit IS NOT NULL, per issue #1.
ALTER TABLE "drug_screens" ADD CONSTRAINT "screen_amendment_reason_paired"
  CHECK (("supersedesId" IS NULL AND "amendmentReason" IS NULL)
      OR ("supersedesId" IS NOT NULL AND "amendmentReason" IS NOT NULL
          AND length(btrim("amendmentReason")) > 0));

-- ── 3. Immutable apart from the confirmation ARC ───────────────────────────
--
-- ServiceEntry's posture rather than ApartmentCheck's: this table has genuine
-- later transitions, so it keeps a SCOPED update grant instead of refusing
-- UPDATE outright. The rule is a whitelist written as a WHOLE-ROW COMPARISON,
-- not a list of column names, so a column added in six months is immutable BY
-- DEFAULT rather than silently mutable because nobody extended a list.
--
-- Eleven whitelisted columns is the widest UPDATE grant in this app, and a
-- real cost. Three things make it affordable, all enforced below:
--   1. every whitelisted column is NULL until its own event;
--   2. the arc runs ONE WAY and each step happens ONCE;
--   3. the whitelist is necessary but NOT sufficient — the arc guard is what
--      stops a lab result arriving with the decision, because both halves sit
--      inside the whitelist and a whole-row diff cannot tell them apart.
CREATE OR REPLACE FUNCTION "drug_screens_confirmation_transition"() RETURNS TRIGGER AS $$
DECLARE arc TEXT[] := ARRAY[
  'confirmation','residentDecisionAt','decisionRecordedById','feeLedgerEntryId',
  'labName','labReference','labSentAt','labResult','labSubstances',
  'labReturnedAt','labRecordedById'];
BEGIN
  IF (to_jsonb(NEW) - arc) IS DISTINCT FROM (to_jsonb(OLD) - arc) THEN
    RAISE EXCEPTION 'a drug screen is immutable apart from the confirmation arc: correct it with an amendment (supersedesId + amendmentReason), never an UPDATE.';
  END IF;

  -- A superseded screen is finished. The decision and the lab belong on the
  -- version that is current, or the chain acquires two rows both claiming to
  -- be what the lab confirmed.
  IF EXISTS (SELECT 1 FROM "drug_screens" WHERE "supersedesId" = OLD."id") THEN
    RAISE EXCEPTION 'this screen has been amended; record the decision or the lab result on the amendment';
  END IF;

  -- Step one: the RESIDENT'S DECISION.
  IF OLD."confirmation" = 'PENDING_DECISION'
     AND NEW."confirmation" IN ('DECLINED', 'REQUESTED') THEN
    -- Inside the whitelist, so the whole-row diff permits it; THIS is what
    -- stops a lab RESULT being smuggled in alongside the decision.
    --
    -- Note labName, labSentAt and labReference are deliberately NOT in this
    -- list: the lab is chosen and the specimen's reference assigned at the
    -- moment it is SENT, which is this step. Only the lab's finding belongs to
    -- the next one.
    IF NEW."labResult" IS NOT NULL OR NEW."labReturnedAt" IS NOT NULL
       OR NEW."labRecordedById" IS NOT NULL THEN
      RAISE EXCEPTION 'a lab result cannot be recorded before the lab has one';
    END IF;
    RETURN NEW;
  END IF;

  -- Step two: the LAB'S RETURN.
  IF OLD."confirmation" = 'REQUESTED' AND NEW."confirmation" = 'RETURNED' THEN
    -- The decision, its author, the lab and the charge were settled at step
    -- one. A return that rewrote them would move somebody's name onto an
    -- election they did not make — ServiceEntry's "never a change of verifier".
    IF NEW."residentDecisionAt" IS DISTINCT FROM OLD."residentDecisionAt"
       OR NEW."decisionRecordedById" IS DISTINCT FROM OLD."decisionRecordedById"
       OR NEW."labName" IS DISTINCT FROM OLD."labName"
       OR NEW."feeLedgerEntryId" IS DISTINCT FROM OLD."feeLedgerEntryId" THEN
      RAISE EXCEPTION 'a lab return cannot rewrite the decision it followed';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'the confirmation arc runs PENDING_DECISION -> DECLINED|REQUESTED -> RETURNED, once and one way (attempted % -> %)',
    OLD."confirmation", NEW."confirmation";
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "drug_screens_transition_only" BEFORE UPDATE ON "drug_screens"
  FOR EACH ROW EXECUTE FUNCTION "drug_screens_confirmation_transition"();

CREATE OR REPLACE FUNCTION "drug_screens_are_never_deleted"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a drug screen is never deleted: correct it with an amendment.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "drug_screens_no_delete" BEFORE DELETE ON "drug_screens"
  FOR EACH ROW EXECUTE FUNCTION "drug_screens_are_never_deleted"();

-- ── 4. An amendment stays inside its own stay ──────────────────────────────
-- Cross-row, so a trigger. Pointing a correction at another resident's screen
-- produces two records that each look internally consistent and are both
-- wrong. A FORKED chain needs nothing here: supersedesId is UNIQUE.
CREATE OR REPLACE FUNCTION "screen_amendment_same_stay"() RETURNS TRIGGER AS $$
DECLARE target_stay TEXT;
BEGIN
  IF NEW."supersedesId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."id" = NEW."supersedesId" THEN
    RAISE EXCEPTION 'a screen cannot amend itself';
  END IF;
  SELECT "stayId" INTO target_stay FROM "drug_screens" WHERE "id" = NEW."supersedesId";
  IF target_stay IS DISTINCT FROM NEW."stayId" THEN
    RAISE EXCEPTION 'a screen amendment must reference a screen on the same stay';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "screen_amendment_scope" BEFORE INSERT ON "drug_screens"
  FOR EACH ROW EXECUTE FUNCTION "screen_amendment_same_stay"();

-- ── 5. Row-level security ──────────────────────────────────────────────────

ALTER TABLE "drug_screens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drug_screens" FORCE ROW LEVEL SECURITY;

-- service_entries' shape, not apartment_checks': a screen belongs to a
-- resident through their stay, and the rule worth stating is "your own, never
-- anyone else's". A staff-only policy would make the assertion that actually
-- matters — resident A cannot read resident B's result — VACUOUS: nothing
-- would be readable, which looks like a pass while testing nothing.
--
-- No resident can reach a screen over HTTP today regardless; every route sits
-- behind requireStaff. This is the database backstop for the day the portal
-- ships, and it already states the true rule.
CREATE POLICY drug_screens_read ON "drug_screens" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "drug_screens"."stayId" AND s."residentId" = app_resident_id())
  );
CREATE POLICY drug_screens_write ON "drug_screens" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- The privilege AGREES with the trigger rather than relying on it: the app
-- role fails on privilege before a trigger is reached, and a superuser —
-- which bypasses RLS even with FORCE — fails on the trigger. The grant is
-- exactly the arc and nothing else.
REVOKE UPDATE, DELETE ON "drug_screens" FROM soberlife_app;
GRANT UPDATE ("confirmation", "residentDecisionAt", "decisionRecordedById",
              "feeLedgerEntryId", "labName", "labReference", "labSentAt",
              "labResult", "labSubstances", "labReturnedAt", "labRecordedById")
  ON "drug_screens" TO soberlife_app;
