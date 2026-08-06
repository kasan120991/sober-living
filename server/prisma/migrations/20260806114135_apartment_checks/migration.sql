-- CreateEnum
CREATE TYPE "CheckResidentStatus" AS ENUM ('PRESENT', 'SIGNED_OUT', 'NOT_FOUND');

-- CreateTable
CREATE TABLE "apartment_checks" (
    "id" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "supersedesId" TEXT,
    "amendmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartment_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apartment_check_residents" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "status" "CheckResidentStatus" NOT NULL,
    "note" TEXT,

    CONSTRAINT "apartment_check_residents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apartment_checks_supersedesId_key" ON "apartment_checks"("supersedesId");

-- CreateIndex
CREATE INDEX "apartment_checks_apartmentId_checkedAt_idx" ON "apartment_checks"("apartmentId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "apartment_check_residents_stayId_idx" ON "apartment_check_residents"("stayId");

-- CreateIndex
CREATE UNIQUE INDEX "apartment_check_residents_checkId_stayId_key" ON "apartment_check_residents"("checkId", "stayId");

-- AddForeignKey
ALTER TABLE "apartment_checks" ADD CONSTRAINT "apartment_checks_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_checks" ADD CONSTRAINT "apartment_checks_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_checks" ADD CONSTRAINT "apartment_checks_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "apartment_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_check_residents" ADD CONSTRAINT "apartment_check_residents_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "apartment_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartment_check_residents" ADD CONSTRAINT "apartment_check_residents_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written below. None of it is expressible in schema.prisma; all of it is
-- what makes an hourly round usable as evidence.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The shape of a check ────────────────────────────────────────────────

-- "What were they doing" is the record the facility asked for: a PRESENT line
-- with no note is a half-filled form that reached the table. The IS NOT NULL
-- is load-bearing: length(btrim(NULL)) is NULL, and a CHECK passes on NULL —
-- without it a NULL note walks straight through the constraint.
ALTER TABLE "apartment_check_residents" ADD CONSTRAINT "check_present_needs_note"
  CHECK ("status" <> 'PRESENT' OR ("note" IS NOT NULL AND length(btrim("note")) > 0));

-- The reason IS the record: without it the chain shows that a check changed
-- and nothing about why. Same intent as service_amendment_reason_paired, with
-- one correction: the explicit IS NOT NULL on the reason. Without it a NULL
-- reason makes the second branch NULL, FALSE OR NULL is NULL, and a CHECK
-- passes on NULL — the same hole check_present_needs_note plugs above.
ALTER TABLE "apartment_checks" ADD CONSTRAINT "check_amendment_reason_paired"
  CHECK (("supersedesId" IS NULL AND "amendmentReason" IS NULL)
      OR ("supersedesId" IS NOT NULL AND "amendmentReason" IS NOT NULL
          AND length(btrim("amendmentReason")) > 0));

-- ── 2. Append-only, both tables, stricter than service_entries ─────────────

-- service_entries keeps one write-once UPDATE (verification). A check has no
-- transition at all, so there is no whitelist: every UPDATE and every DELETE
-- is refused. One function, four triggers. The app role is additionally
-- refused by privilege below — the trigger is what catches a superuser, which
-- bypasses RLS even with FORCE.
CREATE OR REPLACE FUNCTION "apartment_checks_are_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'apartment checks are append-only: correct a check with an amendment (supersedesId + amendmentReason), never an UPDATE or DELETE.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "apartment_checks_no_update" BEFORE UPDATE ON "apartment_checks"
  FOR EACH ROW EXECUTE FUNCTION "apartment_checks_are_append_only"();
CREATE TRIGGER "apartment_checks_no_delete" BEFORE DELETE ON "apartment_checks"
  FOR EACH ROW EXECUTE FUNCTION "apartment_checks_are_append_only"();
CREATE TRIGGER "apartment_check_residents_no_update" BEFORE UPDATE ON "apartment_check_residents"
  FOR EACH ROW EXECUTE FUNCTION "apartment_checks_are_append_only"();
CREATE TRIGGER "apartment_check_residents_no_delete" BEFORE DELETE ON "apartment_check_residents"
  FOR EACH ROW EXECUTE FUNCTION "apartment_checks_are_append_only"();

-- ── 3. An amendment stays inside its own apartment ─────────────────────────

-- Cross-row, so a trigger rather than a CHECK — the same reason as
-- service_amendment_same_stay. An amendment claiming a different apartment
-- would be two internally-consistent records of a visit that never happened.
-- checkedAt equality is enforced in the service (the amendment IS the same
-- visit); the apartment is pinned here because this is the crossing that
-- corrupts evidence rather than merely mislabeling it.
CREATE OR REPLACE FUNCTION "check_amendment_same_apartment"() RETURNS TRIGGER AS $$
DECLARE target_apartment TEXT;
BEGIN
  IF NEW."supersedesId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."id" = NEW."supersedesId" THEN
    RAISE EXCEPTION 'a check cannot amend itself';
  END IF;
  SELECT "apartmentId" INTO target_apartment
    FROM "apartment_checks" WHERE "id" = NEW."supersedesId";
  IF target_apartment IS DISTINCT FROM NEW."apartmentId" THEN
    RAISE EXCEPTION 'a check amendment must reference a check of the same apartment';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "check_amendment_scope" BEFORE INSERT ON "apartment_checks"
  FOR EACH ROW EXECUTE FUNCTION "check_amendment_same_apartment"();

-- ── 4. Row-level security ──────────────────────────────────────────────────

ALTER TABLE "apartment_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apartment_checks" FORCE ROW LEVEL SECURITY;

-- Header: staff only, both directions. No resident read yet — the free-text
-- apartment note can name other residents, and nothing in the resident portal
-- needs the header. Widening later is one deliberate policy change.
CREATE POLICY apartment_checks_read ON "apartment_checks" FOR SELECT
  USING (app_is_staff());
CREATE POLICY apartment_checks_write ON "apartment_checks" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

ALTER TABLE "apartment_check_residents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apartment_check_residents" FORCE ROW LEVEL SECURITY;

-- Lines are resident data: sign_outs' policy shape verbatim — staff, or the
-- resident's own stay.
CREATE POLICY apartment_check_residents_read ON "apartment_check_residents" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "apartment_check_residents"."stayId"
          AND s."residentId" = app_resident_id())
  );
CREATE POLICY apartment_check_residents_write ON "apartment_check_residents" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- Privilege agrees with the triggers: the app role fails before a trigger is
-- reached, and unlike service_entries no column-level UPDATE grant survives —
-- there is nothing here to transition.
REVOKE UPDATE, DELETE ON "apartment_checks" FROM soberlife_app;
REVOKE UPDATE, DELETE ON "apartment_check_residents" FROM soberlife_app;
