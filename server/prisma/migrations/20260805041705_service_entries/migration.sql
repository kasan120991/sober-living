-- AlterTable
ALTER TABLE "stays" ADD COLUMN     "serviceHoursRequired" INTEGER;

-- CreateTable
CREATE TABLE "service_entries" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "workedOn" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "supervisorName" TEXT,
    "supervisorPhone" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "supersedesId" TEXT,
    "amendmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_entries_supersedesId_key" ON "service_entries"("supersedesId");

-- CreateIndex
CREATE INDEX "service_entries_stayId_workedOn_idx" ON "service_entries"("stayId", "workedOn");

-- AddForeignKey
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "service_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of it is expressible in schema.prisma, and all of it
-- is the point: without it, "verified hours" is a number anyone can retype.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The shape of an entry ───────────────────────────────────────────────

-- Bounded by a day. Zero is reserved for a VOID, and a void can only ever be an
-- amendment — an original claiming no work done is a half-filled form that
-- reached the table, not a record.
ALTER TABLE "service_entries" ADD CONSTRAINT "service_minutes_sane"
  CHECK ("minutes" BETWEEN 0 AND 1440);

ALTER TABLE "service_entries" ADD CONSTRAINT "service_zero_only_on_amendment"
  CHECK ("minutes" > 0 OR "supersedesId" IS NOT NULL);

-- An hour with no place is not defensible to a court.
ALTER TABLE "service_entries" ADD CONSTRAINT "service_location_present"
  CHECK (length(btrim("location")) > 0);

-- The verification pair arrives together or not at all — the same shape as
-- sign_outs' returnedAt/returnAcknowledgedById. A verified hour nobody stands
-- behind is not verified.
ALTER TABLE "service_entries" ADD CONSTRAINT "service_verified_pair"
  CHECK (("verifiedAt" IS NULL) = ("verifiedById" IS NULL));

-- The reason IS the record. An amendment without one shows that a number
-- changed and nothing about why; a reason without an amendment is orphaned text.
ALTER TABLE "service_entries" ADD CONSTRAINT "service_amendment_reason_paired"
  CHECK (
    ("supersedesId" IS NULL AND "amendmentReason" IS NULL)
    OR ("supersedesId" IS NOT NULL AND length(btrim("amendmentReason")) > 0)
  );

-- ── 2. Immutable apart from ONE transition ─────────────────────────────────
--
-- Stricter and more precise than ledger_entries, which refuses UPDATE outright.
-- The rule is a WHITELIST of what may move, written as a WHOLE-ROW comparison
-- rather than a list of column names — so a column added in six months is
-- immutable BY DEFAULT rather than silently mutable because nobody remembered
-- to extend the list. That default is most of why this table can be evidence.
CREATE OR REPLACE FUNCTION "service_entries_verification_transition"()
RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - 'verifiedAt' - 'verifiedById')
       IS DISTINCT FROM (to_jsonb(OLD) - 'verifiedAt' - 'verifiedById') THEN
    RAISE EXCEPTION
      'service_entries is immutable apart from verification: correct a mistake with an amendment (supersedesId + amendmentReason), never an UPDATE.';
  END IF;

  -- Write-once. Never verified → unverified, which would erase an attestation,
  -- and never a change of verifier, which would move somebody's name onto a
  -- claim they did not make.
  IF OLD."verifiedAt" IS NOT NULL OR OLD."verifiedById" IS NOT NULL THEN
    RAISE EXCEPTION
      'this service entry is already verified; amend it rather than re-verifying it';
  END IF;

  IF NEW."verifiedAt" IS NULL OR NEW."verifiedById" IS NULL THEN
    RAISE EXCEPTION 'verification sets verifiedAt and verifiedById together';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "service_entries_transition_only"
  BEFORE UPDATE ON "service_entries"
  FOR EACH ROW EXECUTE FUNCTION "service_entries_verification_transition"();

CREATE OR REPLACE FUNCTION "service_entries_is_never_deleted"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'service_entries is never deleted: void an entry by amending it to zero minutes with a reason.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "service_entries_no_delete"
  BEFORE DELETE ON "service_entries"
  FOR EACH ROW EXECUTE FUNCTION "service_entries_is_never_deleted"();

-- ── 3. An amendment stays inside its own stay ──────────────────────────────
-- Same shape and same reason as ledger_correction_same_stay: pointing a
-- correction at another resident's entry produces two records that each look
-- internally consistent and are both wrong. Cross-row, so it cannot be a CHECK.
--
-- A FORKED chain needs nothing here — "supersedesId" is UNIQUE, so two rows
-- cannot both claim to correct the same entry.
CREATE OR REPLACE FUNCTION "service_amendment_same_stay"()
RETURNS TRIGGER AS $$
DECLARE
  target_stay TEXT;
BEGIN
  IF NEW."supersedesId" IS NULL THEN RETURN NEW; END IF;

  SELECT "stayId" INTO target_stay
    FROM "service_entries" WHERE "id" = NEW."supersedesId";

  IF target_stay IS DISTINCT FROM NEW."stayId" THEN
    RAISE EXCEPTION 'a service amendment must reference an entry on the same stay';
  END IF;

  IF NEW."id" = NEW."supersedesId" THEN
    RAISE EXCEPTION 'a service entry cannot amend itself';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "service_amendment_scope"
  BEFORE INSERT ON "service_entries"
  FOR EACH ROW EXECUTE FUNCTION "service_amendment_same_stay"();

-- ── 4. Row-level security ──────────────────────────────────────────────────
-- A service entry belongs to a resident through its stay, exactly as a ledger
-- entry does. Fail-closed like every other policy: with no actor context set,
-- both predicates are false and the table reads as empty.
ALTER TABLE "service_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_entries" FORCE ROW LEVEL SECURITY;

-- CLAUDE.md's role table already promises a resident sees their OWN service
-- hours. This is that promise at the database level, ahead of the portal.
CREATE POLICY service_entries_read ON "service_entries" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (
      SELECT 1 FROM "stays" s
       WHERE s."id" = "service_entries"."stayId"
         AND s."residentId" = app_resident_id()
    )
  );

-- Staff-only writes today. When residents submit from the portal this becomes a
-- deliberate INSERT-only policy scoped to their own active stay — the same
-- shape module 8 plans for resident self-sign-out. Verification stays staff.
CREATE POLICY service_entries_write ON "service_entries" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- Belt and braces, matching ledger_entries: the attempt fails on privilege
-- before the trigger is reached. UPDATE is granted on the verification pair
-- ONLY, so the grant agrees with the trigger rather than relying on it.
REVOKE UPDATE, DELETE ON "service_entries" FROM soberlife_app;
GRANT UPDATE ("verifiedAt", "verifiedById") ON "service_entries" TO soberlife_app;
