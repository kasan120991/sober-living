-- CreateTable
CREATE TABLE "sign_outs" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT,
    "outAt" TIMESTAMP(3) NOT NULL,
    "expectedReturnAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "returnAcknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sign_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sign_outs_stayId_outAt_idx" ON "sign_outs"("stayId", "outAt");

-- AddForeignKey
ALTER TABLE "sign_outs" ADD CONSTRAINT "sign_outs_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_outs" ADD CONSTRAINT "sign_outs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_outs" ADD CONSTRAINT "sign_outs_returnAcknowledgedById_fkey" FOREIGN KEY ("returnAcknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written below. Prisma cannot express CHECK constraints, partial unique
-- indexes, or row-level security; they are added here so the migration is the
-- complete record of the table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Time ordering and required fields ─────────────────────────────────────

-- A sign-out expecting a return before it began is a typo, not a record.
ALTER TABLE "sign_outs"
  ADD CONSTRAINT "sign_out_expected_after_out" CHECK ("expectedReturnAt" > "outAt");

ALTER TABLE "sign_outs"
  ADD CONSTRAINT "sign_out_return_after_out"
  CHECK ("returnedAt" IS NULL OR "returnedAt" >= "outAt");

ALTER TABLE "sign_outs"
  ADD CONSTRAINT "sign_out_destination_present" CHECK (length(btrim("destination")) > 0);

-- A return and the staff member who saw it arrive together or not at all: a
-- returnedAt with no acknowledger is a record nobody stands behind.
ALTER TABLE "sign_outs"
  ADD CONSTRAINT "sign_out_return_acknowledged"
  CHECK (("returnedAt" IS NULL) = ("returnAcknowledgedById" IS NULL));

-- ── 2. One open sign-out per stay ────────────────────────────────────────────

-- A resident is out or they are not; two open sign-outs is a data-entry race,
-- not a state of the world. Soft-deleted rows are excluded on purpose:
-- removing a record made in error frees the slot.
CREATE UNIQUE INDEX "one_open_sign_out_per_stay"
  ON "sign_outs" ("stayId") WHERE "returnedAt" IS NULL AND "deletedAt" IS NULL;

-- The overdue scan: open rows by expected return.
CREATE INDEX "open_sign_outs_expected_return"
  ON "sign_outs" ("expectedReturnAt") WHERE "returnedAt" IS NULL AND "deletedAt" IS NULL;

-- ── 3. Row-level security ────────────────────────────────────────────────────

-- Stay-owned, exactly like bed_assignments and ledger_entries. New tables get
-- grants automatically via ALTER DEFAULT PRIVILEGES, but NOT policies — without
-- this block the table would be readable by any actor.
ALTER TABLE "sign_outs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sign_outs" FORCE ROW LEVEL SECURITY;

CREATE POLICY sign_outs_read ON "sign_outs" FOR SELECT
  USING (
    app_is_staff()
    OR EXISTS (SELECT 1 FROM "stays" s
        WHERE s."id" = "sign_outs"."stayId" AND s."residentId" = app_resident_id())
  );

CREATE POLICY sign_outs_write ON "sign_outs" FOR ALL
  USING (app_is_staff()) WITH CHECK (app_is_staff());

-- UPDATE stays granted: acknowledging a return and a soft delete are both
-- updates. Hard DELETE is never legitimate — resident data is retained.
REVOKE DELETE ON "sign_outs" FROM soberlife_app;
